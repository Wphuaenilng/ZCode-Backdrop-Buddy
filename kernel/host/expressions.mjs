// 宿主通用表达式：注入/校验/暂停/移除只依赖 profile 的几个字段，
// 各宿主的差异（选择器、主题变量、主题标记挂在哪）都在 profile 里声明。
export const DEFAULT_IDS = Object.freeze({
  styleId: 'backdropbuddy-theme',
  layerId: 'backdropbuddy-backdrop',
  videoId: 'backdropbuddy-video'
});

const target = (p) => (p.tokenTarget === 'body' ? 'document.body' : 'document.documentElement');
const themedTarget = (p) => (p.themedTarget === 'body' ? 'document.body' : 'document.documentElement');
// 页面当前是深色还是浅色：校验配色必须按"此刻"的模式取，不能沿用注入那一刻的。
// class 形态（.dark）与属性形态（html[data-theme="dark"]，ChatGPT 这类）都支持。
const darkProbe = (p) => {
  const el = (name) => (p.darkTarget === 'body' ? 'document.body' : name);
  if (p.darkAttr) return `${el('document.documentElement')}.getAttribute('${p.darkAttr}') === '${p.darkAttrValue || 'dark'}'`;
  if (p.darkClass) return `${el('document.documentElement')}.classList.contains('${p.darkClass}')`;
  return 'null';
};

export function fingerprintExpression(p) {
  return `(() => {
    const root = document.querySelector('${p.readySelector}');
    const html = document.documentElement;
    const body = document.body;
    const cs = getComputedStyle(${target(p)});
    return {
      url: location.href,
      title: document.title,
      ready: !!root${p.readyClass ? ` && body.classList.contains('${p.readyClass}')` : ''},
      loading: ${p.loadingSelector ? `!!document.querySelector('${p.loadingSelector}')` : 'false'},
      rootChildren: root ? root.children.length : 0,
      testidCount: ${p.testidSelector ? `document.querySelectorAll('${p.testidSelector}').length` : '0'},
      htmlClass: html.className,
      bodyClass: body.className,
      darkClass: ${darkProbe(p) === 'null' ? 'false' : darkProbe(p)},
      backgroundToken: cs.getPropertyValue('${p.backgroundVar}').trim(),
      foregroundToken: cs.getPropertyValue('${p.foregroundVar}').trim(),
      version: ${p.versionExpression || 'null'}
    };
  })()`;
}

export function snapshotExpression(p) {
  return `(() => {
    const cs = getComputedStyle(${target(p)});
    const style = document.getElementById('${p.styleId}');
    return {
      url: location.href,
      title: document.title,
      ready: !!document.querySelector('${p.readySelector}')${p.readyClass ? ` && document.body.classList.contains('${p.readyClass}')` : ''},
      loading: ${p.loadingSelector ? `!!document.querySelector('${p.loadingSelector}')` : 'false'},
      htmlClass: document.documentElement.className,
      bodyClass: document.body.className,
      testidCount: ${p.testidSelector ? `document.querySelectorAll('${p.testidSelector}').length` : '0'},
      injected: {
        style: !!style,
        layer: !!document.getElementById('${p.layerId}'),
        video: !!document.getElementById('${p.videoId}')
      },
      tokens: {
        background: cs.getPropertyValue('${p.backgroundVar}').trim(),
        foreground: cs.getPropertyValue('${p.foregroundVar}').trim()
      }
    };
  })()`;
}

