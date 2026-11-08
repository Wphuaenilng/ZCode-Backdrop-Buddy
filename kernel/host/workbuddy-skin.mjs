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

// WorkBuddy 原生皮肤契约映射：2026-11-07 从本机原生皮肤包逆向（appearance-resources/theme-*
// 的 skin.v2.css / workbuddy-skin-mint）。WorkBuddy 整个 UI 消费 --cb-* 变量族（569 个），
// 官方皮肤 = 按选择器覆盖这族变量 + local-file 资源。这里只做"变量契约"层：
// 注入的 CSS 设置真正的 --cb-* / --vscode-* 值，由宿主自己的样式表吃到每个面板/气泡/输入框，
// 观感与官方皮肤同源；背景层仍由 BackdropBuddy 的固定层承载。
//
// 选择器契约（浅色照抄原生 skin.v2.css，深色按 live class 推导：html/body 同挂 dark cb-dark vscode-dark）。
const SKIN_LIGHT_SELECTOR = [
  ':root', 'body', 'body.light', '.light', '.cb-light',
  '.light .cbChat', '.cb-light .cbChat', '.cbChat.light', ':root.light'
].join(',\n');

const SKIN_DARK_SELECTOR = [
  'body.dark', '.dark', '.cb-dark', '.cbChat.dark',
  '.dark .cbChat', '.cb-dark .cbChat'
].join(',\n');

export const WORKBUDDY_SKIN_SELECTORS = [
  ':root', 'html', 'body',
  ':root.light', 'body.light', '.light', '.cb-light', '.light .cbChat', '.cb-light .cbChat', '.cbChat.light',
  'body.dark', '.dark', '.cb-dark', '.cbChat.dark', '.dark .cbChat', '.cb-dark .cbChat',
  '.teams-container', '.conversation-shell', '.conversation-list', '.cr-input-container',
  '.teams-grid-scroll-content', '._gridView_11lon_9', '._gridViewItem_11lon_15',
  '.cr-self-bubble', 'body.dark .cr-self-bubble',
  '.cr-input-toolbar__right',
  '.cr-input-toolbar__send button',
  '.vscode-dark .conversation-input__box .cr-input-toolbar__right',
  '.cr-context-usage',
  '.cr-context-usage svg',
  '[class*="_mainText_"]',
  '.cr-collapse__title',
  '.cr-tool-head__primary',
  '[data-theme="dark"] .industry-template-switcher__trigger--general.wb-button:not(:hover):not(:active)',
  'html.cb-dark .industry-template-switcher__trigger--general.wb-button:not(:hover):not(:active)',
  'body.vscode-dark .industry-template-switcher__trigger--general.wb-button:not(:hover):not(:active)',
  '#root', '#backdropbuddy-backdrop', '#backdropbuddy-video'
];

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

// 左侧会话列表是 ~260px 固定轨道，护栏渐变与 ZCode/ChatGPT 同构
function safeOverlay(p, t) {
  const scrim = t.scrim || t.dim;
  if (p.safe === 'left') return `linear-gradient(90deg, ${scrim}, transparent 62%)`;
  if (p.safe === 'right') return `linear-gradient(270deg, ${scrim}, transparent 62%)`;
  if (p.safe === 'center') return `radial-gradient(circle at 50% 45%, transparent 35%, ${scrim} 100%)`;
  return `linear-gradient(90deg, ${scrim} 0px, ${scrim} 260px, transparent 420px)`;
}

