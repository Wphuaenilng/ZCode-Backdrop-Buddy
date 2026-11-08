import fs from 'node:fs';
import path from 'node:path';
import { runPowerShellJson } from '../platform/exec.mjs';
import { kindForMime, mimeFromExtension } from '../media/mime.mjs';

// Wallpaper Engine 的 Steam App ID：创意工坊内容固定在
// <库>\steamapps\workshop\content\431960\<条目>\。
export const WORKSHOP_APP_ID = '431960';

const SCAN_ITEM_CAP = 300;
const PROJECT_JSON_MAX_BYTES = 1024 * 1024;
const KNOWN_TYPES = ['video', 'scene', 'web', 'application'];
const SAFE_ID_PATTERN = /^[A-Za-z0-9_.-]{1,80}$/;

// project.json 的 file 只允许落在条目目录内。WE 条目是第三方内容，
// 绝对路径与 .. 段都在解析层直接判死，fs 层再做一次同款校验兜底。
export function isSafeRelativeFile(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return false;
  if (path.isAbsolute(value) || /^[A-Za-z]:/.test(value)) return false;
  const normalized = path.normalize(value);
  if (normalized === '..' || normalized.startsWith('..' + path.sep)) return false;
  return true;
}

// 创意工坊目录名是数字，WE 本地项目目录名可能带空格/中文；
// 两类都要能安全地往返于协议参数（id 会被 schema 再校验一次）。
// 安全名直接用原文（工坊数字 id 全局唯一）；不安全名用确定性短哈希，
// 且混入所在根路径——否则两个根的同名本地项目会撞出同一个 id。
export function itemIdFor(dirName, rootKey = null) {
  const name = String(dirName || '');
  if (SAFE_ID_PATTERN.test(name)) return name;
  const seed = rootKey ? `${rootKey}\u0000${name}` : name;
  let hash = 5381;
  for (let index = 0; index < seed.length; index += 1) {
    hash = ((hash * 33) ^ seed.charCodeAt(index)) >>> 0;
  }
  return `wp-${hash.toString(36)}`;
}

// 纯函数：只做结构解析，不碰磁盘。文件存在性由 scanWorkshop 负责。
// rootKey 用于不安全目录名的 id 哈希混根（见 itemIdFor）。
export function parseProject(dirName, raw, rootKey = null) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > PROJECT_JSON_MAX_BYTES) {
    return { ok: false, reason: 'project.json missing or too large' };
  }

  let project;
  try {
    project = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: `invalid JSON: ${error.message}` };
  }
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    return { ok: false, reason: 'project.json is not an object' };
  }

  const type = typeof project.type === 'string' ? project.type : '';
  if (!KNOWN_TYPES.includes(type)) {
    return { ok: false, reason: `unknown project type: ${type || '(empty)'}` };
  }

  const titleSource = typeof project.title === 'string' ? project.title.trim() : '';
  const file = typeof project.file === 'string' ? project.file : '';
  if (type === 'video') {
    if (!file) return { ok: false, reason: 'video project has no file' };
    if (!isSafeRelativeFile(file)) return { ok: false, reason: `unsafe file reference: ${file}` };
  }

  return {
    ok: true,
    item: {
      id: itemIdFor(dirName, rootKey),
      title: (titleSource || String(dirName)).slice(0, 40),
      type,
      supported: type === 'video',
      file: type === 'video' ? file : null
    }
  };
}

