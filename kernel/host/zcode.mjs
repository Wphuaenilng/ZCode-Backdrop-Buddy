import fs from 'node:fs';
import path from 'node:path';
import { runPowerShellJson } from '../platform/exec.mjs';
import {
  DEFAULT_IDS,
  fingerprintExpression as genericFingerprint,
  injectionExpression as genericInjection,
  pauseExpression as genericPause,
  removeExpression as genericRemove,
  snapshotExpression as genericSnapshot,
  verifyExpression as genericVerify
} from './expressions.mjs';

const ZCODE_HOST = Object.freeze({
  id: 'zcode',
  name: 'ZCode',
  defaultPath: 'F:\\shop\\ZCode\\ZCode.exe',
  defaultPort: 9229,
  rendererPattern: /out[\\/]renderer[\\/]index\.html/,
  secondaryPattern: /[?&]windowKind=/,
  readyClass: 'zcode-startup-ready',
  readySelector: '#root',
  loadingSelector: '[data-testid="root-startup-loading"]',
  testidSelector: '[data-testid]',
  rootSelector: '#root',
  darkClass: 'dark',
  darkTarget: 'html',
  tokenTarget: 'html',
  themedTarget: 'html',
  backgroundVar: '--color-background',
  foregroundVar: '--color-foreground',
  minVersion: '3.0.0',
  ...DEFAULT_IDS
});

export function resolveProfile(env = process.env) {
  const exe = env.ZCODE_PATH || ZCODE_PROFILE.defaultPath;
  return {
    ...ZCODE_PROFILE,
    exe,
    hostRoot: path.dirname(exe),
    port: Number(env.ZCODE_PORT) || ZCODE_PROFILE.defaultPort
  };
}

// ZCode can be installed anywhere. Prefer an explicit path, then common
// install locations, then ask Windows (running process / uninstall entry /
// Start Menu shortcut) before falling back to the bundled default.
export async function discoverExecutable({ appRoot, env = process.env, configured = null } = {}) {
  const candidates = [];
  const add = (value, source) => {
    if (!value) return;
    const normalized = path.normalize(String(value));
    if (!candidates.some((item) => item.path.toLowerCase() === normalized.toLowerCase())) {
      candidates.push({ path: normalized, source });
    }
  };

  add(env.ZCODE_PATH, 'env');
  add(configured, 'config');
  const local = env.LOCALAPPDATA || process.env.LOCALAPPDATA;
  const programFiles = env.ProgramFiles || process.env.ProgramFiles;
  const programFilesX86 = env['ProgramFiles(x86)'] || process.env['ProgramFiles(x86)'];
  if (local) {
    add(path.join(local, 'Programs', 'ZCode', 'ZCode.exe'), 'localappdata');
    add(path.join(local, 'ZCode', 'ZCode.exe'), 'localappdata');
  }
  if (programFiles) add(path.join(programFiles, 'ZCode', 'ZCode.exe'), 'programfiles');
  if (programFilesX86) add(path.join(programFilesX86, 'ZCode', 'ZCode.exe'), 'programfiles');
  add(ZCODE_PROFILE.defaultPath, 'default');

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate.path) && fs.statSync(candidate.path).isFile()) return candidate;
    } catch { /* keep looking */ }
  }

  if (appRoot) {
    try {
      const result = await runPowerShellJson('host/find.ps1', {
        appRoot,
        args: ['-Name', path.basename(ZCODE_PROFILE.defaultPath)],
        timeout: 20000
      });
      if (result && result.found && result.path && fs.existsSync(result.path)) {
        return { path: path.normalize(result.path), source: result.source || 'search' };
      }
    } catch { /* fall back to the default profile */ }
  }

  return null;
}

export function versionParts(value) {
  const match = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    text: `${match[1]}.${match[2]}.${match[3]}`
  };
}

export function isSupportedVersion(value) {
  const parts = versionParts(value);
  if (!parts) return { ok: false, reason: '无法读取 ZCode 版本号' };
  const [major, minor, patch] = ZCODE_HOST.minVersion.split('.').map(Number);
  const tooOld = parts.major < major
    || (parts.major === major && parts.minor < minor)
    || (parts.major === major && parts.minor === minor && parts.patch < patch);
  if (tooOld) return { ok: false, reason: `ZCode ${parts.text} 不受支持（需要 >= ${ZCODE_HOST.minVersion}）` };
  return { ok: true, version: parts.text };
}

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min));

export function normalizeThemeParams(value = {}) {
  const input = value && typeof value === 'object' ? value : {};
  const mode = ['auto', 'cover', 'contain', 'stretch'].includes(input.mode) ? input.mode : 'auto';
  const safe = ['auto', 'left', 'right', 'center', 'off'].includes(input.safe) ? input.safe : 'auto';
  const task = ['auto', 'ambient', 'focus'].includes(input.task) ? input.task : 'auto';
  const accent = /^#[0-9a-f]{6}$/i.test(String(input.accent || '')) ? String(input.accent).toLowerCase() : '#6f9275';

  return {
    mode,
    x: clamp(input.x, 0, 100),
    y: clamp(input.y, 0, 100),
    zoom: clamp(input.zoom, 100, 220),
    hpos: clamp(input.hpos, 0, 100),
    safe,
    task,
    bubble: clamp(input.bubble, 0, 100),
    panel: clamp(input.panel, 0, 100),
    accent,
    lock: !!input.lock,
    custom: !!input.custom
  };
}

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