// —— --cb-* 变量契约：值全部由配色 token 派生，主区留透明让壁纸透出 ——
function skinVars(t, p) {
  return [
    // 页面底：面板/侧栏/悬浮层
    `  --cb-bg-primary: ${t.panel} !important;`,
    `  --cb-bg-secondary: ${t.sidebar} !important;`,
    `  --cb-bg-tertiary: ${t.surface} !important;`,
    `  --cb-content-background: ${t.surface} !important;`,
    // 主内容区透明：壁纸从 BackdropBuddy 固定层透出（原生皮肤这里是实底色）
    '  --cb-main-area-background: transparent !important;',
    `  --cb-panel-bg-primary: ${t.card} !important;`,
    // 输入框 / 输入区
    `  --cb-vscode-input-background: ${t.input} !important;`,
    `  --cb-input-border-color: ${t.border} !important;`,
    // 气泡 / 卡片 / 代码块 / 表格
    `  --cb-user-bubble-bg: ${t.accentSoft} !important;`,
    `  --cb-user-bubble-color: ${t.foreground} !important;`,
    `  --cb-markdown-table-border-color: ${t.border} !important;`,
    `  --cb-markdown-table-cell-bg: ${t.card} !important;`,
    `  --cb-markdown-table-header-bg: ${t.accentSoft} !important;`,
    `  --cb-markdown-code-block-bg: ${t.card} !important;`,
    `  --cb-markdown-code-block-border: ${t.border} !important;`,
    `  --cb-markdown-code-block-header-bg: ${t.accentSoft} !important;`,
    `  --cb-markdown-border-color: ${t.border} !important;`,
    // 文字族
    `  --cb-text-primary: ${t.foreground} !important;`,
    `  --cb-text-secondary: ${t.foregroundSubtle} !important;`,
    // 边框 / 描边
    `  --cb-main-area-border-color: ${t.border} !important;`,
    `  --cb-stroke-secondary: ${t.border} !important;`,
    `  --cb-popover-border: ${t.border} !important;`,
    `  --cb-dropdown-bg-color: ${t.popover} !important;`,
    `  --cb-vscode-list-hoverBackground: ${t.surfaceHover} !important;`,
    `  --cb-vscode-descriptionForeground: ${t.foregroundSubtle} !important;`,
    // 骨架屏 / 阴影
    `  --cb-skeleton-base: ${t.accentSoft} !important;`,
    `  --cb-skeleton-highlight: ${t.surfaceHover} !important;`,
    // —— VS Code 层（编辑器视图/小组件透传壁纸）——
    '  --vscode-editor-background: transparent !important;',
    `  --vscode-editor-foreground: ${t.foreground} !important;`,
    `  --vscode-input-background: ${t.input} !important;`,
    `  --vscode-input-border: ${t.border} !important;`,
    `  --vscode-textLink-foreground: ${p.accent} !important;`,
    `  --vscode-widget-border: ${t.border} !important;`,
    // —— 主题强调色族：按钮/链接/用户气泡（官方皮肤用 accent 重映射的正是这一族）——
    `  --cb-button-primary: ${p.accent} !important;`,
    `  --cb-button-primary-foreground: ${t.contrast} !important;`,
    `  --cb-text-link: ${p.accent} !important;`,
    `  --wb-accent-blue: ${p.accent} !important;`,
    `  --wb-accent-blue-soft: ${t.accentSoft} !important;`,
    `  --vscode-button-background: ${hexToRgba(p.accent, 0.82)} !important;`,
    `  --vscode-button-foreground: ${t.contrast} !important;`,
    // —— 侧栏/顶栏/芯片取色链（CDP matched-styles 实测：菜单栏、会话药丸、分组标签
    //    全部走 var(--wb-sidebar-bg, var(--cb-sidebar-bg, --vscode-sideBar-background))）——
    `  --wb-sidebar-bg: ${t.sidebar} !important;`,
    `  --cb-sidebar-bg: ${t.sidebar} !important;`,
    `  --vscode-sideBar-background: ${t.sidebar} !important;`,
    `  --cb-vscode-titleBar-activeBackground: ${t.sidebar} !important;`,
    `  --cb-vscode-titleBar-inactiveBackground: ${t.sidebar} !important;`,
    `  --wb-color-bg-primary-default: ${t.surface} !important;`,
    // —— 聊天渲染器 --cr-* 族（表格菜单/输入工具条/代码块/条目悬停）——
    `  --cr-bg-primary: ${t.surface} !important;`,
    `  --cr-bg-secondary: ${t.sidebar} !important;`,
    `  --cr-bg-tertiary: ${t.surface} !important;`,
    `  --cr-bg-elevated: ${t.card} !important;`,
    `  --cr-item-hover-bg: ${t.surfaceHover} !important;`,
    `  --cr-item-selected-bg: ${t.selected} !important;`,
    `  --cr-border-default: ${t.border} !important;`,
    `  --cr-border-elevated: ${t.border} !important;`,
    // 输入容器阴影压在壁纸上发闷（用户反馈），直接去掉
    '  --cr-shadow-input-container: none !important;',
    `  --cr-bg-code: ${t.card} !important;`,
    `  --cr-bg-code-header: ${t.accentSoft} !important;`,
    `  --cr-user-bubble-bg: ${t.accentSoft} !important;`,
    `  --cr-accent: ${p.accent} !important;`,
    `  --cr-brand-primary: ${p.accent} !important;`,
    `  --cr-button-primary-bg: ${p.accent} !important;`,
    `  --cr-text-link: ${p.accent} !important;`,
    // 发送/停止按钮：发送态箭头与停止态圆底都跟主题色
    `  --cr-send-button-fill: ${p.accent} !important;`,
    `  --cr-send-button-fill-stop: ${p.accent} !important;`,
    `  --cr-send-button-fill-disabled: ${t.surfaceHover} !important;`
  ].join('\n');
}