// 词法 containment 挡不住重解析点：条目内的 symlink/junction 指向工坊树外时，
// path.relative 看不出来（与 kernel/store/library.mjs startupImagePath 同款防线）。
// 硬链接的 realpath 就在条目内，路径校验原理上拦不住，用 nlink>1 拒收——
// 工坊素材不会正常带硬链接，宁可误杀也不给"任意本机文件入库"留口子。
export function resolveMediaFile(itemDir, relativeFile) {
  if (!isSafeRelativeFile(relativeFile)) return null;
  const root = path.resolve(itemDir);
  const resolved = path.resolve(root, relativeFile);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  try {
    if (!fs.existsSync(resolved)) return null;
    const realRoot = fs.realpathSync(root);
    const realFile = fs.realpathSync(resolved);
    const realRelative = path.relative(realRoot, realFile);
    if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) return null;
    const stat = fs.statSync(realFile);
    if (!stat.isFile() || stat.nlink > 1) return null;
    return resolved;
  } catch {
    return null;
  }
}

// 预览与媒体同信任级：copy 进缓存也是内容外泄面，同样做 realpath containment 与 nlink 检查。
function findPreview(itemDir) {
  for (const name of ['preview.jpg', 'preview.png']) {
    const candidate = path.join(itemDir, name);
    try {
      if (!fs.existsSync(candidate)) continue;
      const realRoot = fs.realpathSync(itemDir);
      const realFile = fs.realpathSync(candidate);
      const realRelative = path.relative(realRoot, realFile);
      if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) continue;
      const stat = fs.statSync(realFile);
      if (!stat.isFile() || stat.nlink > 1) continue;
      return candidate;
    } catch { /* try the next candidate */ }
  }
  return null;
}

// 解析 Steam 库清单（新旧两处位置，读到即停）。vdf 是 UTF-8 无 BOM 的简单
// KeyValues 文本，Node 正则足够，不必为此拉起 PowerShell。
function parseLibraryFolders(steamRoot) {
  const libraries = [];
  for (const relative of ['steamapps\\libraryfolders.vdf', 'config\\libraryfolders.vdf']) {
    const vdf = path.join(steamRoot, relative);
    try {
      if (!fs.existsSync(vdf) || !fs.statSync(vdf).isFile()) continue;
      const content = fs.readFileSync(vdf, 'utf8');
      for (const match of content.matchAll(/"path"\s+"(.+?)"\s*$/gm)) {
        const library = match[1].replace(/\\\\/g, '\\').trim();
        if (!library) continue;
        const normalized = path.normalize(library);
        if (!libraries.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
          libraries.push(normalized);
        }
      }
      break;
    } catch { /* try the next location */ }
  }
  return libraries;
}

// 候选链与 kernel/host/zcode.mjs 的 discoverExecutable 同构：
// 显式配置 → 环境变量 → 常见安装路径 → PowerShell（注册表 + libraryfolders.vdf）。
// 找不到 Steam 不是错误：调用方据此返回 found:false，UI 显示引导文案。
export async function findSteamLibraries({ appRoot, env = process.env, configured = null } = {}) {
  const candidates = [];
  const add = (value, source) => {
    if (!value) return;
    const normalized = path.normalize(String(value));
    if (!candidates.some((item) => item.path.toLowerCase() === normalized.toLowerCase())) {
      candidates.push({ path: normalized, source });
    }
  };

  add(configured, 'config');
  add(env.BACKDROPBUDDY_STEAM_PATH, 'env');
  const programFilesX86 = env['ProgramFiles(x86)'] || process.env['ProgramFiles(x86)'];
  const programFiles = env.ProgramFiles || process.env.ProgramFiles;
  if (programFilesX86) add(path.join(programFilesX86, 'Steam'), 'programfiles');
  if (programFiles) add(path.join(programFiles, 'Steam'), 'programfiles');

  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate.path) && fs.statSync(candidate.path).isDirectory()) {
        // 显式命中也要展开 libraryfolders.vdf：Steam 在默认位置、WE 装在第二库是常见配置，
        // 只返回单库会让扫描空手而归（与 PowerShell 回退分支同款展开）。
        const libraries = [candidate.path];
        for (const library of parseLibraryFolders(candidate.path)) {
          if (!libraries.some((item) => item.toLowerCase() === library.toLowerCase())) {
            libraries.push(library);
          }
        }
        return { steamPath: candidate.path, libraries, source: candidate.source };
      }
    } catch { /* keep looking */ }
  }

  if (appRoot) {
    try {
      const result = await runPowerShellJson('workshop/steam-locations.ps1', { appRoot, timeout: 20000 });
      if (result && result.found && result.steamPath && fs.existsSync(result.steamPath)) {
        const steamPath = path.normalize(result.steamPath);
        const libraries = [steamPath];
        for (const library of Array.isArray(result.libraries) ? result.libraries : []) {
          if (!library) continue;
          const normalized = path.normalize(String(library));
          if (!libraries.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
            libraries.push(normalized);
          }
        }
        return { steamPath, libraries, source: 'search' };
      }
    } catch { /* fall through to not-found */ }
  }

  return { steamPath: null, libraries: [], source: null };
}

