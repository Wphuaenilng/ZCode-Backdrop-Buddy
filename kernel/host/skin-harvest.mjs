// WorkBuddy 皮肤契约收割与重映射：官方主题的"深度适配"= 全量变量覆盖。
// file:// 页面读其他样式表的 cssRules 会被同源策略挡掉，所以这里走 CDP 的 CSS 域：
// CSS.enable 收 styleSheetAdded 事件 → getStyleSheetText 取全文 → 内核侧解析变量声明。
// 之后把彩色字面量按壁纸 accent 重定色调（保持明度/透明度层级、跳过语义色）随 CSS 全量下发。

import fs from 'node:fs';
import path from 'node:path';

const FAMILIES = /^--(cb|cr|wb|vscode)-/;
const DARK_RE = /vscode-dark|cb-dark|\.dark(?![a-z-])|data-theme=["']?dark|IDE Night|prefers-color-scheme:\s*dark/i;

// 从一段 CSS 文本解析皮肤变量声明；选择器按最内层块的父链拼接做明暗分桶
export function parseSkinVariables(texts) {
  const out = { light: {}, dark: {} };
  for (const raw of texts) {
    const css = String(raw || '').replace(/\/\*[\s\S]*?\*\//g, '');
    const parents = [];
    let selector = '';
    let decl = '';
    const commit = () => {
      if (!decl || !parents.length) { decl = ''; return; }
      const split = decl.indexOf(':');
      if (split > 0) {
        const name = decl.slice(0, split).trim();
        if (FAMILIES.test(name)) {
          const scope = parents.some((s) => DARK_RE.test(s)) ? 'dark' : 'light';
          // 去掉声明自带的 !important：我们会统一补一个，带两个是非法声明会被整条丢弃
          const value = decl.slice(split + 1).trim().replace(/!important\s*$/i, '').trim();
          if (value) out[scope][name] = value;
        }
      }
      decl = '';
    };
    for (let i = 0; i < css.length; i++) {
      const ch = css[i];
      if (ch === '{') {
        parents.push(selector.trim());
        selector = '';
        decl = '';
      } else if (ch === '}') {
        commit();
        parents.pop();
        selector = '';
        decl = '';
      } else if (ch === ';') {
        commit();
      } else if (parents.length) {
        decl += ch;
      } else {
        selector += ch;
      }
    }
  }
  return out;
}

function hexToRgb(hex) {
  const value = String(hex || '').replace('#', '');
  if (value.length === 3) return [0, 1, 2].map((i) => parseInt(value[i] + value[i], 16));
  if (value.length >= 6) return [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return null;
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return { h: 0, s: 0, l: max };
  const d = max - min;
  const l = (max + min) / 2;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

function hslToRgb(h, s, l) {
  h = (((h % 360) + 360) % 360) / 360;
  if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [channel(h + 1 / 3), channel(h), channel(h - 1 / 3)].map((v) => Math.round(v * 255));
}

const COLOR_RE = /#[0-9a-fA-F]{3,8}\b|rgba?\([^()]*\)|hsla?\([^()]*\)/g;

// 语义色窗口：错误红 / 警告琥珀 / 成功绿保持原样，其余彩色重定到 accent 色相
function isSemanticHue(h) {
  return h < 18 || h > 342 || (h >= 38 && h <= 68) || (h >= 95 && h <= 165);
}

function remapColorLiteral(text, accentH) {
  let r, g, b, alpha = null;
  const isHex = text.startsWith('#');
  if (isHex) {
    const rgb = hexToRgb(text);
    if (!rgb) return text;
    [r, g, b] = rgb;
    const hexBody = text.slice(1);
    if (hexBody.length === 8) alpha = parseInt(hexBody.slice(6, 8), 16) / 255;
    else if (hexBody.length === 4) alpha = parseInt(hexBody.slice(3, 4).repeat(2), 16) / 255;
  } else {
    const match = text.match(/rgba?\(([^)]*)\)/i) || text.match(/hsla?\(([^)]*)\)/i);
    if (!match) return text;
    const parts = match[1].split(/[,\s/]+/).filter(Boolean);
    if (/^hsla?$/i.test(text.slice(0, 4))) {
      [r, g, b] = hslToRgb(parseFloat(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100);
    } else {
      r = parseFloat(parts[0]); g = parseFloat(parts[1]); b = parseFloat(parts[2]);
    }
    if (parts.length >= 4) alpha = /%$/.test(parts[3]) ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
  }
  if (![r, g, b].every((v) => Number.isFinite(v))) return text;
  const { h, s, l } = rgbToHsl(r, g, b);
  // 中性色（低饱和）与语义色不动；其余彩色统一重定到 accent 色相，明度/饱和度层级保持
  if (s < 0.12 || isSemanticHue(h)) return text;
  const [nr, ng, nb] = hslToRgb(accentH, s, l);
  if (isHex) {
    const body = ((nr << 16) | (ng << 8) | nb).toString(16).padStart(6, '0');
    return '#' + (alpha === null ? body : body + Math.round(alpha * 255).toString(16).padStart(2, '0'));
  }
  if (alpha === null) return `rgb(${nr}, ${ng}, ${nb})`;
  const alphaText = /%$/.test((text.match(/[^,]+$/) || [''])[0].trim()) ? Math.round(alpha * 100) + '%' : alpha;
  return `rgba(${nr}, ${ng}, ${nb}, ${alphaText})`;
}

// 把一段变量值里的彩色字面量重定到 accent 色相；accent 缺失时原样返回
export function remapSkinValue(value, accentHex) {
  const source = String(value || '');
  if (!accentHex || !/^#[0-9a-fA-F]{6}$/.test(accentHex)) return source;
  const [r, g, b] = hexToRgb(accentHex);
  const { h } = rgbToHsl(r, g, b);
  return source.replace(COLOR_RE, (text) => {
    try { return remapColorLiteral(text, h); } catch { return text; }
  });
}

// 收割结果 → 每个作用域一份"变量名 → 重映射值"；空值跳过。
// changedOnly：重映射后与原值相同的（中性/语义色）不再下发——覆盖是无功的
export function buildSkinContract(harvest, accentHex, { changedOnly = false } = {}) {
  const out = {};
  for (const scope of ['light', 'dark']) {
    const source = harvest && harvest[scope];
    if (!source) continue;
    const vars = {};
    for (const [name, value] of Object.entries(source)) {
      const trimmed = String(value).trim();
      if (!trimmed) continue;
      const remapped = remapSkinValue(trimmed, accentHex);
      if (changedOnly && remapped === trimmed) continue;
      vars[name] = remapped;
    }
    if (Object.keys(vars).length) out[scope] = vars;
  }
  return out;
}

// 表面探针：从内容锚点（输入框）向上走到根容器，收集"不透明背景"的结构容器，
// 生成稳定选择器（id 优先，其次前两个类名）。WorkBuddy 大版本更新后 CSS 模块哈希类
// 会变，静态 surfaceSelectors 会失效——这层探测让透明化规则自动跟上。
export function surfaceProbeExpression(rootSelector, inputSelector) {
  return `((rootSel, inputSel) => {
    const stableSelector = (el) => {
      if (el.id && /^[A-Za-z][A-Za-z0-9_-]*$/.test(el.id)) return '#' + el.id;
      const classes = (typeof el.className === 'string' ? el.className.trim().split(/\\s+/) : []).filter(Boolean);
      if (!classes.length || !classes.every((c) => /^[A-Za-z0-9_-]+$/.test(c))) return null;
      return '.' + classes.slice(0, 2).join('.');
    };
    const opaque = (el) => {
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg.match(/rgba?\\(([\\d.]+), ([\\d.]+), ([\\d.]+)(?:, ([\\d.]+))?\\)/);
      if (!m) return false;
      return (m[4] === undefined ? 1 : parseFloat(m[4])) >= 0.98;
    };
    const vw = Math.max(document.documentElement.clientWidth, 320);
    const anchor = document.querySelector(inputSel)
      || document.querySelector('.conversation-shell')
      || (() => { const r = document.querySelector('#root'); return r && r.firstElementChild && r.firstElementChild.firstElementChild; })();
    if (!anchor) return [];
    const out = [];
    let el = anchor;
    while (el && el !== document.body) {
      const rect = el.getBoundingClientRect();
      if (opaque(el) && rect.width >= Math.min(320, vw) && rect.height >= 64) {
        const sel = stableSelector(el);
        if (sel) out.push(sel);
      }
      if (rootSel && el.matches && el.matches(rootSel)) break;
      el = el.parentElement;
    }
    return [...new Set(out)].slice(0, 12);
  })(${JSON.stringify(rootSelector || '')}, ${JSON.stringify(inputSelector || '.cr-input-container')})`;
}

// 静态 profile 表面 + 探针发现的表面合并去重；发现的排前面（更新后自动顶上）
export function mergeSurfaceSelectors(base, discovered, { cap = 16 } = {}) {
  const out = [];
  for (const sel of [...(discovered || []), ...(base || [])]) {
    const s = String(sel || '').trim();
    if (s && !out.includes(s) && out.length < cap) out.push(s);
  }
  return out;
}

// 经 CDP CSS 域收割：file:// 下页面侧 cssRules 被同源策略挡住，DevTools 协议无此限制。
// 只负责拿到解析结果（accent 无关），重映射由调用方按当次 accent 现算
export async function harvestSkinVariables(session) {
  const sheets = [];
  const off = session.on('CSS.styleSheetAdded', (params) => {
    if (params && params.header && params.header.styleSheetId) sheets.push(params.header);
  });
  try {
    await session.send('DOM.enable', {}, 8000);
    await session.send('CSS.enable', {}, 8000);
    await new Promise((resolve) => setTimeout(resolve, 400));
  } finally {
    off?.();
  }
  const texts = [];
  for (const sheet of sheets) {
    try {
      // 该 Chromium 变体的 getStyleSheetText 应答键是 text（不是 styleSheetText）
      const reply = await session.send('CSS.getStyleSheetText', { styleSheetId: sheet.styleSheetId }, 20000);
      const text = (reply && (reply.text || reply.styleSheetText)) || '';
      if (text) texts.push(text);
    } catch { /* 单张表失败不影响其余 */ }
  }
  return parseSkinVariables(texts);
}

// 契约缓存：只存 accent 无关的解析结果（按宿主版本键），重映射在使用时现算——
// 换主题/换 accent 不再触发样式表全文传输
const CONTRACT_TTL_MS = 24 * 60 * 60 * 1000;

export function skinContractCachePath(paths, profileId, version) {
  const safeVersion = String(version || '0').replace(/[^0-9a-zA-Z._-]/g, '_');
  return path.join(paths.cache, 'skin-contract', `${profileId}-${safeVersion}.json`);
}

export function readSkinContractCache(file) {
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    const savedAt = Date.parse(data && data.savedAt);
    if (!Number.isFinite(savedAt) || Date.now() - savedAt > CONTRACT_TTL_MS) return null;
    const parsed = data.parsed;
    if (!parsed || (!Object.keys(parsed.light || {}).length && !Object.keys(parsed.dark || {}).length)) return null;
    return { savedAt: data.savedAt, parsed, surfaces: Array.isArray(data.surfaces) ? data.surfaces : [] };
  } catch {
    return null;
  }
}

export function writeSkinContractCache(file, parsed, surfaces = []) {
  // 空解析结果不落盘：避免把半途失败的结果当缓存盖回去
  if (!parsed || (!Object.keys(parsed.light || {}).length && !Object.keys(parsed.dark || {}).length)) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      savedAt: new Date().toISOString(),
      parsed,
      surfaces: Array.isArray(surfaces) ? surfaces : []
    }), 'utf8');
  } catch { /* 缓存失败不影响应用 */ }
}