import { mergeSurfaceSelectors } from './skin-harvest.mjs';

export function buildWorkbuddyThemeCss({ params, media, tokens, tokensByMode, mode = 'light', surfaceSelectors = [], glassSelectors = [], discoveredSurfaces = [], contract = null }) {
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
    skinVars(t, p),
    // WorkBuddy 主区直接坐在壁纸上：深色模式用 scrim 级纱罩（0.30–0.60）保证整体压暗，
    // 浅色模式维持轻提亮（0.04–0.24）不糊壁纸。全局 t.dim 是"轻压暗"档，在这套布局里压不住亮壁纸。
    `  --bb-dim: ${which === 'dark' ? (t.scrim || t.dim) : t.dim};`,
    `  --bb-safe: ${safeOverlay(p, t)};`,
    `  --bb-text-shadow: ${textShadow[which]};`,
    `  --bb-backdrop-image: ${backdropImage(which)};`,
    '}'
  ].join('\n');

  // 静态表面 + 探针发现的表面合并：宿主更新改了哈希类也能自动跟上
  const surfaces = mergeSurfaceSelectors(surfaceSelectors, discoveredSurfaces).join(',\n');
  const glass = (glassSelectors || []).join(',\n');

  // 全量契约块：收割宿主样式表声明的全部皮肤变量（按 accent 重定色调），先发；
  // 精调块在后（同特异性、后声明胜）覆盖手工调过的核心变量
  const contractBlock = (scope, selector) => {
    const vars = contract && contract[scope];
    if (!vars || !Object.keys(vars).length) return null;
    return [`${selector} {`,
      ...Object.entries(vars).map(([name, value]) => `  ${name}: ${value} !important;`),
    '}'].join('\n');
  };
  const contractLight = contractBlock('light', SKIN_LIGHT_SELECTOR);
  const contractDark = contractBlock('dark', SKIN_DARK_SELECTOR);

  return [
    // 浅色挂在 :root（默认），深色挂在宿主自己的暗色类上；同 !important 时后声明胜
    ...(contractLight ? [contractLight] : []),
    ...(contractDark ? [contractDark] : []),
    modeBlock(SKIN_LIGHT_SELECTOR, light, 'light'),
    modeBlock(SKIN_DARK_SELECTOR, dark, 'dark'),
    ':root, body.dark {',
    `  --bb-accent: ${p.accent};`,
    '}',
    // 表面透明化：结构容器让壁纸透出（变量族管不到的内联底色靠这里点名）
    ...(surfaces ? [`${surfaces} {`, '  background: transparent !important;', '}'] : []),
    backdropRules({
      p: { ...DEFAULT_IDS, rootSelector: '.teams-container' },
      imageLine,
      position,
      scale,
      blur: '0px',
      dim: 'var(--bb-dim)',
      safe: 'var(--bb-safe)'
    }),
    '.teams-container { position: relative; z-index: 1; text-shadow: var(--bb-text-shadow); }',
    // 工具条右区（加载圈/模型选择/发送）落在玻璃输入容器上：背景安全透明，
    // 深色模式宿主写死的 #1f1f1f 一并中和
    '.cr-input-toolbar__right {',
    '  background: transparent !important;',
    '}',
    '.vscode-dark .conversation-input__box .cr-input-toolbar__right {',
    '  background: transparent !important;',
    '}',
    // 加载圈（上下文用量环）用主题色，其余按钮保持原生；
    // svg 上有宿主自己的直接 color 规则，必须点名到 svg 才能压过继承
    '.cr-context-usage {',
    '  color: var(--cr-text-link) !important;',
    '}',
    '.cr-context-usage svg {',
    '  color: var(--cr-text-link) !important;',
    '}',
    // 发送态箭头跟主题色（停止态圆底走上面的 --cr-send-button-fill-stop）
    '.cr-input-toolbar__send button {',
    '  color: var(--cr-text-link) !important;',
    '}',
    // 思考/加载文案是 background-clip:text 的透明流光字，深色 text-shadow 会透过
    // 透明字形糊成一片——这类元素豁免阴影（思考指示器/折叠标题/工具执行标题）
    '[class*="_mainText_"] {',
    '  text-shadow: none !important;',
    '}',
    '.cr-collapse__title {',
    '  text-shadow: none !important;',
    '}',
    '.cr-tool-head__primary {',
    '  text-shadow: none !important;',
    '}',
    // 宿主在中间容器上声明了默认蓝的 --cr-text-link，继承邻近性会压过 body 级主题色；
    // 在消费子树的根上重声明一次
    '.cr-input-container, .cr-input-toolbar__right {',
    `  --cr-text-link: ${p.accent} !important;`,
    '}',
    // 输入容器阴影在壁纸上发闷（用户反馈）：变量被子树内的声明覆盖过一次，
    // 直接在元素上置空最稳
    '.cr-input-container {',
    '  box-shadow: none !important;',
    '}',
    '[data-theme="dark"] .industry-template-switcher__trigger--general.wb-button:not(:hover):not(:active),',
    'html.cb-dark .industry-template-switcher__trigger--general.wb-button:not(:hover):not(:active),',
    'body.vscode-dark .industry-template-switcher__trigger--general.wb-button:not(:hover):not(:active) {',
    '  background: var(--wb-color-bg-primary-default) !important;',
    '}',
    // 玻璃位：输入框/气泡半透明磨砂（选择器来自向导 profile 的 glassSelectors）
    ...(glass ? [
      `${glass} {`,
      `  background: ${hexToRgba('#ffffff', 0.16)} !important;`,
      '  backdrop-filter: blur(12px) saturate(1.05);',
      '}',
      `${glass.split(',\n').map((sel) => `body.dark ${sel.trim()}`).join(',\n')} {`,
      `  background: ${hexToRgba('#000000', 0.18)} !important;`,
      '}'
    ] : []),
    `#backdropbuddy-backdrop { filter: blur(${backdropBlur}); }`,
    `#backdropbuddy-video { filter: blur(${backdropBlur}); }`,
    ''
  ].join('\n');
}

export function workbuddyExpressions(data) {
  const fields = {
    styleId: DEFAULT_IDS.styleId,
    layerId: DEFAULT_IDS.layerId,
    videoId: DEFAULT_IDS.videoId,
    readySelector: data.readySelector,
    readyClass: data.readyClass || null,
    loadingSelector: null,
    testidSelector: null,
    rootSelector: data.rootSelector,
    darkClass: data.darkClass || null,
    darkAttr: data.darkAttr || null,
    darkAttrValue: data.darkAttr ? (data.darkAttrValue || 'dark') : null,
    darkTarget: data.darkTarget || 'body',
    tokenTarget: data.tokenTarget || 'body',
    themedTarget: data.themedTarget || 'body',
    backgroundVar: data.backgroundVar,
    foregroundVar: data.foregroundVar,
    versionExpression: null
  };
  return {
    fingerprintExpression: () => genericFingerprint(fields),
    snapshotExpression: () => genericSnapshot(fields),
    injectionExpression: (args) => genericInjection(fields, args),
    verifyExpression: () => genericVerify(fields),
    pauseExpression: (paused) => genericPause(fields, paused),
    removeExpression: () => genericRemove(fields)
  };
}
