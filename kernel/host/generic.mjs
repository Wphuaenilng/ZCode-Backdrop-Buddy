import { normalizeThemeParams } from './zcode.mjs';
import {
  DEFAULT_IDS,
  backdropRules,
  fingerprintExpression as genericFingerprint,
  injectionExpression as genericInjection,
  pauseExpression as genericPause,
  removeExpression as genericRemove,
  snapshotExpression as genericSnapshot,
  verifyExpression as genericVerify
} from './expressions.mjs';

// 向导生成的宿主 profile 是纯数据，由这里的通用引擎翻译成可注入的 CSS 与表达式。
export const TOKEN_NAMES = Object.freeze([
  'panel', 'sidebar', 'header', 'card', 'border', 'input', 'surface', 'surfaceHover',
  'selected', 'accentSoft', 'foreground', 'foregroundSubtle', 'foregroundSubtlest',
  'popover', 'dim', 'contrast', 'scrim'
]);

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));

const hexToRgba = (hex, alpha) => {
  const value = String(hex || '#6f9275').replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

function fallbackGradient(params, mode) {
  const first = mode === 'dark' ? '#101216' : '#ece8e0';
  const second = mode === 'dark' ? '#1b2028' : '#f8f4ec';
  return [
    `radial-gradient(circle at ${clamp(params.x, 0, 100)}% ${clamp(params.y, 0, 100)}%, ${hexToRgba(params.accent, 0.34)}, transparent 62%)`,
    `linear-gradient(155deg, ${first}, ${second})`
  ].join(', ');
}

function safeOverlay(p, t) {
  const scrim = t.scrim || t.dim;
  if (p.safe === 'left') return `linear-gradient(90deg, ${scrim}, transparent 62%)`;
  if (p.safe === 'right') return `linear-gradient(270deg, ${scrim}, transparent 62%)`;
  if (p.safe === 'center') return `radial-gradient(circle at 50% 45%, transparent 35%, ${scrim} 100%)`;
  return 'transparent';
}

export function darkSelector(data) {
  if (!data.darkClass) return null;
  return `${data.darkTarget === 'body' ? 'body' : 'html'}.${data.darkClass}`;
}

// 注入 CSS 的完整选择器清单：validator 只放行这里列出的选择器。
export function cssSelectorsFor(data) {
  const list = new Set([':root', 'html', 'body']);
  const dark = darkSelector(data);
  if (dark) list.add(dark);
  list.add(data.rootSelector);
  for (const sel of data.surfaceSelectors || []) list.add(sel);
  for (const sel of data.glassSelectors || []) {
    list.add(sel);
    if (dark) list.add(`${dark} ${sel}`);
  }
  for (const sel of data.textSelectors || []) {
    list.add(sel);
    if (dark) list.add(`${dark} ${sel}`);
  }
  return [...list].filter(Boolean);
}

function varBlock(data, t, p) {
  const lines = [];
  for (const [name, token] of Object.entries(data.varMap || {})) {
    const value = t[token];
    if (value) lines.push(`  ${name}: ${value} !important;`);
  }
  lines.push(`  --bb-dim: ${t.dim};`);
  lines.push(`  --bb-safe: ${safeOverlay(p, t)};`);
  return lines.join('\n');
}

export function buildGenericThemeCss(data, { params, media, tokens, tokensByMode, mode = 'light' }) {
  const p = normalizeThemeParams(params);
  const light = (tokensByMode && tokensByMode.light) || tokens;
  const dark = (tokensByMode && tokensByMode.dark) || tokens;
  const position = `${clamp(p.x + p.hpos * 0.3, 0, 100)}% ${p.y}%`;
  const scale = (clamp(p.zoom, 100, 220) / 100).toFixed(2);
  const size = p.mode === 'contain' ? 'contain' : p.mode === 'stretch' ? '100% 100%' : 'cover';
  const blur = p.task === 'focus' ? '26px' : p.task === 'ambient' ? '12px' : '18px';

  // 与 ZCode 同理：图 / 视频底不分模式，只有"无素材时的渐变"要各模式一份
  const backdropImage = (which) => (media && media.kind === 'image'
    ? `url("${media.url}")`
    : media && media.kind === 'video'
      ? 'none'
      : fallbackGradient(p, which));
  const sizeValue = media && media.kind === 'image' ? size : 'cover';
  const imageLine = [
    'background-image: var(--bb-backdrop-image);',
    `background-size: ${sizeValue}; background-position: ${position}; background-repeat: no-repeat;`,
    `transform: scale(${scale}); transform-origin: ${position};`,
    media && media.kind === 'video' ? 'background-color: #000;' : ''
  ].filter(Boolean).join(' ');

  const darkSel = darkSelector(data);
  const surfaces = (data.surfaceSelectors || []).join(',\n');
  const glass = (data.glassSelectors || []).join(',\n');
  const darkGlass = darkSel && data.glassSelectors && data.glassSelectors.length
    ? data.glassSelectors.map((sel) => `${dark} ${sel}`).join(',\n')
    : null;

  const rules = [
    ':root, html, body {',
    varBlock(data, light, p),
    '}'
  ];

  // 深色变量写在宿主自己的模式类上；浅色底放在 :root（html），
  // 这样 darkTarget 是 html 还是 body 都能正确覆盖到背景层。
  if (darkSel) {
    rules.push(`${darkSel} {`, varBlock(data, dark, p), `  --bb-backdrop-image: ${backdropImage('dark')};`, '}');
  }

  rules.push(
    ':root {',
    `  --bb-accent: ${p.accent};`,
    `  --bb-backdrop-image: ${backdropImage('light')};`,
    '}',
    backdropRules({
      p: { ...DEFAULT_IDS, rootSelector: data.rootSelector },
      imageLine,
      position,
      scale,
      blur,
      dim: 'var(--bb-dim)',
      safe: 'var(--bb-safe)'
    })
  );

  if (surfaces) {
    rules.push(`${surfaces} {`, '  background: transparent !important;', '}');
  }

  if (glass) {
    rules.push(
      `${glass} {`,
      `  background: ${hexToRgba('#ffffff', 0.16)} !important;`,
      `  backdrop-filter: blur(${blur}) saturate(1.05);`,
      '}'
    );
    if (darkGlass) {
      rules.push(
        `${darkGlass} {`,
        `  background: ${hexToRgba('#000000', 0.18)} !important;`,
        '}'
      );
    }
  }

  // 没有 CSS 变量的宿主只能靠选择器吃颜色：只改文字色，不动尺寸与排版
  const textSelectors = data.textSelectors || [];
  const text = textSelectors.join(',\n');
  if (text && light.foreground) {
    rules.push(`${text} {`, `  color: ${light.foreground} !important;`, '}');
    if (darkSel && dark.foreground) {
      rules.push(
        `${textSelectors.map((sel) => `${darkSel} ${sel}`).join(',\n')} {`,
        `  color: ${dark.foreground} !important;`,
        '}'
      );
    }
  }

  rules.push('');
  return rules.join('\n');
}

function versionParts(value) {
  const match = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), text: `${match[1]}.${match[2]}.${match[3]}` } : null;
}