// 库路径 → 实际要扫的目录：创意工坊内容 + WE 本体自带的本地项目目录。
// 目录不存在就静默丢弃，调用方拿到的 roots 保证都存在。
export function workshopRoots({ steamPath, libraries }) {
  const roots = [];
  const seen = new Set();
  const add = (dir) => {
    if (!dir) return;
    const normalized = path.normalize(dir);
    const key = normalized.toLowerCase();
    if (seen.has(key) || seen.has(normalized)) return;
    try {
      if (fs.existsSync(normalized) && fs.statSync(normalized).isDirectory()) {
        seen.add(key);
        roots.push(normalized);
      }
    } catch { /* skip unreadable root */ }
  };

  const bases = [...(libraries || [])];
  if (steamPath && !bases.some((item) => item.toLowerCase() === String(steamPath).toLowerCase())) {
    bases.push(steamPath);
  }
  for (const base of bases) {
    add(path.join(base, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID));
    add(path.join(base, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'myprojects'));
  }
  return roots;
}

// 扫描是纯磁盘遍历：一级条目目录 + project.json，不做递归、不读媒体内容。
// 大小上限 cap 防止病态工坊把内核拖死；skipped 只给数量，不回传第三方内容。
export function scanWorkshop({ roots, cap = SCAN_ITEM_CAP } = {}) {
  const items = [];
  let skipped = 0;
  let truncated = false;

  for (const root of roots || []) {
    let entries;
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (items.length >= cap) {
        truncated = true;
        break;
      }

      const itemDir = path.join(root, entry.name);
      const projectFile = path.join(itemDir, 'project.json');
      let raw;
      try {
        const stat = fs.statSync(projectFile);
        if (!stat.isFile() || stat.size > PROJECT_JSON_MAX_BYTES) {
          skipped += 1;
          continue;
        }
        raw = fs.readFileSync(projectFile, 'utf8');
      } catch {
        skipped += 1;
        continue;
      }

      const parsed = parseProject(entry.name, raw, root);
      if (!parsed.ok) {
        skipped += 1;
        continue;
      }

      const item = { ...parsed.item, itemDir, previewPath: findPreview(itemDir) };
      if (item.supported) {
        const mediaPath = resolveMediaFile(itemDir, item.file);
        // 扩展名白名单：.json/.zip/.bbskin 会被 importTheme 的按扩展名路由劫走，
        // 绕开"只导入视频"的 probe 与体积闸门，扫描层直接拒收。
        if (!mediaPath || kindForMime(mimeFromExtension(mediaPath)) !== 'video') {
          skipped += 1;
          continue;
        }
        try {
          item.bytes = fs.statSync(mediaPath).size;
        } catch {
          skipped += 1;
          continue;
        }
        item.mediaPath = mediaPath;
      } else {
        item.bytes = 0;
        item.mediaPath = null;
      }
      items.push(item);
    }
    if (truncated) break;
  }

  items.sort((a, b) => a.title.localeCompare(b.title, 'zh'));
  return { items, skipped, truncated, cap };
}