export function injectionExpression(p, { css, themeId, media }) {
  return `(async () => {
    const CSS = ${JSON.stringify(css)};
    const THEME_ID = ${JSON.stringify(themeId)};
    const MEDIA = ${JSON.stringify(media || null)};
    const STYLE_ID = '${p.styleId}';
    const LAYER_ID = '${p.layerId}';
    const VIDEO_ID = '${p.videoId}';

    const parent = document.body || document.documentElement;
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.setAttribute('data-bb', '1');
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = CSS;

    let layer = document.getElementById(LAYER_ID);
    if (!layer) {
      layer = document.createElement('div');
      layer.id = LAYER_ID;
      layer.setAttribute('aria-hidden', 'true');
      layer.setAttribute('data-bb', '1');
      parent.insertBefore(layer, parent.firstChild);
    }

    let video = document.getElementById(VIDEO_ID);
    if (MEDIA && MEDIA.kind === 'video') {
      if (!video) {
        video = document.createElement('video');
        video.id = VIDEO_ID;
        video.muted = true;
        video.loop = true;
        video.autoplay = true;
        video.playsInline = true;
        video.setAttribute('aria-hidden', 'true');
        video.setAttribute('data-bb', '1');
        // 必须插在遮罩层之前：两者同为 z-index:0，按 DOM 顺序叠放，
        // 视频在后会盖住层的 ::before/::after 调光遮罩，dim/safe 就全部失效
        parent.insertBefore(video, layer);
      }
      // 旧版本注入的视频排在层之后，重 apply 时拉回正确位置
      if (video.nextElementSibling !== layer) parent.insertBefore(video, layer);
      if (video.dataset.bbUrl !== MEDIA.url) {
        video.dataset.bbUrl = MEDIA.url;
        video.src = MEDIA.url;
      }
      if (MEDIA.poster) video.poster = MEDIA.poster;
      video.style.display = '';
      const playing = video.play();
      if (playing && playing.catch) playing.catch(() => {});
      // Chromium 在页面隐藏（窗口最小化/被完全遮挡）时会暂停视频，恢复可见后又不自动续播；
      // 挂一个恢复监听：窗口回到前台时接着放。监听只挂一次，元素没了自然空转。
      if (!document.__bbVisResume) {
        document.__bbVisResume = true;
        document.addEventListener('visibilitychange', () => {
          const el = document.getElementById(VIDEO_ID);
          if (!document.hidden && el && !el.ended && el.paused) {
            const resume = el.play();
            if (resume && resume.catch) resume.catch(() => {});
          }
        });
      }
    } else if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
      video = null;
    }

    layer.dataset.kind = MEDIA ? MEDIA.kind : 'none';
    ${themedTarget(p)}.setAttribute('data-bb-theme', THEME_ID);
    await new Promise((resolve) => setTimeout(resolve, 80));

    const cs = getComputedStyle(${target(p)});
    const root = document.querySelector('${p.rootSelector}');
    return {
      style: !!document.getElementById(STYLE_ID),
      styleBytes: document.getElementById(STYLE_ID) ? document.getElementById(STYLE_ID).textContent.length : 0,
      layer: !!document.getElementById(LAYER_ID),
      video: !!document.getElementById(VIDEO_ID),
      kind: layer.dataset.kind,
      background: cs.getPropertyValue('${p.backgroundVar}').trim(),
      layerImage: getComputedStyle(layer).backgroundImage.slice(0, 120),
      themed: ${themedTarget(p)}.getAttribute('data-bb-theme'),
      rootZ: root ? getComputedStyle(root).zIndex : null
    };
  })()`;
}

export function verifyExpression(p) {
  return `(() => {
    const style = document.getElementById('${p.styleId}');
    const layer = document.getElementById('${p.layerId}');
    const video = document.getElementById('${p.videoId}');
    const cs = getComputedStyle(${target(p)});
    return {
      style: !!style,
      layer: !!layer,
      video: !!video,
      kind: layer ? layer.dataset.kind : null,
      background: cs.getPropertyValue('${p.backgroundVar}').trim(),
      dim: cs.getPropertyValue('--bb-dim').trim(),
      layerImage: layer ? getComputedStyle(layer).backgroundImage.slice(0, 120) : null,
      videoReady: video ? video.readyState : null,
      themed: ${themedTarget(p)}.getAttribute('data-bb-theme'),
      dark: ${darkProbe(p)},
      paused: style ? !!style.disabled : false
    };
  })()`;
}

