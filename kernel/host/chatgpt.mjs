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

// ChatGPT 桌面版（OpenAI.Codex MSIX 包）专用映射：2026-10-25 实测 token 底账（848 个 --color-*）
// 的手调子集。与向导通用引擎（generic.mjs）并存——通用映射负责"任意宿主能亮"，这里负责"这一个宿主好看"。
//
// 结构要点：
// - 明暗靠 html[data-theme]，且 --color-* 多为 var(--lightningcss-light,X)var(--lightningcss-dark,Y)
//   的拼接式 light-dark() 降级，直接覆盖语义层变量即可（值拼接只在原声明里发生）。
// - 输入框底色不走 --color-*，而在 --app-color-background-elevated-*-opaque 这族应用级变量上，
//   通用映射压不住它——这是"输入框纯黑不透明"的根因，必须点名覆盖。
// - MSIX 安装路径带版本号会漂移，exe 由 detect/restart 经 -AppxPackage 在 PowerShell 侧解析。
const CHATGPT_HOST = Object.freeze({
  id: 'chatgpt',
  name: 'ChatGPT',
  defaultPort: 9232,
  rendererPattern: /^app:\/\/-\/index\.html/,
  readySelector: '#root',
  rootSelector: '#root',
  darkAttr: 'data-theme',
  darkAttrValue: 'dark',
  darkTarget: 'html',
  tokenTarget: 'html',
  themedTarget: 'body',
  backgroundVar: '--color-surface',
  foregroundVar: '--color-text-primary',
  mediaDelivery: 'blob',
  appxPackage: 'OpenAI.Codex',
  appxExe: 'ChatGPT.exe',
  pathEnv: 'CHATGPT_PATH',
  ...DEFAULT_IDS
});

export function resolveProfile(env = process.env) {
  const exe = env.CHATGPT_PATH || '';
  return {
    ...CHATGPT_PROFILE,
    exe,
    hostRoot: exe ? path.dirname(exe) : null,
    port: Number(env.CHATGPT_PORT) || CHATGPT_HOST.defaultPort
  };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));

