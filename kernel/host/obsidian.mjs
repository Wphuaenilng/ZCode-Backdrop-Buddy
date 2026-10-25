import path from 'node:path';
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

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));

const hexToRgba = (hex, alpha) => {
  const value = String(hex || '#6f9275').replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
};

export const OBSIDIAN_HOST = Object.freeze({
  id: 'obsidian',
  name: 'Obsidian',
  defaultPath: 'F:\\shop\\Obsidian\\Obsidian.exe',
  defaultPort: 9334,
  rendererPattern: /^app:\/\/obsidian\.md\//,
  readySelector: '.app-container',
  readyClass: 'obsidian-app',
  loadingSelector: null,
  testidSelector: null,
  rootSelector: '.app-container',
  darkClass: 'theme-dark',
  darkTarget: 'body',
  tokenTarget: 'body',
  themedTarget: 'body',
  backgroundVar: '--background-primary',
  foregroundVar: '--text-normal',
  minVersion: '1.0.0',
  hashHostFiles: false,
  versionExpression: `(document.title.match(/Obsidian\\s+([0-9.]+)/) || [])[1] || null`,
  // 注入 CSS 的选择器白名单（validator 只放行这里列出的选择器）
  cssSelectors: [
    'body.theme-light',
    'body.theme-dark',
    'body.theme-dark .workspace-tab-header-container',
    'body.theme-dark .view-header',
    'body.theme-dark .status-bar',
    'body.theme-dark .workspace-ribbon',
    'body.theme-dark .titlebar',
    '.app-container',
    '.horizontal-main-container',
    '.workspace',
    '.workspace-split',
    '.workspace-tabs',
    '.workspace-leaf',
    '.workspace-leaf-content',
    '.workspace-leaf-resize-handle',
    '.workspace-tab-header-container',
    '.workspace-tab-header.is-active',
    '.workspace-ribbon.mod-left',
    '.workspace-ribbon.mod-right',
    '.view-content',
    '.view-header',
    '.status-bar',
    '.titlebar',
    '.markdown-preview-view',
    '.markdown-source-view',
    '.cm-editor',
    '.cm-scroller'
  ],
  ...DEFAULT_IDS
});

export function resolveProfile(env = process.env) {
  const exe = env.OBSIDIAN_PATH || OBSIDIAN_HOST.defaultPath;
  return {
    ...OBSIDIAN_PROFILE,
    exe,
    hostRoot: path.dirname(exe),
    port: Number(env.OBSIDIAN_PORT) || OBSIDIAN_HOST.defaultPort
  };
}

export function versionParts(value) {
  const match = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), text: `${match[1]}.${match[2]}.${match[3]}` };
}

export function isSupportedVersion(value) {
  const parts = versionParts(value);
  if (!parts) return { ok: false, reason: '无法读取 Obsidian 版本号' };
  const [major] = OBSIDIAN_HOST.minVersion.split('.').map(Number);
  if (parts.major < major) return { ok: false, reason: `Obsidian ${parts.text} 不受支持（需要 >= ${OBSIDIAN_HOST.minVersion}）` };
  return { ok: true, version: parts.text };
}

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

// Obsidian 的主题面是 body 上的一组 CSS 变量；映射沿用同一套亮度自适应 token。
function tokenVars(t, p) {
  return [
    `  --background-primary: ${t.panel} !important;`,
    `  --background-primary-alt: ${t.sidebar} !important;`,
    `  --background-secondary: ${t.sidebar} !important;`,
    `  --background-secondary-alt: ${t.header} !important;`,
    `  --background-modifier-border: ${t.border} !important;`,
    `  --background-modifier-hover: ${t.surfaceHover} !important;`,
    `  --background-modifier-active-hover: ${t.selected} !important;`,
    `  --background-modifier-form-field: ${t.input} !important;`,
    `  --text-normal: ${t.foreground} !important;`,
    `  --text-muted: ${t.foregroundSubtle} !important;`,
    `  --text-faint: ${t.foregroundSubtlest} !important;`,
    `  --text-on-accent: ${t.contrast} !important;`,
    `  --interactive-accent: ${t.accentSoft} !important;`,
    `  --interactive-accent-hover: ${t.accentSoft} !important;`,
    `  --tab-background-active: ${t.card} !important;`,
    `  --titlebar-background: transparent !important;`,
    `  --titlebar-background-focused: transparent !important;`,
    `  --ribbon-background: ${t.header} !important;`,
    `  --status-bar-background: ${t.header} !important;`,
    `  --bb-dim: ${t.dim};`,
    `  --bb-safe: ${safeOverlay(p, t)};`
  ].join('\n');
}

export function buildThemeCss({ params, media, tokens, tokensByMode, mode = 'light' }) {
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

  return [
    'body.theme-light {',
    tokenVars(light, p),
    `  --bb-backdrop-image: ${backdropImage('light')};`,
    '}',
    'body.theme-dark {',
    tokenVars(dark, p),
    `  --bb-backdrop-image: ${backdropImage('dark')};`,
    '}',
    ':root {',
    `  --bb-accent: ${p.accent};`,
    `  --bb-backdrop-image: ${backdropImage('light')};`,
    '}',
    backdropRules({
      p: OBSIDIAN_HOST,
      imageLine,
      position,
      scale,
      blur,
      dim: 'var(--bb-dim)',
      safe: 'var(--bb-safe)'
    }),
    '.app-container, .horizontal-main-container, .workspace, .workspace-split,',
    '.workspace-tabs, .workspace-leaf, .workspace-leaf-content, .view-content,',
    '.markdown-preview-view, .markdown-source-view, .cm-editor, .cm-scroller {',
    '  background: transparent !important;',
    '}',
    '.workspace-tab-header-container, .view-header, .status-bar,',
    '.workspace-ribbon.mod-left, .workspace-ribbon.mod-right, .titlebar {',
    `  background: ${hexToRgba('#ffffff', 0.16)} !important;`,
    `  backdrop-filter: blur(${blur}) saturate(1.05);`,
    '}',
    'body.theme-dark .workspace-tab-header-container, body.theme-dark .view-header,',
    'body.theme-dark .status-bar, body.theme-dark .workspace-ribbon, body.theme-dark .titlebar {',
    `  background: ${hexToRgba('#000000', 0.18)} !important;`,
    '}',
    '.workspace-tab-header.is-active { background: var(--tab-background-active) !important; }',
    '.workspace-leaf-resize-handle { background: var(--background-modifier-border) !important; }',
    ''
  ].join('\n');
}

export const fingerprintExpression = () => genericFingerprint(OBSIDIAN_HOST);
export const snapshotExpression = () => genericSnapshot(OBSIDIAN_HOST);
export const injectionExpression = (args) => genericInjection(OBSIDIAN_HOST, args);
export const verifyExpression = () => genericVerify(OBSIDIAN_HOST);
export const pauseExpression = (paused) => genericPause(OBSIDIAN_HOST, paused);
export const removeExpression = () => genericRemove(OBSIDIAN_HOST);

// profile 接口：与 zcode.mjs 同形，adapter 不需要知道宿主是谁。
export const OBSIDIAN_PROFILE = Object.freeze({
  ...OBSIDIAN_HOST,
  buildThemeCss,
  normalizeThemeParams,
  isSupportedVersion,
  fingerprintExpression,
  snapshotExpression,
  injectionExpression,
  verifyExpression,
  pauseExpression,
  removeExpression
});
