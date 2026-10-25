import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { AppError } from '../protocol/errors.mjs';
import { runPowerShellJson } from '../platform/exec.mjs';
import { openCdp } from './detect.mjs';
import { hashFile } from '../media/hashing.mjs';
import { ZCODE_PROFILE } from './zcode.mjs';

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function normalizeColor(value) {
  const text = String(value || '').replace(/\s+/g, '').toLowerCase();
  const match = text.match(/^rgba?\(([^)]+)\)$/);
  if (!match) return text;
  const parts = match[1].split(',').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return text;
  return `rgba(${parts[0]},${parts[1]},${parts[2]},${Number(parts[3].toFixed(2))})`;
}

const DEFAULT_LUMINANCE = Object.freeze({
  mean: 0.5,
  center: 0.5,
  p15: 0.2,
  p75: 0.6,
  p85: 0.75,
  p90: 0.75,
  p99: 0.85,
  highlight: 0.1
});

function asUnit(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
}

function normalizeLuminance(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const values = {};
  for (const key of Object.keys(DEFAULT_LUMINANCE)) {
    values[key] = asUnit(source[key], DEFAULT_LUMINANCE[key]);
  }
  return { ...values, source: source.source || 'analysis' };
}

function fallbackLuminance(mode) {
  return mode === 'dark'
    ? { mean: 0.12, center: 0.12, p15: 0.04, p75: 0.14, p85: 0.18, p90: 0.18, p99: 0.22, highlight: 0, source: 'fallback' }
    : { mean: 0.92, center: 0.92, p15: 0.9, p75: 0.94, p85: 0.98, p90: 0.98, p99: 1, highlight: 0.6, source: 'fallback' };
}

function fail(code, message, { retryable = false, details = null } = {}) {
  return new AppError(code, message, { retryable, details });
}