export function pauseExpression(p, paused) {
  const flag = paused ? 'true' : 'false';
  return `(() => {
    const style = document.getElementById('${p.styleId}');
    const layer = document.getElementById('${p.layerId}');
    const video = document.getElementById('${p.videoId}');
    if (style) {
      style.disabled = ${flag};
      if (style.sheet) style.sheet.disabled = ${flag};
    }
    if (layer) layer.style.display = ${paused ? "'none'" : "''"};
    if (video) {
      if (${flag}) video.pause();
      else { const playing = video.play(); if (playing && playing.catch) playing.catch(() => {}); }
      video.style.display = ${paused ? "'none'" : "''"};
    }
    const cs = getComputedStyle(${target(p)});
    return {
      paused: ${flag},
      styleDisabled: style ? !!style.disabled : null,
      background: cs.getPropertyValue('${p.backgroundVar}').trim(),
      dim: cs.getPropertyValue('--bb-dim').trim(),
      dark: ${darkProbe(p)},
      layerVisible: layer ? getComputedStyle(layer).display !== 'none' : false
    };
  })()`;
}

export function removeExpression(p) {
  return `(() => {
    const video = document.getElementById('${p.videoId}');
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video.remove();
    }
    const layer = document.getElementById('${p.layerId}');
    if (layer) layer.remove();
    const style = document.getElementById('${p.styleId}');
    if (style) style.remove();
    ${themedTarget(p)}.removeAttribute('data-bb-theme');
    if (window.__bbUrls) {
      for (const url of window.__bbUrls) { try { URL.revokeObjectURL(url); } catch { /* ignore */ } }
      window.__bbUrls = null;
    }
    const cs = getComputedStyle(${target(p)});
    return {
      style: !!document.getElementById('${p.styleId}'),
      layer: !!document.getElementById('${p.layerId}'),
      video: !!document.getElementById('${p.videoId}'),
      themed: ${themedTarget(p)}.getAttribute('data-bb-theme'),
      background: cs.getPropertyValue('${p.backgroundVar}').trim(),
      htmlClass: document.documentElement.className,
      bodyClass: document.body.className
    };
  })()`;
}

// 通用背景层/视频层规则：宿主 CSS 只负责"让界面透明"，这两段负责"底下放什么"。
// 注意：视频主题时层不能有任何底色——视频元素插在层之前、同为 z-index:0，
// 层上哪怕一层 #000 也会整面盖住视频（视频主题黑屏就是这里来的）。
export function backdropRules({ p, imageLine, position, scale, blur, dim, safe }) {
  return [
    'html, body { background: transparent !important; }',
    `${p.rootSelector} { position: relative; z-index: 1; }`,
    `#${p.layerId} {`,
    '  position: fixed; inset: -16px; z-index: 0; pointer-events: none;',
    `  ${imageLine}`,
    '  filter: blur(2px);',
    '}',
    `#${p.layerId}::before {`,
    '  content: ""; position: absolute; inset: 0; pointer-events: none;',
    `  background: ${safe};`,
    '}',
    `#${p.layerId}::after {`,
    '  content: ""; position: absolute; inset: 0; pointer-events: none;',
    `  background: ${dim};`,
    '}',
    `#${p.videoId} {`,
    '  position: fixed; inset: -16px; z-index: 0; width: calc(100% + 32px); height: calc(100% + 32px);',
    '  object-fit: cover; pointer-events: none; background: #000;',
    `  object-position: ${position}; transform: scale(${scale}); transform-origin: ${position};`,
    '  filter: blur(2px);',
    '}',
    `[class~="bg-background"], [class~="bg-sidebar"], [class~="bg-header"] { backdrop-filter: blur(${blur}) saturate(1.08); }`
  ].join('\n');
}