function colorVars(t) {
  const hoverWash = t.hoverWash || t.surfaceHover;
  const popoverGlass = t.popoverGlass || t.popover;
  return [
    `  --color-background: ${t.panel} !important;`,
    `  --color-background-alt: ${t.panel} !important;`,
    `  --color-header: ${t.header} !important;`,
    `  --color-sidebar: ${t.sidebar} !important;`,
    `  --color-panel: ${t.panel} !important;`,
    `  --color-card: ${t.card} !important;`,
    `  --color-card-border: ${t.cardBorder} !important;`,
    `  --color-card-selected: ${t.selected} !important;`,
    `  --color-popover: ${popoverGlass} !important;`,
    `  --color-popover-header: ${popoverGlass} !important;`,
    `  --color-popover-border: ${t.popoverBorder} !important;`,
    `  --color-popover-foreground: ${t.popoverForeground} !important;`,
    `  --color-input: ${t.input} !important;`,
    `  --color-input-focused: ${t.input} !important;`,
    `  --color-input-border: ${t.inputBorder} !important;`,
    `  --color-tab: ${t.sidebar} !important;`,
    `  --color-tab-active: ${t.card} !important;`,
    `  --color-menu: ${popoverGlass} !important;`,
    `  --color-menu-hover: ${hoverWash} !important;`,
    `  --color-surface: ${t.surface} !important;`,
    `  --color-surface-hover: ${hoverWash} !important;`,
    `  --color-hover: ${hoverWash} !important;`,
    `  --color-selected: ${t.selected} !important;`,
    `  --color-accent: ${t.accentSoft} !important;`,
    `  --color-foreground: ${t.foreground} !important;`,
    `  --color-foreground-subtle: ${t.foregroundSubtle} !important;`,
    `  --color-foreground-subtlest: ${t.foregroundSubtlest} !important;`,
    `  --color-border: ${t.border} !important;`,
    `  --color-border-hover: ${t.inputBorder} !important;`,
    `  --color-terminal-bg: ${t.terminal} !important;`,
    `  --color-toast: ${t.popover} !important;`,
    `  --color-tooltip: ${t.popover} !important;`,
    `  --color-tooltip-foreground: ${t.tooltipForeground} !important;`
  ].join('\n');
}

function safeOverlay(p, t) {
  const scrim = t.scrim || t.dim;
  if (p.safe === 'off') return 'transparent';
  if (p.safe === 'center') return `radial-gradient(circle at 50% 45%, transparent 35%, ${scrim} 100%)`;
  // ZCode 任务列表是左侧固定轨道（实测 ~260px），auto 也默认护左。
  // 渐变用 px：轨道宽度不随窗口缩放，百分比会在窄窗漏盖、宽窗多盖。
  const angle = p.safe === 'right' ? '270deg' : '90deg';
  return `linear-gradient(${angle}, ${scrim} 0px, ${scrim} 260px, transparent 420px)`;
}