export function createHostAdapter({
  detector,
  logger,
  appRoot,
  paths,
  profile = ZCODE_PROFILE,
  runtime = null,
  getPreferences = () => ({}),
  session: openSession = openCdp
}) {
  const {
    buildThemeCss,
    normalizeThemeParams,
    injectionExpression,
    snapshotExpression,
    verifyExpression,
    pauseExpression,
    removeExpression
  } = profile;

  let lastStatus = null;
  let lastAudit = null;
  let lastSync = null;
  let state = null;

  const ATTENTION_VERDICTS = new Set(['orphan-layer', 'stale-pointer', 'mismatch-layer', 'port-conflict']);

  function targetList(subject) {
    if (Array.isArray(subject)) return subject;
    if (subject && Array.isArray(subject.targets) && subject.targets.length) return subject.targets;
    return subject && subject.target ? [subject.target] : [];
  }

  // 宿主开着几个渲染窗口，皮肤就得同时打在几个窗口上；单窗口时与旧行为一致
  async function withTargets(status, run) {
    const opened = [];
    for (const target of targetList(status)) {
      const session = await openSession(target);
      // 有的产品把"桌宠/挂件"做成独立透明窗口：profile 可以点名跳过这类窗口
      if (profile.skipSelector) {
        let skip = false;
        try {
          skip = !!(await session.evaluate(`!!document.querySelector(${JSON.stringify(profile.skipSelector)})`));
        } catch { skip = false; }
        if (skip) {
          logger?.info('window skipped by profile', { target: target.id, skipSelector: profile.skipSelector });
          try { session.close(); } catch { /* ignore */ }
          continue;
        }
      }
      opened.push({ target, session });
    }
    const outcomes = [];
    try {
      for (const entry of opened) outcomes.push({ target: entry.target, result: await run(entry.session, entry.target) });
      return outcomes;
    } finally {
      for (const entry of opened) { try { entry.session.close(); } catch { /* ignore */ } }
    }
  }

  function verificationOf(verified, { themeId, media, tokensByMode, tokens, mode }) {
    const which = verified && verified.dark != null ? (verified.dark ? 'dark' : 'light') : mode;
    // 没有背景变量的宿主（Tauri/Vue 这类）读不到 token，用我们自己的 --bb-dim 当"样式确实生效"的哨兵
    const background = verified ? String(verified.background || '') : '';
    const sentinel = verified ? String(verified.dim || '').length > 0 : false;
    const expectedBackground = background ? normalizeColor((tokensByMode[which] || tokens).panel) : null;
    const artifactsOk = !!(verified && verified.style === true && verified.layer === true && verified.themed === themeId);
    const backgroundOk = background ? !!(verified && normalizeColor(background) === expectedBackground) : sentinel;
    const imageOk = !media || media.kind !== 'image' || /url\(/i.test(String(verified && verified.layerImage || ''));
    const videoOk = !media || media.kind !== 'video' || !!(verified && verified.video === true);
    return { mode: which, expectedBackground, artifactsOk, backgroundOk, imageOk, videoOk, ok: artifactsOk && backgroundOk && imageOk && videoOk };
  }

  async function removeAll(status) {
    await withTargets(status, (session) => session.evaluate(removeExpression()));
  }

  function hostSummary(status) {
    if (!status) return null;
    return {
      host: status.host,
      running: !!status.running,
      ready: !!status.ready,
      port: status.port,
      windows: Array.isArray(status.targets) ? status.targets.length : (status.target ? 1 : 0),
      errorCode: status.errorCode || null,
      reason: status.reason || null,
      owner: status.owner
        ? { pid: status.owner.pid, path: status.owner.path, matchesExe: !!status.owner.matchesExe }
        : null
    };
  }

  function recordAudit({ verdict, reason = '', action = null, themeId = null, previousThemeId = null, page = null, pointer = null, force = false }) {
    // 残留/失效这类需要用户处理的判定，在用户真正动手（apply/restore）之前，
    // 不能被一次普通刷新降级成 clean —— 否则横幅会在 UI 挂载时一闪而过。
    if (!force && lastAudit && lastAudit.attention && verdict === 'clean' && !themeId) {
      lastAudit = { ...lastAudit, checkedAt: new Date().toISOString() };
      return lastAudit;
    }

    const attention = ATTENTION_VERDICTS.has(verdict);
    lastAudit = {
      verdict,
      attention,
      action: attention ? action : null,
      reason,
      themeId: themeId || null,
      previousThemeId: previousThemeId || null,
      page: page || null,
      pointer: pointer || { themeId: themeId || null, paused: !!(state && state.paused) },
      runtime: { present: !!state },
      host: hostSummary(lastStatus),
      ...(lastSync ? { windows: lastSync } : {}),
      checkedAt: new Date().toISOString()
    };
    logger?.info('host audit', {
      verdict: lastAudit.verdict,
      attention: lastAudit.attention,
      action: lastAudit.action,
      themeId: lastAudit.themeId
    });
    return lastAudit;
  }

  function persistState() {
    if (!runtime || !state) return;
    try {
      runtime.write(state);
    } catch (error) {
      logger?.warn('runtime state persist failed', { message: error.message });
    }
  }

  function forgetState() {
    state = null;
    if (runtime) runtime.clear();
  }

  function backupDir() {
    const dir = paths && paths.backup ? paths.backup : path.join(appRoot || process.cwd(), 'backup');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  async function detect(options) {
    lastStatus = await detector.detect(options);
    return lastStatus;
  }

  async function requireStatus({ force = true } = {}) {    const status = await detector.detect({ force });
    lastStatus = status;

    if (!status.installed) throw fail('HOST_NOT_FOUND', `未找到 ZCode：${profile.exe}`, { retryable: true });
    if (!status.running) {
      const code = status.errorCode === 'HOST_UNREACHABLE' ? 'HOST_UNREACHABLE' : 'HOST_NOT_FOUND';
      throw fail(code, status.reason || 'ZCode 未运行', { retryable: true });
    }
    if (!status.portOpen) throw fail('HOST_NOT_READY', status.reason || `调试端口 ${profile.port} 未开放`, { retryable: true });
    if (!status.ownership || status.ownership.verified !== true) {
      throw fail('HOST_UNREACHABLE', status.reason || '调试端口归属校验失败', { retryable: true });
    }
    if (!status.supported) throw fail('HOST_UNSUPPORTED', status.supportedReason || 'ZCode 版本不受支持');
    if (!status.ready || !status.target) throw fail('HOST_NOT_READY', status.reason || 'ZCode 页面尚未就绪', { retryable: true });
    return status;
  }

  async function restart({ reapply = true } = {}) {
    let result;
    try {
      result = await runPowerShellJson('host/restart.ps1', {
        appRoot,
        args: ['-ExePath', profile.exe, '-Port', String(profile.port)],
        timeout: 50000
      });
    } catch (error) {
      logger?.warn('host restart failed', { message: error.message, code: error.code });
      throw fail('HOST_RESTART_FAILED', `重启 ZCode 失败：${error.message}`, {
        retryable: true,
        details: { code: error.code || null, ...(error.details ? { cause: error.details } : {}) }
      });
    }

    detector.invalidate();
    let status = null;
    const deadline = Date.now() + 12000;
    do {
      try {
        status = await detector.detect({ force: true });
        lastStatus = status;
      } catch (error) {
        logger?.warn('host detect after restart failed', { message: error.message });
      }
      if (status && status.ready) break;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 700));
    } while (true);

    logger?.info('host restarted', {
      pid: result.pid || null,
      forced: Array.isArray(result.forced) ? result.forced.length : 0,
      ready: !!(status && status.ready)
    });

    let reapplied = null;
    if (reapply && state && state.theme && status && status.ready) {
      const wasPaused = !!state.paused;
      try {
        reapplied = await apply({ theme: state.theme, params: state.params || {} });
        if (wasPaused) await setPaused(true);
        reapplied = { ...reapplied, paused: wasPaused };
        logger?.info('host theme reapplied after restart', { themeId: state.theme.id, paused: wasPaused });
      } catch (error) {
        logger?.warn('host theme reapply after restart failed', { message: error.message });
        reapplied = null;
      }
    }

    return { restart: result, status: lastStatus, reapplied };
  }

  function resolveMedia(theme) {
    if (!theme || !theme.media || !theme.media.file) return null;
    const root = theme.source === 'builtin' ? paths.builtin : paths.user;
    const file = path.resolve(root, theme.id, theme.media.file);
    const relative = path.relative(path.resolve(root), file);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      throw fail('MEDIA_INVALID', `主题媒体路径越界：${file}`);
    }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
      throw fail('MEDIA_INVALID', `主题媒体文件不存在：${file}`);
    }
    const stat = fs.statSync(file);
    if (stat.size > 300 * 1024 * 1024) {
      throw fail('MEDIA_INVALID', `主题媒体文件过大：${stat.size} bytes`);
    }

    let posterUrl = null;
    let posterFile = null;
    if (theme.media.kind === 'video' && theme.media.thumb) {
      const poster = path.join(path.dirname(file), theme.media.thumb);
      if (fs.existsSync(poster)) {
        posterFile = poster;
        posterUrl = pathToFileURL(poster).href;
      }
    }

    // 减弱动效：视频主题不放 `<video>`，改用已经抽好的首帧静图；没有首帧就退回渐变底。
    if (getPreferences().reducedMotion && theme.media.kind === 'video') {
      if (!posterFile) return null;
      const still = fs.statSync(posterFile);
      return {
        kind: 'image',
        file: posterFile,
        url: posterUrl,
        bytes: still.size,
        sha256: null,
        posterFile,
        posterUrl: null,
        degradedFrom: 'video'
      };
    }

    return {
      kind: theme.media.kind === 'video' ? 'video' : 'image',
      file,
      url: pathToFileURL(file).href,
      bytes: stat.size,
      sha256: theme.media.sha256 || null,
      posterFile,
      posterUrl
    };
  }

  async function writeCss(css, themeId) {
    const dir = backupDir();
    const finalPath = path.join(dir, `apply-${stamp()}-${themeId}.css`);
    const tempPath = path.join(dir, `.css-${crypto.randomUUID()}.tmp`);
    fs.writeFileSync(tempPath, css, 'utf8');
    try {
      const result = await runPowerShellJson('theme/css-file.ps1', {
        appRoot,
        args: ['-ContentFile', tempPath, '-Dest', finalPath],
        timeout: 15000
      });
      return { path: result.path, bytes: result.bytes, sha256: result.sha256 };
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }

  async function validateCss(cssPath) {
    try {
      const extra = Array.isArray(profile.cssSelectors) ? profile.cssSelectors.join('|') : '';
      const args = ['-Path', cssPath];
      if (extra) args.push('-ExtraSelectors', extra);
      return await runPowerShellJson('theme/validate-css.ps1', {
        appRoot,
        args,
        timeout: 15000
      });
    } catch (error) {
      throw fail('HOST_INJECTION_REJECTED', `注入样式未通过白名单校验：${error.message}`, {
        details: error.details
      });
    }
  }

  async function analyzeLuminance(media, mode) {
    const source = !media ? null : media.kind === 'image' ? media.file : media.posterFile || null;
    if (!source) return fallbackLuminance(mode);
    try {
      const hash = media.kind === 'image' && media.sha256 ? media.sha256 : await hashFile(source);
      const cacheDir = paths && paths.cache ? path.join(paths.cache, 'luminance') : null;
      const cacheFile = cacheDir ? path.join(cacheDir, `${hash}.json`) : null;
      if (cacheFile && fs.existsSync(cacheFile)) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
        if (cached && cached.ok !== false) return normalizeLuminance(cached);
      }
      const raw = await runPowerShellJson('theme/luminance.ps1', {
        appRoot,
        args: ['-Path', source],
        timeout: 20000
      });
      const luminance = normalizeLuminance(raw);
      if (cacheFile) {
        fs.mkdirSync(cacheDir, { recursive: true });
        fs.writeFileSync(cacheFile, JSON.stringify(luminance), 'utf8');
      }
      return luminance;
    } catch (error) {
      logger?.warn('luminance analysis failed', { message: error.message });
      return fallbackLuminance(mode);
    }
  }

  async function colorTokens(params, luminance, mode) {
    try {
      return await runPowerShellJson('theme/color.ps1', {
        appRoot,
        args: [
          '-Accent', params.accent,
          '-Mode', mode,
          '-Panel', String(params.panel),
          '-Bubble', String(params.bubble),
          '-Mean', String(luminance.mean),
          '-Center', String(luminance.center),
          '-P15', String(luminance.p15),
          '-P75', String(luminance.p75),
          '-P85', String(luminance.p85),
          '-P90', String(luminance.p90),
          '-P99', String(luminance.p99),
          '-Highlight', String(luminance.highlight)
        ],
        timeout: 15000
      });
    } catch (error) {
      throw fail('HOST_INJECTION_REJECTED', `配色计算失败：${error.message}`, { details: error.details });
    }
  }

  async function writeJsonRecord(kind, name, data) {
    const dir = backupDir();
    const tempPath = path.join(dir, `.${kind}-${crypto.randomUUID()}.json`);
    fs.writeFileSync(tempPath, JSON.stringify(data, null, 2), 'utf8');
    try {
      return await runPowerShellJson('backup/write.ps1', {
        appRoot,
        args: ['-Dir', dir, '-Kind', kind, '-DataFile', tempPath, '-Name', name],
        timeout: 15000
      });
    } finally {
      fs.rmSync(tempPath, { force: true });
    }
  }

  async function hostHash() {
    const result = await runPowerShellJson('backup/host-hash.ps1', {
      appRoot,
      args: ['-HostRoot', profile.hostRoot],
      timeout: 90000
    });
    return {
      aggregate: result.aggregate,
      count: result.count,
      bytes: result.bytes,
      complete: result.complete,
      checkedAt: new Date().toISOString()
    };
  }

  async function takeBaseline(status) {
    const session = await openSession(status);
    try {
      return await session.evaluate(snapshotExpression());
    } finally {
      session.close();
    }
  }

  async function apply({ theme, params }) {
    const status = await requireStatus({ force: true });
    const merged = normalizeThemeParams({ ...(theme.params || {}), ...(params || {}) });
    const media = resolveMedia(theme);
    const mode = status.page && status.page.dark ? 'dark' : 'light';

    const luminance = await analyzeLuminance(media, mode);
    const tokenBundle = await colorTokens(merged, luminance, mode);
    const tokens = tokenBundle[mode] || tokenBundle;
    const tokensByMode = {
      light: tokenBundle.light || tokens,
      dark: tokenBundle.dark || tokens
    };
    const css = buildThemeCss({ params: merged, media, tokens, tokensByMode, mode });
    const cssFile = await writeCss(css, theme.id);
    const validation = await validateCss(cssFile.path);

    const reuseBaseline = !!(state && state.baseline && state.targetId === status.target.id);
    const baselineMode = reuseBaseline && state.baselineMode ? state.baselineMode : mode;
    let baseline = reuseBaseline ? state.baseline : null;
    let hash = state && state.hostHash && state.hostHash.targetId === status.target.id ? state.hostHash : null;
    let snapshot = state && state.snapshot ? state.snapshot : null;

    if (!baseline) {
      baseline = await takeBaseline(status);
      if (!baseline || !baseline.ready) {
        throw fail('HOST_NOT_READY', 'ZCode 页面在注入前未就绪');
      }
    }

    if (!hash && profile.hashHostFiles !== false) {
      try {
        hash = { ...(await hostHash()), targetId: status.target.id };
      } catch (error) {
        logger?.warn('host file hash failed', { message: error.message });
        hash = null;
      }
    }

    if (!snapshot) {
      const capturedAt = new Date().toISOString();
      const data = {
        schema: 'backdropbuddy.snapshot/1',
        host: 'zcode',
        capturedAt,
        themeId: theme.id,
        themeName: theme.name,
        params: merged,
        target: status.target ? {
          id: status.target.id,
          url: status.target.url,
          fingerprint: status.target.fingerprint
        } : null,
        baseline,
        hostHash: hash
      };
      const record = await writeJsonRecord('snapshot', `snapshot-${stamp()}-${theme.id}.json`, data);
      snapshot = { path: record.path, sha256: record.sha256, capturedAt, data };
    }

    let outcomes;
    try {
      outcomes = await withTargets(status, async (session) => {
        await session.evaluate(injectionExpression({
          css,
          themeId: theme.id,
          media: media ? { kind: media.kind, url: media.url, poster: media.posterUrl } : null
        }), { timeoutMs: 12000 });
        return session.evaluate(verifyExpression());
      });
    } catch (error) {
      try { await removeAll(status); } catch { /* best effort rollback */ }
      throw fail('HOST_INJECTION_REJECTED', `注入失败，已回滚：${error.message}`);
    }

    // 每个窗口按自己此刻的明暗模式校验，否则宿主切过明暗就会误判注入失败
    const checked = outcomes.map(({ target, result }) => ({
      targetId: target.id,
      ...verificationOf(result, { themeId: theme.id, media, tokensByMode, tokens, mode }),
      result
    }));
    const failedTarget = checked.find((entry) => !entry.ok) || null;
    const primary = checked[0] || null;

    if (failedTarget) {
      try {
        await removeAll(status);
      } catch { /* best effort rollback */ }
      throw fail('HOST_INJECTION_REJECTED', checked.length > 1
        ? `${checked.length - checked.filter((entry) => entry.ok).length} 个窗口校验失败，已回滚`
        : '注入后校验失败，已回滚', {
        details: {
          injected: true,
          verified: failedTarget.result,
          expectedBackground: failedTarget.expectedBackground,
          targets: checked.map((entry) => ({ targetId: entry.targetId, mode: entry.mode, ok: entry.ok, background: entry.result && entry.result.background }))
        }
      });
    }

    const modeNow = primary ? primary.mode : mode;
    const expectedBackground = primary ? primary.expectedBackground : normalizeColor((tokensByMode[modeNow] || tokens).panel);
    state = {
      theme,
      params: merged,
      tokens,
      tokensByMode,
      baseline,
      baselineMode,
      hostHash: hash,
      snapshot,
      targetId: status.target.id,
      targetIds: checked.map((entry) => entry.targetId),
      mediaKind: media ? media.kind : 'none',
      cssPath: cssFile.path,
      cssSha256: validation.sha256 || cssFile.sha256,
      paused: false,
      appliedAt: new Date().toISOString()
    };
    persistState();
    recordAudit({
      verdict: 'applied',
      reason: '主题已应用',
      themeId: theme.id,
      pointer: { themeId: theme.id, paused: false }
    });

    detector.invalidate();
    logger?.info('host applied', {
      themeId: theme.id,
      target: status.target.fingerprint,
      windows: checked.length,
      cssBytes: cssFile.bytes,
      media: state.mediaKind,
      hostFiles: hash ? hash.aggregate : null
    });

    return {
      dryRun: false,
      injected: true,
      host: status.host,
      themeId: theme.id,
      name: theme.name,
      target: {
        id: status.target.id,
        url: status.target.url,
        fingerprint: status.target.fingerprint
      },
      page: status.page,
      media: media ? { kind: media.kind, bytes: media.bytes, poster: !!media.posterUrl, degraded: media.degradedFrom || null } : null,
      css: { path: cssFile.path, bytes: cssFile.bytes, sha256: validation.sha256 || cssFile.sha256 },
      snapshot: { path: snapshot.path, sha256: snapshot.sha256, capturedAt: snapshot.capturedAt },
      hostFiles: hash ? { aggregate: hash.aggregate, count: hash.count, bytes: hash.bytes, complete: hash.complete } : null,
      luminance: { ...luminance, ...(tokenBundle.luminance || {}) },
      verification: {
        style: primary ? primary.result.style : null,
        layer: primary ? primary.result.layer : null,
        video: primary ? primary.result.video : null,
        background: primary ? primary.result.background : null,
        themed: primary ? primary.result.themed : null
      },
      windows: {
        count: checked.length,
        ids: checked.map((entry) => entry.targetId),
        modes: checked.map((entry) => entry.mode)
      }
    };
  }

  async function setPaused(paused) {
    if (!state) throw fail('BAD_PARAMS', 'no theme is applied');
    const status = await requireStatus({ force: false });
    const outcomes = await withTargets(status, (session) => session.evaluate(pauseExpression(paused)));

    const toggled = (result) => (paused
      ? result.paused === true && result.styleDisabled === true && result.layerVisible === false
      : result.paused === false && result.styleDisabled === false);
    const missed = outcomes.filter(({ result }) => !toggled(result || {}));
    if (!outcomes.length || missed.length) {
      throw fail('HOST_UNREACHABLE', paused ? '暂停未生效' : '继续未生效', {
        details: { windows: outcomes.length, failed: missed.map(({ target }) => target.id) }
      });
    }

    const perTarget = outcomes.map(({ target, result }) => {
      // 每个窗口按自己此刻的模式校验；基线是在某个模式下抓的，宿主切过明暗之后"原样"已经变了，这时不下结论
      const modeNow = result && result.dark != null
        ? (result.dark ? 'dark' : 'light')
        : (status.page && status.page.dark ? 'dark' : 'light');
      const modeTokens = (state.tokensByMode && state.tokensByMode[modeNow]) || state.tokens;
      const baselineComparable = !state.baselineMode || state.baselineMode === modeNow;
      const reported = result ? String(result.background || '') : '';
      // 宿主没有背景 token 时读不到色值，就不对配色下结论（注入是否生效看 style/layer 的开关状态）
      const expected = !reported ? null : (paused
        ? (state.baseline && state.baseline.tokens && baselineComparable
          ? normalizeColor(state.baseline.tokens.background)
          : null)
        : normalizeColor(modeTokens.panel));
      return {
        targetId: target.id,
        mode: modeNow,
        background: result ? result.background : null,
        tokenMatch: expected ? normalizeColor(reported) === expected : null
      };
    });
    const primary = perTarget[0];
    const tokenMatch = perTarget.some((entry) => entry.tokenMatch === false)
      ? false
      : (perTarget.every((entry) => entry.tokenMatch === null) ? null : true);

    state.paused = paused;
    persistState();
    detector.invalidate();
    logger?.info(paused ? 'host paused' : 'host resumed', {
      themeId: state.theme.id,
      tokenMatch,
      windows: perTarget.length
    });

    return {
      paused,
      verified: tokenMatch !== false,
      tokenMatch,
      background: primary ? primary.background : null,
      layerVisible: outcomes[0] ? outcomes[0].result.layerVisible : null,
      windows: { count: perTarget.length, ids: perTarget.map((entry) => entry.targetId), modes: perTarget.map((entry) => entry.mode) }
    };
  }

  async function pause() {
    return setPaused(true);
  }

  async function resume() {
    return setPaused(false);
  }

  async function reset() {
    if (!state) throw fail('BAD_PARAMS', 'no theme is applied');
    const theme = state.theme;
    const wasPaused = state.paused;
    const result = await apply({ theme, params: {} });
    if (wasPaused) await setPaused(true);
    return { ...result, reset: true, paused: wasPaused };
  }

  async function restore() {
    let status = null;
    try {
      status = await detector.detect({ force: true });
      lastStatus = status;
    } catch (error) {
      logger?.warn('host detect failed during restore', { message: error.message });
    }

    const hostRunning = !!(status && status.running);
    if (state && hostRunning && (!status.ready || !status.target)) {
      throw fail('HOST_NOT_READY', status.reason || '无法连接 ZCode 页面，未执行恢复', { retryable: true });
    }

    let verification = null;
    if (hostRunning && status.ready && status.target) {
      const outcomes = await withTargets(status, async (session) => ({
        removed: await session.evaluate(removeExpression()),
        after: await session.evaluate(verifyExpression())
      }));
      const primary = outcomes[0] ? outcomes[0].result : null;
      verification = primary
        ? {
          removed: primary.removed,
          after: primary.after,
          windows: outcomes.map(({ target, result }) => ({ targetId: target.id, after: result.after }))
        }
        : null;
    }

    const everyAfter = verification && verification.windows
      ? verification.windows.map((entry) => entry.after)
      : (verification ? [verification.after] : []);
    const isClean = (after) => !after || (after.style === false && after.layer === false && after.video === false && after.themed === null);
    const dirty = everyAfter.filter((after) => !isClean(after));
    const after = verification ? verification.after : null;
    const clean = dirty.length === 0;
    if (!clean) {
      throw fail('TRANSACTION_FAILED', `恢复后${dirty.length > 1 ? `的 ${dirty.length} 个窗口里` : ''}仍检测到 BackdropBuddy 注入元素`, { details: verification });
    }

    let tokenMatch = null;
    for (const entry of everyAfter) {
      if (!state || !state.baseline || !state.baseline.tokens || !entry) continue;
      if (!String(entry.background || '')) continue;
      const modeNow = entry.dark != null ? (entry.dark ? 'dark' : 'light') : null;
      if (modeNow && state.baselineMode && state.baselineMode !== modeNow) continue;
      const match = normalizeColor(entry.background) === normalizeColor(state.baseline.tokens.background);
      if (match === false) { tokenMatch = false; break; }
      tokenMatch = true;
    }

    let hostFiles = null;
    if (state && state.hostHash && profile.hashHostFiles !== false) {
      try {
        const current = await hostHash();
        hostFiles = {
          before: state.hostHash.aggregate,
          after: current.aggregate,
          unchanged: current.aggregate === state.hostHash.aggregate
        };
      } catch (error) {
        logger?.warn('host file hash failed during restore', { message: error.message });
      }
    }

    const result = {
      dryRun: false,
      restored: true,
      verified: !after || (clean && tokenMatch !== false),
      hostRunning,
      target: status && status.target ? {
        id: status.target.id,
        url: status.target.url,
        fingerprint: status.target.fingerprint
      } : null,
      verification: after ? {
        style: after.style,
        layer: after.layer,
        video: after.video,
        themed: after.themed,
        background: after.background,
        tokenMatch
      } : null,
      hostFiles,
      previousThemeId: state ? state.theme.id : null,
      snapshot: state && state.snapshot ? state.snapshot.path : null
    };

    if (state) {
      try {
        await writeJsonRecord('restore', `restore-${stamp()}-${state.theme.id}.json`, {
          schema: 'backdropbuddy.restore/1',
          host: 'zcode',
          restoredAt: new Date().toISOString(),
          themeId: state.theme.id,
          target: result.target,
          verification: result.verification,
          hostFiles,
          snapshot: result.snapshot
        });
      } catch (error) {
        logger?.warn('restore report write failed', { message: error.message });
      }
    }

    forgetState();
    recordAudit({
      verdict: 'clean',
      reason: '已恢复原貌',
      pointer: { themeId: null, paused: false },
      force: true
    });
    detector.invalidate();
    logger?.info('host restored', {
      previousThemeId: result.previousThemeId,
      verified: result.verified,
      hostFiles: hostFiles ? hostFiles.unchanged : null
    });

    return result;
  }

  // 宿主新开的渲染窗口默认是"素"的：已经挂着主题时，把皮肤补打到这些窗口上，
  // 让用户不用为了多开一个窗口而重新应用一次。
  async function syncWindows(status) {
    if (!state || !state.theme) return null;

    // 缓存的 detect 结果里没有新开的窗口，所以只要宿主给了刷新列表的能力就重新取一次
    let list = targetList(status);
    if (typeof detector.targets === 'function') {
      try {
        const fresh = await detector.targets();
        if (Array.isArray(fresh) && fresh.length) list = fresh;
      } catch (error) {
        logger?.warn('window list refresh failed', { message: error.message });
      }
    }
    if (list.length < 2) return null;

    let probes;
    try {
      probes = await withTargets(list, (session) => session.evaluate(verifyExpression()));
    } catch (error) {
      logger?.warn('window sync probe failed', { message: error.message });
      return null;
    }
    const missing = probes.filter(({ result }) => !result || result.themed !== state.theme.id);
    if (!missing.length) return null;

    let media = null;
    try {
      media = resolveMedia(state.theme);
    } catch (error) {
      logger?.warn('window sync skipped: media unavailable', { message: error.message });
      return null;
    }

    const synced = [];
    for (const entry of missing) {
      const entryMode = entry.result && entry.result.dark != null
        ? (entry.result.dark ? 'dark' : 'light')
        : (status.page && status.page.dark ? 'dark' : 'light');
      const css = buildThemeCss({
        params: state.params,
        media,
        tokens: state.tokens,
        tokensByMode: state.tokensByMode || { light: state.tokens, dark: state.tokens },
        mode: entryMode
      });
      const session = await openSession(entry.target);
      try {
        await session.evaluate(injectionExpression({
          css,
          themeId: state.theme.id,
          media: media ? { kind: media.kind, url: media.url, poster: media.posterUrl } : null
        }), { timeoutMs: 12000 });
        const verified = await session.evaluate(verifyExpression());
        const ok = verificationOf(verified, {
          themeId: state.theme.id,
          media,
          tokensByMode: state.tokensByMode || { light: state.tokens, dark: state.tokens },
          tokens: state.tokens,
          mode: entryMode
        });
        if (!ok.ok) {
          try { await session.evaluate(removeExpression()); } catch { /* ignore */ }
          logger?.warn('window sync verification failed', { target: entry.target.id, mode: entryMode });
          continue;
        }
        if (Array.isArray(state.targetIds) && !state.targetIds.includes(entry.target.id)) state.targetIds.push(entry.target.id);
        synced.push({ targetId: entry.target.id, mode: entryMode });
      } catch (error) {
        try { await session.evaluate(removeExpression()); } catch { /* ignore */ }
        logger?.warn('window sync injection failed', { target: entry.target.id, message: error.message });
      } finally {
        session.close();
      }
    }

    if (!synced.length) return null;
    persistState();
    logger?.info('windows synced', { themeId: state.theme.id, synced: synced.length });
    return { total: list.length, synced };
  }

  async function probeInjection(status) {
    const session = await openSession(status);
    try {
      return await session.evaluate(verifyExpression());
    } finally {
      session.close();
    }
  }

  async function verifyAdopted(pointer, themeId) {
    let status = null;
    try {
      status = await detector.detect({ force: true });
      lastStatus = status;
    } catch (error) {
      logger?.warn('host detect failed during adoption', { message: error.message });
      return { cleared: false, reason: 'detect-failed' };
    }

    if (!status || !status.running || !status.ready || !status.target) {
      return { cleared: false, reason: 'host-unavailable' };
    }

    let verified = null;
    try {
      verified = await probeInjection(status);
    } catch (error) {
      logger?.warn('host adoption verify failed', { message: error.message });
      return { cleared: false, reason: 'verify-failed' };
    }

    const pageThemeId = verified ? verified.themed : null;
    if (!pageThemeId || pageThemeId !== themeId) {
      forgetState();
      try { pointer.clear(); } catch { /* pointer remains readable either way */ }
      logger?.warn('adopted theme is no longer injected; cleared runtime state', {
        themeId,
        pageThemeId: pageThemeId || null,
        reason: pageThemeId ? 'page-mismatch' : 'page-clean'
      });
      return { cleared: true, reason: pageThemeId ? 'page-mismatch' : 'page-clean', pageThemeId: pageThemeId || null };
    }

    if (state) state.targetId = status.target.id;
    persistState();
    logger?.info('adopted theme verified on host', { themeId, target: status.target.fingerprint });
    return { cleared: false, reason: 'verified' };
  }

  function adopt(pointer) {
    if (state) return { adopted: false, reason: 'already-applied', ready: null };
    if (!runtime) return { adopted: false, reason: 'no-runtime-store', ready: null };

    const pointerValue = pointer && typeof pointer.read === 'function' ? pointer.read() : null;
    if (!pointerValue || !pointerValue.activeThemeId) {
      runtime.clear();
      return { adopted: false, reason: 'pointer-empty', ready: null };
    }

    const saved = runtime.read();
    if (!saved || !saved.theme || saved.theme.id !== pointerValue.activeThemeId) {
      if (saved) runtime.clear();
      return { adopted: false, reason: 'runtime-missing', ready: null };
    }

    state = saved;
    state.paused = !!saved.paused;
    logger?.info('adopted runtime state', { themeId: state.theme.id, paused: state.paused });

    return {
      adopted: true,
      themeId: state.theme.id,
      paused: state.paused,
      ready: verifyAdopted(pointer, state.theme.id)
    };
  }

  // 启动期审计：把「记录里的活动主题」和「宿主页面上实际存在的注入层」对齐。
  // adoption 传入 adopt() 的结果时直接采信，避免重复探测。
  async function audit({ pointerValue = null, adoption = null } = {}) {
    lastSync = null;
    const activeThemeId = pointerValue && pointerValue.activeThemeId ? pointerValue.activeThemeId : null;
    const pointer = { themeId: activeThemeId, paused: !!(pointerValue && pointerValue.paused) };

    let status = lastStatus;
    if (!status) {
      try {
        status = await detect({ force: false });
      } catch (error) {
        logger?.warn('startup audit detect failed', { message: error.message });
        status = null;
      }
    }

    if (!status) return recordAudit({ verdict: 'unverified', reason: '宿主状态未知', themeId: activeThemeId, pointer });

    if (status.owner && status.owner.matchesExe === false) {
      return recordAudit({
        verdict: 'port-conflict',
        reason: `调试端口 ${status.port} 被其他进程占用：${status.owner.path || '未知进程'} (PID ${status.owner.pid})`,
        action: 'redetect',
        themeId: activeThemeId,
        pointer
      });
    }

    if (!status.running) {
      return activeThemeId
        ? recordAudit({ verdict: 'host-offline', reason: 'ZCode 未运行，主题记录保留', themeId: activeThemeId, pointer })
        : recordAudit({ verdict: 'clean', reason: 'ZCode 未运行', pointer });
    }

    if (!status.ready || !status.target) {
      return recordAudit({ verdict: 'host-unready', reason: status.reason || 'ZCode 页面尚未就绪', themeId: activeThemeId, pointer });
    }

    lastSync = await syncWindows(status);
    const outcome = adoption && adoption.outcome ? adoption.outcome : null;
    if (outcome && outcome.cleared) {
      const mismatch = outcome.reason === 'page-mismatch';
      return recordAudit({
        verdict: mismatch ? 'mismatch-layer' : 'stale-pointer',
        reason: mismatch
          ? `ZCode 上是另一个主题的残留（${outcome.pageThemeId || '未知'}），本机记录已清除`
          : '上次应用的主题已不在 ZCode 上（宿主重启或页面刷新），本机记录已清除',
        action: 'reapply',
        themeId: activeThemeId,
        previousThemeId: outcome.pageThemeId || null,
        page: { themed: outcome.pageThemeId || null },
        pointer
      });
    }

    if (adoption && adoption.adopted && outcome && outcome.reason === 'verified') {
      return recordAudit({
        verdict: 'adopted',
        reason: '已接管上次应用的主题',
        themeId: activeThemeId,
        page: { themed: activeThemeId },
        pointer
      });
    }

    let page = null;
    try {
      page = await probeInjection(status);
    } catch (error) {
      return recordAudit({
        verdict: 'unverified',
        reason: '无法读取注入状态：' + error.message,
        themeId: activeThemeId,
        pointer
      });
    }

    const themed = page && page.themed ? page.themed : null;
    const pageInfo = {
      styled: !!(page && page.style),
      layer: !!(page && page.layer),
      video: !!(page && page.video),
      themed
    };

    if (!activeThemeId && themed) {
      return recordAudit({
        verdict: 'orphan-layer',
        reason: `ZCode 上仍保留着主题「${themed}」的皮肤，但本机没有活动主题记录`,
        action: 'restore',
        themeId: themed,
        page: pageInfo,
        pointer
      });
    }

    if (!activeThemeId) {
      return recordAudit({ verdict: 'clean', reason: 'ZCode 干净，无残留注入', page: pageInfo, pointer });
    }

    if (themed === activeThemeId) {
      return recordAudit({ verdict: 'adopted', reason: '已接管上次应用的主题', themeId: activeThemeId, page: pageInfo, pointer });
    }

    if (themed) {
      return recordAudit({
        verdict: 'mismatch-layer',
        reason: `ZCode 上的主题（${themed}）与本机记录（${activeThemeId}）不一致`,
        action: 'reapply',
        themeId: activeThemeId,
        previousThemeId: themed,
        page: pageInfo,
        pointer
      });
    }

    return recordAudit({
      verdict: 'stale-pointer',
      reason: '上次应用的主题已不在 ZCode 上（宿主重启或页面刷新）',
      action: 'reapply',
      themeId: activeThemeId,
      page: pageInfo,
      pointer
    });
  }

  // 只问一句"页面此刻是深还是浅"，给调度规则用；不做宿主探测
  async function observeMode() {
    const status = lastStatus || null;
    const target = status && status.target;
    if (!target) return null;
    try {
      const session = await openSession(target);
      try {
        const probe = await session.evaluate(verifyExpression());
        return probe && probe.dark != null ? !!probe.dark : null;
      } finally {
        session.close();
      }
    } catch (error) {
      logger?.warn('host mode observation failed', { message: error.message });
      return null;
    }
  }

  function status() {
    const base = lastStatus || {
      host: profile.id,
      installed: fs.existsSync(profile.exe),
      running: false,
      ready: false,
      supported: false,
      path: profile.exe,
      port: profile.port,
      ownership: { verified: false },
      target: null,
      targets: [],
      page: null,
      reason: 'host not detected yet',
      errorCode: 'HOST_NOT_FOUND'
    };

    return {
      ...base,
      hostName: profile.name,
      recovery: lastAudit,
      applied: state ? {
        themeId: state.theme.id,
        name: state.theme.name,
        mediaKind: state.mediaKind,
        paused: state.paused,
        windows: Array.isArray(state.targetIds) ? state.targetIds.length : (state.targetId ? 1 : 0),
        targetFingerprint: state.snapshot && state.snapshot.data && state.snapshot.data.target
          ? state.snapshot.data.target.fingerprint
          : null,
        snapshot: state.snapshot ? state.snapshot.path : null,
        css: state.cssPath,
        hostFiles: state.hostHash ? state.hostHash.aggregate : null,
        appliedAt: state.appliedAt
      } : null
    };
  }

  return {
    detect,
    status,
    observeMode,
    adopt,
    audit,
    recovery: () => lastAudit,
    restart,
    apply,
    restore,
    pause,
    resume,
    reset,
    get applied() { return state ? state.theme : null; },
    get paused() { return !!(state && state.paused); },
    get params() { return state ? state.params : null; }
  };
}