function hexToRgba(hex, alpha) {
  const value = String(hex || '#6f9275').replace('#', '');
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function fallbackGradient(params, mode) {
  const first = mode === 'dark' ? '#101216' : '#ece8e0';
  const second = mode === 'dark' ? '#1b2028' : '#f8f4ec';
  return [
    `radial-gradient(circle at ${clamp(params.x, 0, 100)}% ${clamp(params.y, 0, 100)}%, ${hexToRgba(params.accent, 0.34)}, transparent 62%)`,
    `linear-gradient(155deg, ${first}, ${second})`
  ].join(', ');
}

// ChatGPT 侧栏同样是左侧 ~260px 固定轨道，与 ZCode 共用同一套护栏渐变
function safeOverlay(p, t) {
  const scrim = t.scrim || t.dim;
  if (p.safe === 'off') return 'transparent';
  if (p.safe === 'center') return `radial-gradient(circle at 50% 45%, transparent 35%, ${scrim} 100%)`;
  const angle = p.safe === 'right' ? '270deg' : '90deg';
  return `linear-gradient(${angle}, ${scrim} 0px, ${scrim} 260px, transparent 420px)`;
}

function chatgptVars(t) {
  return [
    // —— 应用级"opaque"族：输入框/动作条的实际取色处，通用 varMap 覆盖不到
    `  --app-color-background-surface: ${t.panel} !important;`,
    `  --app-color-background-elevated-primary: ${t.card} !important;`,
    `  --app-color-background-elevated-primary-opaque: ${t.card} !important;`,
    `  --app-color-background-elevated-secondary-opaque: ${t.popover} !important;`,
    // —— surface 语义层：主面板/次级面板/悬浮卡片
    `  --color-surface: ${t.panel} !important;`,
    `  --color-surface-secondary: ${t.panel} !important;`,
    `  --color-surface-tertiary: ${t.surface} !important;`,
    `  --color-surface-elevated: ${t.card} !important;`,
    `  --color-surface-elevated-secondary: ${t.card} !important;`,
    `  --color-surface-canvas: ${t.panel} !important;`,
    `  --color-surface-card: ${t.card} !important;`,
    // —— 命名背景：侧栏 / 输入区 / 弹层 / 提示 / 代码输出
    `  --color-background-panel: ${t.panel} !important;`,
    `  --color-background-page-search: ${t.sidebar} !important;`,
    `  --color-background-composer-surface: ${t.card} !important;`,
    `  --color-background-composer-action-bar: ${t.popover} !important;`,
    `  --color-background-tooltip: ${t.popover} !important;`,
    `  --color-background-tooltip-classic: ${t.popover} !important;`,
    `  --color-background-callout-surface: ${t.card} !important;`,
    `  --color-background-viewer-control: ${t.popover} !important;`,
    `  --color-background-mode-toggle-track: ${t.surface} !important;`,
    `  --color-background-segmented-form-track: ${t.surface} !important;`,
    `  --color-background-segmented-form-selected: ${t.surfaceHover} !important;`,
    `  --color-background-execution-output: ${t.card} !important;`,
    `  --color-background-primary-soft: ${t.surface} !important;`,
    `  --color-background-primary-soft-hover: ${t.surfaceHover} !important;`,
    `  --color-background-primary-soft-active: ${t.surfaceHover} !important;`,
    `  --color-background-secondary-soft: ${t.surface} !important;`,
    `  --color-background-secondary-soft-hover: ${t.surfaceHover} !important;`,
    `  --color-codex-terminal-background: ${t.card} !important;`,
    // —— 文字：正文/次级/最弱/提示，压住壁纸的是 text-shadow 与 dim，不靠纯白
    `  --color-text: ${t.foreground} !important;`,
    `  --color-text-primary: ${t.foreground} !important;`,
    `  --color-text-secondary: ${t.foregroundSubtle} !important;`,
    `  --color-text-tertiary: ${t.foregroundSubtlest} !important;`,
    `  --color-text-tooltip: ${t.tooltipForeground} !important;`,
    // —— 边框
    `  --color-border: ${t.border} !important;`,
    `  --color-border-subtle: ${t.border} !important;`,
    `  --color-border-strong: ${t.border} !important;`
  ].join('\n');
}

export function buildThemeCss({ params, media, tokens, tokensByMode, mode = 'light' }) {
  const p = normalizeThemeParams(params);
  const light = (tokensByMode && tokensByMode.light) || tokens;
  const dark = (tokensByMode && tokensByMode.dark) || tokens;
  const position = `${clamp(p.x + p.hpos * 0.3, 0, 100)}% ${p.y}%`;
  const scale = (clamp(p.zoom, 100, 220) / 100).toFixed(2);
  const size = p.mode === 'contain' ? 'contain' : p.mode === 'stretch' ? '100% 100%' : 'cover';
  const backdropBlur = p.task === 'focus' ? '10px' : '0px';
  const textShadow = {
    light: '0 1px 2px rgba(255,255,255,0.65), 0 0 1px rgba(255,255,255,0.60), 0 0 6px rgba(255,255,255,0.45)',
    dark: '0 1px 2px rgba(0,0,0,0.60), 0 0 1px rgba(0,0,0,0.55), 0 0 6px rgba(0,0,0,0.45)'
  };

  // 图/视频底不分模式，只有无素材的渐变各备一份
  const backdropImage = (which) => (media && media.kind === 'image'
    ? `url("${media.url}")`
    : media && media.kind === 'video'
      ? 'none'
      : fallbackGradient(p, which));
  const sizeValue = media && media.kind === 'image' ? size : 'cover';
  const imageLine = [
    'background-image: var(--bb-backdrop-image);',
    `background-size: ${sizeValue}; background-position: ${position}; background-repeat: no-repeat;`,
    `transform: scale(${scale}); transform-origin: ${position};`
  ].join(' ');

  const modeBlock = (selector, t, which) => [
    `${selector} {`,
    chatgptVars(t),
    `  --bb-dim: ${t.dim};`,
    `  --bb-safe: ${safeOverlay(p, t)};`,
    `  --bb-text-shadow: ${textShadow[which]};`,
    `  --bb-backdrop-image: ${backdropImage(which)};`,
    '}'
  ].join('\n');

  return [
    // 浅色值挂在 :root（默认），深色值挂在宿主自己的 data-theme 上；同 !important 时按特异性后者胜
    modeBlock(':root', light, 'light'),
    modeBlock('html[data-theme="dark"]', dark, 'dark'),
    ':root {',
    `  --bb-accent: ${p.accent};`,
    '  --color-background-text-selection: rgba(46,127,203,0.35) !important;',
    '}',
    backdropRules({
      p: { ...DEFAULT_IDS, rootSelector: CHATGPT_HOST.rootSelector },
      imageLine,
      position,
      scale,
      blur: '0px',
      dim: 'var(--bb-dim)',
      safe: 'var(--bb-safe)'
    }),
    '#root { position: relative; z-index: 1; text-shadow: var(--bb-text-shadow); }',
    `#backdropbuddy-backdrop { filter: blur(${backdropBlur}); }`,
    `#backdropbuddy-video { filter: blur(${backdropBlur}); }`,
    ''
  ].join('\n');
}

export const fingerprintExpression = () => genericFingerprint(CHATGPT_PROFILE);
export const snapshotExpression = () => genericSnapshot(CHATGPT_PROFILE);
export const injectionExpression = (args) => genericInjection(CHATGPT_PROFILE, args);
export const verifyExpression = () => genericVerify(CHATGPT_PROFILE);
export const pauseExpression = (paused) => genericPause(CHATGPT_PROFILE, paused);
export const removeExpression = () => genericRemove(CHATGPT_PROFILE);

// 与 ZCode 同构的专用 profile：数据 + 专属 CSS 映射，adapter 只认这个形状。
export const CHATGPT_PROFILE = Object.freeze({
  ...CHATGPT_HOST,
  exe: '',
  hostRoot: null,
  buildThemeCss,
  normalizeThemeParams,
  isSupportedVersion: () => ({ ok: true, version: null }),
  fingerprintExpression,
  snapshotExpression,
  injectionExpression,
  verifyExpression,
  pauseExpression,
  removeExpression,
  hashHostFiles: false,
  cssSelectors: [':root', 'html', 'body', 'html[data-theme="dark"]', '#root']
});