export function createGenericProfile(data) {
  const isSupportedVersion = (value) => {
    if (!data.minVersion) return { ok: true, version: value || null };
    const parts = versionParts(value);
    if (!parts) return { ok: false, reason: `无法读取 ${data.name} 版本号` };
    const [major, minor, patch] = String(data.minVersion).split('.').map(Number);
    const tooOld = parts.major < major
      || (parts.major === major && parts.minor < minor)
      || (parts.major === major && parts.minor === minor && parts.patch < patch);
    if (tooOld) return { ok: false, reason: `${data.name} ${parts.text} 不受支持（需要 >= ${data.minVersion}）` };
    return { ok: true, version: parts.text };
  };

  return {
    ...DEFAULT_IDS,
    id: data.id,
    name: data.name,
    exe: data.exe,
    hostRoot: data.hostRoot || null,
    port: data.port,
    rendererPattern: new RegExp(data.rendererPattern),
    readySelector: data.readySelector,
    readyClass: data.readyClass || null,
    loadingSelector: null,
    testidSelector: null,
    rootSelector: data.rootSelector,
    darkClass: data.darkClass || null,
    darkTarget: data.darkTarget || 'body',
    tokenTarget: data.tokenTarget || 'body',
    themedTarget: data.themedTarget || 'body',
    backgroundVar: data.backgroundVar || '',
    foregroundVar: data.foregroundVar || '',
    textSelectors: Array.isArray(data.textSelectors) ? data.textSelectors : [],
    skipSelector: data.skipSelector || null,
    minVersion: data.minVersion || null,
    hashHostFiles: false,
    cssSelectors: cssSelectorsFor(data),
    versionExpression: `(document.title.match(/([0-9]+\\.[0-9]+\\.[0-9]+)/) || [])[1] || null`,
    buildThemeCss: (args) => buildGenericThemeCss(data, args),
    normalizeThemeParams,
    isSupportedVersion,
    fingerprintExpression: () => genericFingerprint({ ...data, ...pickExpressionFields(data) }),
    snapshotExpression: () => genericSnapshot({ ...data, ...pickExpressionFields(data) }),
    injectionExpression: (args) => genericInjection({ ...data, ...pickExpressionFields(data) }, args),
    verifyExpression: () => genericVerify({ ...data, ...pickExpressionFields(data) }),
    pauseExpression: (paused) => genericPause({ ...data, ...pickExpressionFields(data) }, paused),
    removeExpression: () => genericRemove({ ...data, ...pickExpressionFields(data) })
  };
}

// expressions.mjs 只关心这几个字段；数据 profile 里其余字段（varMap 等）与它无关。
function pickExpressionFields(data) {
  return {
    styleId: DEFAULT_IDS.styleId,
    layerId: DEFAULT_IDS.layerId,
    videoId: DEFAULT_IDS.videoId,
    readySelector: data.readySelector,
    readyClass: data.readyClass || null,
    loadingSelector: null,
    testidSelector: null,
    rootSelector: data.rootSelector,
    darkClass: data.darkClass || null,
    darkTarget: data.darkTarget || 'body',
    tokenTarget: data.tokenTarget || 'body',
    themedTarget: data.themedTarget || 'body',
    backgroundVar: data.backgroundVar,
    foregroundVar: data.foregroundVar,
    versionExpression: null
  };
}
