import fs from 'node:fs';
import path from 'node:path';

// 向导产出的宿主 profile 是纯数据；这里负责校验与落盘/读取。
export const PROFILE_SCHEMA = 'backdropbuddy.hostprofile/1';

const ID_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const VAR_RE = /^--[a-z0-9][a-z0-9-]{0,60}$/;
const CLASS_RE = /^[A-Za-z][A-Za-z0-9_-]{0,60}$/;
const SELECTOR_RE = /^[A-Za-z0-9_.\-\[\]="':>+~# ]{1,100}$/;
const TOKEN_SET = new Set([
  'panel', 'sidebar', 'header', 'card', 'border', 'input', 'surface', 'surfaceHover',
  'selected', 'accentSoft', 'foreground', 'foregroundSubtle', 'foregroundSubtlest',
  'popover', 'dim', 'contrast', 'scrim'
]);

const isString = (value, min, max) => typeof value === 'string' && value.length >= min && value.length <= max;

function selectorList(value, field, errors, { required = false } = {}) {
  if (value == null) {
    if (required) errors.push(`${field} 不能为空`);
    return [];
  }
  if (!Array.isArray(value)) {
    errors.push(`${field} 必须是数组`);
    return [];
  }
  if (value.length > 20) {
    errors.push(`${field} 最多 20 个`);
    return [];
  }
  const out = [];
  for (const entry of value) {
    if (!isString(entry, 1, 100) || !SELECTOR_RE.test(entry) || entry.includes('{') || entry.includes('}')) {
      errors.push(`${field} 含非法选择器：${String(entry).slice(0, 40)}`);
      continue;
    }
    if (!out.includes(entry)) out.push(entry);
  }
  if (required && out.length === 0) errors.push(`${field} 至少需要一个选择器`);
  return out;
}

// 返回 { ok, errors, profile }：profile 是补齐默认值后的纯数据。
export function validateProfile(raw) {
  const errors = [];
  const input = raw && typeof raw === 'object' ? raw : {};

  if (!isString(input.id, 1, 32) || !ID_RE.test(input.id)) errors.push('id 必须是 1–32 位小写字母/数字/短横线');
  if (!isString(input.name, 1, 40)) errors.push('name 长度必须是 1–40');
  if (!isString(input.exe, 4, 260) || !path.isAbsolute(input.exe)) errors.push('exe 必须是绝对路径');
  const port = Number(input.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) errors.push('port 必须是 1024–65535 的整数');
  if (!isString(input.rendererPattern, 1, 200)) errors.push('rendererPattern 不能为空');
  else {
    try { new RegExp(input.rendererPattern); } catch (error) { errors.push('rendererPattern 不是合法正则'); }
  }
  for (const field of ['readySelector', 'rootSelector']) {
    if (!isString(input[field], 1, 100) || !SELECTOR_RE.test(input[field])) errors.push(`${field} 不是合法选择器`);
  }
  // 变量是可选的：有些宿主（Tauri/Vue 这类）没有 CSS 自定义属性，
  // 只能靠选择器上色——这时 backgroundVar / foregroundVar 留空即可。
  for (const field of ['backgroundVar', 'foregroundVar']) {
    const value = input[field] == null ? '' : input[field];
    if (value !== '' && (!isString(value, 3, 64) || !VAR_RE.test(value))) {
      errors.push(`${field} 必须是 --xxx 形式的变量名，或留空`);
    }
  }
  if (input.darkClass != null && (!isString(input.darkClass, 1, 60) || !CLASS_RE.test(input.darkClass))) {
    errors.push('darkClass 不是合法类名');
  }
  // 属性式暗色标记：比如 ChatGPT 的 html[data-theme="dark"]（class 形态表达不了）
  if (input.darkAttr != null && input.darkAttr !== '') {
    if (!isString(input.darkAttr, 2, 40) || !/^[a-z][a-z0-9-]{1,39}$/i.test(input.darkAttr)) {
      errors.push('darkAttr 不是合法属性名（如 data-theme）');
    } else if (input.darkAttrValue != null && (!isString(input.darkAttrValue, 1, 20) || !/^[a-z0-9_-]{1,20}$/i.test(input.darkAttrValue))) {
      errors.push('darkAttrValue 不是合法属性值');
    }
  }
  // 媒体交付：宿主 CSP 不允许 file: 时改走页面内建 blob（图片与视频都能过 blob: 的 CSP）
  if (input.mediaDelivery != null && !['file', 'blob'].includes(input.mediaDelivery)) {
    errors.push('mediaDelivery 只能是 file 或 blob');
  }
  for (const field of ['darkTarget', 'tokenTarget', 'themedTarget']) {
    if (input[field] != null && !['html', 'body'].includes(input[field])) errors.push(`${field} 只能是 html 或 body`);
  }
  if (input.minVersion != null && !/^\d+\.\d+\.\d+$/.test(String(input.minVersion))) errors.push('minVersion 形如 1.2.3');

  const surfaceSelectors = selectorList(input.surfaceSelectors, 'surfaceSelectors', errors, { required: true });
  const glassSelectors = selectorList(input.glassSelectors, 'glassSelectors', errors);

  const varMap = {};
  const rawVarMap = input.varMap == null ? {} : input.varMap;
  if (typeof rawVarMap !== 'object' || Array.isArray(rawVarMap)) {
    errors.push('varMap 必须是对象');
  } else {
    const entries = Object.entries(rawVarMap);
    if (entries.length > 40) errors.push('varMap 最多 40 项');
    for (const [name, token] of entries) {
      if (!VAR_RE.test(name)) errors.push(`varMap 变量名非法：${name.slice(0, 40)}`);
      else if (!TOKEN_SET.has(token)) errors.push(`varMap 不支持的目标 token：${String(token).slice(0, 40)}`);
      else varMap[name] = token;
    }
  }

  const textSelectors = selectorList(input.textSelectors, 'textSelectors', errors);
  const skipSelector = input.skipSelector == null || input.skipSelector === '' ? null
    : (isString(input.skipSelector, 1, 100) && SELECTOR_RE.test(input.skipSelector) && !/[{}]/.test(input.skipSelector)
      ? input.skipSelector
      : (errors.push('skipSelector 不是合法选择器'), null));

  const profile = {
    schema: PROFILE_SCHEMA,
    id: input.id,
    name: input.name,
    exe: input.exe,
    port,
    rendererPattern: input.rendererPattern,
    readySelector: input.readySelector,
    readyClass: input.readyClass || null,
    rootSelector: input.rootSelector,
    darkClass: input.darkClass || null,
    darkAttr: input.darkAttr || null,
    darkAttrValue: input.darkAttr ? (input.darkAttrValue || 'dark') : null,
    darkTarget: input.darkTarget || 'body',
    tokenTarget: input.tokenTarget || 'body',
    themedTarget: input.themedTarget || 'body',
    backgroundVar: input.backgroundVar || '',
    foregroundVar: input.foregroundVar || '',
    surfaceSelectors,
    glassSelectors,
    textSelectors,
    skipSelector,
    varMap,
    mediaDelivery: input.mediaDelivery === 'blob' ? 'blob' : 'file',
    minVersion: input.minVersion || null,
    createdAt: input.createdAt || new Date().toISOString()
  };

  return { ok: errors.length === 0, errors, profile };
}

export function loadUserProfiles(dir) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8'));
      const result = validateProfile({ ...raw, id: raw.id || entry.name.replace(/\.json$/, '') });
      if (result.ok) out.push(result.profile);
    } catch { /* 单个坏文件不影响其它宿主 */ }
  }
  return out;
}

export function saveUserProfile(dir, raw) {
  const result = validateProfile(raw);
  if (!result.ok) return { ok: false, errors: result.errors };
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${result.profile.id}.json`);
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(result.profile, null, 2), 'utf8');
  fs.renameSync(temp, file);
  return { ok: true, profile: result.profile, path: file };
}