export function buildThemeCss({ params, media, tokens, tokensByMode, mode = 'light' }) {
  const p = normalizeThemeParams(params);
  const light = (tokensByMode && tokensByMode.light) || tokens;
  const dark = (tokensByMode && tokensByMode.dark) || tokens;
  const position = `${clamp(p.x + p.hpos * 0.3, 0, 100)}% ${p.y}%`;
  const scale = (clamp(p.zoom, 100, 220) / 100).toFixed(2);
  const size = p.mode === 'contain' ? 'contain' : p.mode === 'stretch' ? '100% 100%' : 'cover';
  // "UI 隐形"基调：auto/ambient 不加毛玻璃、壁纸层不糊，人物原画质透出；
  // 文字靠 text-shadow 与侧栏 scrim 托底，focus 档才收拢成重磨砂
  const blur = p.task === 'focus' ? '26px' : '0px';
  const backdropBlur = p.task === 'focus' ? '10px' : '0px';
  // 下拉/菜单的底色变透后必须有毛玻璃托底，否则壁纸的高频细节会穿字
  const popoverBlur = p.task === 'focus' ? '26px' : '18px';
  // 裸字直接压壁纸时投影是唯一可读性来源：紧凑轮廓 + 柔和光晕两段叠加，
  // 半径大的那段负责把字从亮部"抬"出来，小半径段保持字形锐利
  const textShadow = {
    light: '0 1px 2px rgba(255,255,255,0.65), 0 0 1px rgba(255,255,255,0.60), 0 0 6px rgba(255,255,255,0.45)',
    dark: '0 1px 2px rgba(0,0,0,0.60), 0 0 1px rgba(0,0,0,0.55), 0 0 6px rgba(0,0,0,0.45)'
  };

  // 背景图与视频底跟模式无关，只有"无素材时的渐变"分明暗，所以拆成两个模式块各一个变量。
  const backdropImage = (which) => (media && media.kind === 'image'
    ? `url("${media.url}")`
    : media && media.kind === 'video'
      ? 'none'
      : fallbackGradient(p, which));
  const sizeValue = media && media.kind === 'image' ? size : 'cover';

  return [
    ':root, html.theme-zai-light {',
    colorVars(light),
    `  --bb-dim: ${light.dim};`,
    `  --bb-safe: ${safeOverlay(p, light)};`,
    `  --bb-text-shadow: ${textShadow.light};`,
    `  --bb-backdrop-image: ${backdropImage('light')};`,
    '  --color-background-win-alt: transparent !important;',
    '}',
    'html.dark, html.theme-zai-dark {',
    colorVars(dark),
    `  --bb-dim: ${dark.dim};`,
    `  --bb-safe: ${safeOverlay(p, dark)};`,
    `  --bb-text-shadow: ${textShadow.dark};`,
    `  --bb-backdrop-image: ${backdropImage('dark')};`,
    '}',
    ':root {',
    `  --bb-accent: ${p.accent};`,
    `  --color-brand: ${p.accent} !important;`,
    `  --color-primary: ${p.accent} !important;`,
    `  --color-primary-foreground: ${light.contrast} !important;`,
    `  --color-input-border-focused: ${p.accent} !important;`,
    `  --color-find-highlight-active: ${p.accent} !important;`,
    '}',
    'html, body { background: transparent !important; }',
    '#root { position: relative; z-index: 1; text-shadow: var(--bb-text-shadow); }',
    '#backdropbuddy-backdrop {',
    '  position: fixed; inset: -16px; z-index: 0; pointer-events: none;',
    '  background-image: var(--bb-backdrop-image);',
    `  background-size: ${sizeValue}; background-position: ${position}; background-repeat: no-repeat;`,
    `  transform: scale(${scale}); transform-origin: ${position};`,
    `  filter: blur(${backdropBlur});`,
    '}',
    '#backdropbuddy-backdrop::before {',
    '  content: ""; position: absolute; inset: 0; pointer-events: none;',
    '  background: var(--bb-safe);',
    '}',
    '#backdropbuddy-backdrop::after {',
    '  content: ""; position: absolute; inset: 0; pointer-events: none;',
    '  background: var(--bb-dim);',
    '}',
    '#backdropbuddy-video {',
    '  position: fixed; inset: -16px; z-index: 0; width: calc(100% + 32px); height: calc(100% + 32px);',
    '  object-fit: cover; pointer-events: none; background: #000;',
    `  object-position: ${position}; transform: scale(${scale}); transform-origin: ${position};`,
    `  filter: blur(${backdropBlur});`,
    '}',
    `[class~="bg-background"], [class~="bg-sidebar"], [class~="bg-header"] { backdrop-filter: blur(${blur}) saturate(1.08); }`,
    // popover 直加毛玻璃是有意为之：它的浮层内容不带 fixed 定位子层（Radix 的下拉/
    // 选择器再往外弹时已 portal 到 body），所以不会形成包含块陷阱。此结论未在真实
    // 宿主逐项验证；一旦看到 popover 里的子层被裁成一条边，就改用下面 bg-menu 的
    // ::before 写法，不要反过来把 menu 改回直加。
    `[class~="bg-popover"], [class~="bg-popover/95"], [class~="bg-popover/98"] { backdrop-filter: blur(${popoverBlur}) saturate(1.08); }`,
    // 菜单不能直接加 backdrop-filter：它会成为 Radix 子菜单 fixed 层的包含块，
    // 子菜单随即被菜单自身的 overflow 裁成一条边；毛玻璃只放在伪元素上。
    '[class~="bg-menu"] { position: relative; }',
    `[class~="bg-menu"]::before { content: ""; position: absolute; inset: 0; z-index: -1; border-radius: inherit; backdrop-filter: blur(${popoverBlur}) saturate(1.08); pointer-events: none; }`,
    // 开关旋钮吃 --color-primary-foreground（全局是对比色）；只在开关上改白，避免影响主按钮文字
    '[class~="group/switch"] { --color-primary-foreground: #ffffff !important; }',
    ''
  ].join('\n');
}

export const fingerprintExpression = () => genericFingerprint(ZCODE_PROFILE);
export const snapshotExpression = () => genericSnapshot(ZCODE_PROFILE);
export const injectionExpression = (args) => genericInjection(ZCODE_PROFILE, args);
export const verifyExpression = () => genericVerify(ZCODE_PROFILE);
export const pauseExpression = (paused) => genericPause(ZCODE_PROFILE, paused);
export const removeExpression = () => genericRemove(ZCODE_PROFILE);

// profile 接口：数据 + 一组宿主专属实现，adapter 只认这个形状。
export const ZCODE_PROFILE = Object.freeze({
  ...ZCODE_HOST,
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
