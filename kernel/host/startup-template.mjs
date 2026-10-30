export const STARTUP_PRESETS = Object.freeze(['zcode-pop', 'theme-reveal']);
export const STARTUP_LIMITS = Object.freeze({
  minHoldMs: 900,
  maxHoldMs: 3000,
  // 下限要覆盖最长淡出（180ms）+ 最短停留（900ms），否则配置值会被
  // deadlineTimer 的 Math.max(900, ...) 截断到跳过保护之前就 timeout。
  minMaxDurationMs: 1080,
  maxDurationMs: 20000,
  maxMediaBytes: 500 * 1024
});

const DEFAULT_TEMPLATE = Object.freeze({
  preset: 'zcode-pop',
  holdMs: 900,
  maxDurationMs: 20000,
  themeName: 'ZCode',
  accent: '#6f9275',
  mediaUrl: null,
  reducedMotion: false,
  launchId: 'preview',
  preview: false,
  currentDocument: false
});

function safeMediaUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 1024 * 1024 || /[\u0000-\u0020<>"']/g.test(value)) return null;
  if (/^file:\/\/\//i.test(value)) return value;
  if (/^https:\/\/media\.backdropbuddy\.invalid\//i.test(value)) return value;
  if (/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(value)) return value;
  return null;
}

export function normalizeStartupTemplate(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const hold = Number(input.holdMs);
  const maxDuration = Number(input.maxDurationMs);
  const launchId = typeof input.launchId === 'string' && /^[a-z0-9-]{8,64}$/i.test(input.launchId)
    ? input.launchId
    : DEFAULT_TEMPLATE.launchId;
  return {
    preset: STARTUP_PRESETS.includes(input.preset) ? input.preset : DEFAULT_TEMPLATE.preset,
    holdMs: Number.isFinite(hold)
      ? Math.min(STARTUP_LIMITS.maxHoldMs, Math.max(STARTUP_LIMITS.minHoldMs, Math.round(hold)))
      : DEFAULT_TEMPLATE.holdMs,
    maxDurationMs: Number.isFinite(maxDuration)
      ? Math.min(STARTUP_LIMITS.maxDurationMs, Math.max(STARTUP_LIMITS.minMaxDurationMs, Math.round(maxDuration)))
      : DEFAULT_TEMPLATE.maxDurationMs,
    themeName: typeof input.themeName === 'string' && input.themeName.trim()
      ? input.themeName.trim().slice(0, 24)
      : DEFAULT_TEMPLATE.themeName,
    accent: /^#[0-9a-f]{6}$/i.test(String(input.accent || ''))
      ? String(input.accent).toLowerCase()
      : DEFAULT_TEMPLATE.accent,
    mediaUrl: safeMediaUrl(input.mediaUrl),
    reducedMotion: input.reducedMotion === true,
    launchId,
    preview: input.preview === true,
    currentDocument: input.currentDocument === true
  };
}

function serializeForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

// This function is serialized into CDP and the sandboxed preview. Keep it self-contained:
// no imports, no network, and no theme-provided markup or executable code.
export function installStartupLayer(rawOptions) {
  const options = rawOptions || {};
  if (!options.preview && window.top !== window) return { installed: false, reason: 'nested-window' };
  if (!options.preview) {
    if (location.protocol !== 'file:' || !/out[\/]renderer[\/]index\.html(?:$|[?#])/i.test(location.href)) {
      return { installed: false, reason: 'not-main-renderer' };
    }
    if (/update-status|plugin-sandbox|embedded-browser/i.test(location.href) || /[?&]windowKind=/i.test(location.href)) {
      return { installed: false, reason: 'secondary-window' };
    }
  }
  if (window.__backdropBuddyStartupLayer) return { installed: true, alreadyActive: true };

  const shownKey = 'backdropbuddy.startup.shown.v1';
  const handoffKey = 'backdropbuddy.startup.handoff.v1';
  let storage = null;
  if (!options.preview) {
    try { storage = window.sessionStorage; } catch { storage = null; }
    if (!storage) return { installed: false, reason: 'session-storage-unavailable' };
    try {
      const handoff = storage.getItem(handoffKey) === options.launchId;
      if (handoff) storage.removeItem(handoffKey);
      if (!handoff && storage.getItem(shownKey) === options.launchId) {
        report('skipped', { reason: 'already-shown', ...stateSnapshot() });
        return { installed: false, reason: 'already-shown' };
      }
      storage.setItem(shownKey, options.launchId);
      if (options.currentDocument) storage.setItem(handoffKey, options.launchId);
    } catch {
      return { installed: false, reason: 'session-storage-rejected' };
    }
  }

  const reduced = options.reducedMotion === true || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fadeMs = reduced ? 150 : 180;
  const holdMs = Math.max(900, Math.min(3000, Number(options.holdMs) || 900));
  const maxDurationMs = Math.max(900, Number(options.maxDurationMs) || 20000);
  // 本函数会被 toString() 序列化后注入宿主，不能引用模块级常量；
  // 正文等待上限因此写成局部常量。
  const CONTENT_WAIT_MS = 1500;
  let startedAt = performance.now();
  let readyAt = 0;
  const state = { installed: false, finished: false, removed: false, reason: null };
  let layer = null;
  let style = null;
  let observer = null;
  let readyTimer = 0;
  let holdTimer = 0;
  let deadlineTimer = 0;
  let cleanupTimer = 0;
  let replayTimer = 0;

  function report(stage, extra) {
    try {
      if (typeof window.__backdropBuddyStartupReport === 'function') {
        window.__backdropBuddyStartupReport(JSON.stringify({
          stage,
          launchId: options.launchId,
          at: performance.now(),
          timeOrigin: performance.timeOrigin,
          href: location.href,
          ...(extra || {})
        }));
      }
    } catch { /* diagnostics are optional */ }
  }

  function hostReady() {
    return options.preview === true || !!(
      document.body && document.body.classList.contains('zcode-startup-ready') && document.querySelector('#root')
    );
  }

  function hostLoadingGone() {
    const loading = document.getElementById('loading');
    if (!loading) return true;
    const style = window.getComputedStyle(loading);
    return style.display === 'none' || style.visibility === 'hidden';
  }

  function stateSnapshot() {
    const loading = document.getElementById('loading');
    const root = document.querySelector('#root');
    const loadingStyle = loading ? window.getComputedStyle(loading) : null;
    const rootStyle = root ? window.getComputedStyle(root) : null;
    return {
      bodyClass: document.body ? document.body.className : '',
      loading: !!loading,
      loadingDisplay: loadingStyle ? loadingStyle.display : null,
      loadingOpacity: loadingStyle ? loadingStyle.opacity : null,
      rootOpacity: rootStyle ? rootStyle.opacity : null,
      rootChildren: root ? root.childElementCount : null,
      rootText: root ? (root.innerText || '').slice(0, 40) : null
    };
  }

  function hostContentReady() {
    const root = document.querySelector('#root');
    if (!root) return false;
    return ((root.innerText || root.textContent) || '').trim().length > 0;
  }

  function handoffReady() {
    // 预览 iframe 没有宿主正文，#root 内容条件只适用于真实宿主启动。
    if (options.preview === true) return true;
    if (!hostReady()) return false;
    if (!readyAt) {
      readyAt = performance.now();
      report('host-ready', { elapsedMs: Math.round(readyAt - startedAt), ...stateSnapshot() });
    }
    const sinceReady = performance.now() - readyAt;
    // 宿主 ready 后还会先挂一个无文字的 React 启动占位页；只等 #loading 会露出它。
    // 正文有内容后再交还；#loading 残留时最多再等 600ms。
    // 但正文自身也要兜底：宿主若始终不出文本（canvas 渲染、挂载失败），
    // 内容条件会把启动层一直按到硬截止，不能让单条判据独占那条路径。
    if (sinceReady >= CONTENT_WAIT_MS) return true;
    return hostContentReady() && (hostLoadingGone() || sinceReady >= 600);
  }

  function remove() {
    if (state.removed) return;
    state.removed = true;
    clearInterval(readyTimer);
    clearTimeout(holdTimer);
    clearTimeout(deadlineTimer);
    clearTimeout(cleanupTimer);
    clearTimeout(replayTimer);
    if (observer) observer.disconnect();
    window.removeEventListener('keydown', onKey, true);
    if (layer) layer.remove();
    if (style) style.remove();
    document.documentElement.classList.remove('bb-startup-cover');
    if (window.__backdropBuddyStartupLayer === api) delete window.__backdropBuddyStartupLayer;
    report('removed', { reason: state.reason, elapsedMs: Math.round(performance.now() - startedAt), ...stateSnapshot() });
  }

  function finish(reason) {
    if (state.finished || state.removed) return;
    if (performance.now() - startedAt < 900 && reason !== 'timeout') return;
    state.finished = true;
    state.reason = reason;
    clearInterval(readyTimer);
    clearTimeout(holdTimer);
    clearTimeout(deadlineTimer);
    if (layer) {
      layer.classList.add('bb-startup-leaving');
      layer.style.transitionDuration = `${fadeMs}ms`;
    }
    report('finishing', { reason, elapsedMs: Math.round(performance.now() - startedAt), ...stateSnapshot() });
    // The preview iframe has no host to signal readiness; loop the animation
    // there instead of tearing the layer down and leaving a blank page.
    if (options.preview) replayTimer = setTimeout(replay, fadeMs + 320);
    else cleanupTimer = setTimeout(remove, fadeMs);
  }

  function replay() {
    if (state.removed) return;
    if (layer) layer.remove();
    state.installed = false;
    state.finished = false;
    state.reason = null;
    startedAt = performance.now();
    readyAt = 0;
    installDom();
  }

  function onKey(event) {
    if (performance.now() - startedAt < 900) return;
    if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      finish('skipped');
    }
  }

  function installDom() {
    if (state.installed || state.removed || !document.documentElement) return;
    if (!style) {
      style = document.createElement('style');
      style.id = 'backdropbuddy-startup-style';
      style.textContent = `
      html.bb-startup-cover::before{content:"";position:fixed;inset:0;z-index:2147483647;background:#101216;pointer-events:auto}
      #loading{opacity:0!important}
      .bb-startup{position:fixed;inset:0;z-index:2147483646;overflow:hidden;opacity:1;pointer-events:auto;-webkit-app-region:drag;background:#101216;color:#fff;transition:opacity ${fadeMs}ms ease;font-family:"Segoe UI","Microsoft YaHei",sans-serif}
      .bb-startup *{box-sizing:border-box}
      .bb-startup-bg{position:absolute;inset:-24px;background-position:center;background-size:cover;background-repeat:no-repeat;transform:scale(1.02)}
      .bb-startup-scrim{position:absolute;inset:0;background:linear-gradient(180deg,rgba(9,12,16,.16),rgba(9,12,16,.56)),radial-gradient(circle at 50% 44%,transparent 0,rgba(8,11,15,.28) 72%)}
      .bb-startup-center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px}
      .bb-startup-logo{display:flex;align-items:center;justify-content:center;width:96px;height:96px;border:1px solid rgba(255,255,255,.12);border-radius:24px;background:linear-gradient(180deg,#000,#151718);box-shadow:0 20px 42px rgba(0,0,0,.28);animation:bb-startup-pop .72s cubic-bezier(.22,1,.36,1) both}
      .bb-startup-logo svg{width:56px;height:48px;color:#fff;fill:currentColor}
      .bb-startup-name{max-width:70vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:14px;font-weight:500;letter-spacing:.16em;text-shadow:0 1px 12px rgba(0,0,0,.45)}
      .bb-startup-line{width:112px;height:2px;overflow:hidden;border-radius:999px;background:rgba(255,255,255,.16)}
      .bb-startup-line::after{content:"";display:block;width:48%;height:100%;border-radius:inherit;background:var(--bb-startup-accent);animation:bb-startup-sweep .9s ease-in-out both}
      .bb-startup-skip{position:absolute;right:24px;bottom:22px;padding:8px 13px;border:1px solid rgba(255,255,255,.22);border-radius:999px;background:rgba(12,16,20,.34);color:rgba(255,255,255,.82);font:12px "Segoe UI","Microsoft YaHei",sans-serif;cursor:pointer;-webkit-app-region:no-drag}
      .bb-startup-skip:focus-visible{outline:2px solid #fff;outline-offset:3px}
      .bb-startup.theme-reveal .bb-startup-bg{animation:bb-startup-reveal 3.5s ease-out both}
      .bb-startup.theme-reveal .bb-startup-logo{width:72px;height:72px;border-radius:20px;animation-duration:.5s}
      .bb-startup.theme-reveal .bb-startup-logo svg{width:42px;height:36px}
      .bb-startup.theme-reveal .bb-startup-name{font-size:20px;letter-spacing:.1em}
      .bb-startup-leaving{opacity:0;pointer-events:none}
      .bb-startup.reduced *,.bb-startup.reduced *::before,.bb-startup.reduced *::after{animation:none!important;transition:none!important}
      .bb-startup.reduced .bb-startup-bg{transform:none}
      @keyframes bb-startup-pop{0%{opacity:0;transform:scale(.72)}38%{opacity:1;transform:scale(1.045)}58%{transform:scale(.985)}76%{transform:scale(1.008)}100%{opacity:1;transform:scale(1)}}
      @keyframes bb-startup-sweep{0%{transform:translateX(-110%)}100%{transform:translateX(220%)}}
      @keyframes bb-startup-reveal{0%{transform:scale(1.02)}100%{transform:scale(1.09)}}
    `;
      document.documentElement.appendChild(style);
    }
    document.documentElement.classList.add('bb-startup-cover');

    layer = document.createElement('div');
    layer.id = 'backdropbuddy-startup-layer';
    layer.className = `bb-startup ${options.preset === 'theme-reveal' ? 'theme-reveal' : 'zcode-pop'}${reduced ? ' reduced' : ''}`;
    layer.setAttribute('role', 'status');
    layer.setAttribute('aria-label', 'ZCode 启动中');
    layer.style.setProperty('--bb-startup-accent', options.accent);

    const background = document.createElement('div');
    background.className = 'bb-startup-bg';
    if (options.mediaUrl) background.style.backgroundImage = `url(${JSON.stringify(options.mediaUrl)})`;
    const scrim = document.createElement('div');
    scrim.className = 'bb-startup-scrim';
    const center = document.createElement('div');
    center.className = 'bb-startup-center';
    const logo = document.createElement('div');
    logo.className = 'bb-startup-logo';
    logo.innerHTML = '<svg viewBox="0 0 256 218" aria-hidden="true"><path d="M134.4 0.130152L116.48 25.6022C113.665 29.5699 109.054 32.0019 104.064 32.0019H6.3999V0C6.3999 0.130149 134.4 0.130152 134.4 0.130152Z"/><path d="M256 0.130127L102.401 217.732H0L153.599 0.130127H256Z"/><path d="M121.601 217.732L139.65 192.134C142.465 188.166 147.076 185.734 152.067 185.734H249.604V217.736H121.601V217.732Z"/></svg>';
    const name = document.createElement('div');
    name.className = 'bb-startup-name';
    name.textContent = options.themeName || 'ZCode';
    const line = document.createElement('div');
    line.className = 'bb-startup-line';
    center.append(logo, name, line);
    const skip = document.createElement('button');
    skip.className = 'bb-startup-skip';
    skip.type = 'button';
    skip.textContent = '跳过 · Esc';
    skip.setAttribute('aria-label', '跳过启动动画');
    skip.addEventListener('click', () => finish('skipped'));
    layer.append(background, scrim, center, skip);
    layer.addEventListener('click', (event) => { if (event.target === layer || event.target === scrim) finish('skipped'); });
    (document.body || document.documentElement).appendChild(layer);
    state.installed = true;
    document.documentElement.classList.remove('bb-startup-cover');
    report('installed', { reducedMotion: reduced, preset: options.preset });

    window.removeEventListener('keydown', onKey, true);
    window.addEventListener('keydown', onKey, true);
    holdTimer = setTimeout(() => { if (handoffReady()) finish('ready'); }, holdMs);
    deadlineTimer = setTimeout(() => finish('timeout'), Math.max(900, maxDurationMs - fadeMs));
    readyTimer = setInterval(() => {
      if (performance.now() - startedAt >= holdMs && handoffReady()) finish('ready');
    }, 80);
  }

  const api = {
    status: () => ({ ...state, href: location.href, timeOrigin: performance.timeOrigin }),
    dispose: () => finish('skipped')
  };
  window.__backdropBuddyStartupLayer = api;
  report('script');
  observer = new MutationObserver(installDom);
  observer.observe(document, { childList: true, subtree: true });
  installDom();
  return {
    installed: true,
    pending: !state.installed,
    timeOrigin: performance.timeOrigin,
    href: location.href
  };
}

export function startupScript(value, { currentDocument = false, preview = false } = {}) {
  const config = normalizeStartupTemplate({ ...value, currentDocument, preview });
  return `(${installStartupLayer.toString()})(${serializeForScript(config)})`;
}

export function createStartupPreviewHtml(value) {
  const config = normalizeStartupTemplate({ ...value, preview: true, currentDocument: false, launchId: 'preview' });
  const script = startupScript(config, { preview: true });
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src https://media.backdropbuddy.invalid data: blob:; connect-src 'none'; object-src 'none'; base-uri 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><script>${script}</script></body></html>`;
}
