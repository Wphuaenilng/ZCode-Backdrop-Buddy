// 自动发现宿主：扫本机回环的常见调试端口，对每个 CDP 端口做只读指纹，
// 直接产出一个可保存的 profile 建议——用户不需要知道程序装在哪、端口是多少。
import { CdpSession } from './detect.mjs';
import { inspectExpression } from './inspect.mjs';
import { runPowerShellJson } from '../platform/exec.mjs';

// 常见调试端口：Electron 默认 9222、本项目 ZCode 9229、向导示例 9223-9236、Obsidian 9334 一带
export const SCAN_PORTS = Object.freeze([
  9222, 9223, 9224, 9225, 9226, 9227, 9228, 9229, 9230, 9231, 9232, 9233, 9234, 9235, 9236,
  9333, 9334, 9335
]);

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function patternFor(url) {
  const text = String(url);
  try {
    const parsed = new URL(text);
    if (parsed.protocol === 'file:') {
      const base = parsed.pathname.replace(/[^/]*$/, '');
      return '^' + escapeRegex(text.slice(0, text.indexOf(parsed.pathname)) + base);
    }
    // 非特殊协议（app:// 、vscode-file:// 等）的 origin 是 "null"，直接按 URL 前缀截
    const match = text.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i);
    if (match) return '^' + escapeRegex(match[0]);
    return '^' + escapeRegex(text);
  } catch {
    return '^' + escapeRegex(text);
  }
}

function slugFor(title) {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return base || 'found-host';
}

// 与向导 UI 同款的变量挑选启发式：背景/文字变量 + 常见面 token 的自动映射
function autoVarMap(bgVar, fgVar, vars) {
  const map = {};
  if (bgVar) map[bgVar] = 'panel';
  if (fgVar) map[fgVar] = 'foreground';
  for (const item of vars || []) {
    if (item.name === bgVar || item.name === fgVar) continue;
    const name = item.name.toLowerCase();
    if (Object.keys(map).length >= 8) break;
    if (/secondary|sidebar|panel/.test(name)) map[item.name] = 'sidebar';
    else if (/border/.test(name)) map[item.name] = 'border';
    else if (/accent|primary/.test(name)) map[item.name] = 'accentSoft';
    else if (/muted|faint|subtle/.test(name)) map[item.name] = 'foregroundSubtle';
  }
  return map;
}

// 纯函数：inspect 结果 → profile 建议（便于单测，不碰网络）
export function buildSuggestion(info, { existingIds = [], exe = null } = {}) {
  if (!info || !info.url) return null;
  const vars = info.vars || [];
  const bg = vars.find((v) => /background|surface|bg/i.test(v.name) && !/secondary|modifier|hover|active|alt|accent/i.test(v.name));
  const fg = vars.find((v) => /text|foreground|fg/i.test(v.name) && !/muted|faint|subtle|accent|inverse/i.test(v.name));
  const darkClass = (info.darkCandidates || []).find((c) => /dark/i.test(c.cls));
  const darkAttr = (info.darkAttrCandidates || []).find((c) => /dark/i.test(c.value));

  // 面板：取面积最大的候选面（它往往就是主内容区），没有就退回根容器
  const rootSelector = (info.readyCandidates || [])[0]?.selector || 'body';
  const surface = (info.surfaces || [])[0]?.selector || rootSelector;

  let id = slugFor(info.title);
  while (existingIds.includes(id)) id = id.replace(/-\d+$/, '') + '-' + Math.floor(Math.random() * 900 + 100);

  const suggestion = {
    id,
    name: String(info.title || '发现的宿主').split(' - ')[0].slice(0, 24),
    exe: exe || '',
    port: info.port || null,
    rendererPattern: patternFor(info.url),
    readySelector: rootSelector,
    rootSelector,
    darkClass: darkClass ? darkClass.cls : null,
    darkAttr: darkAttr ? darkAttr.attr : null,
    darkAttrValue: darkAttr ? darkAttr.value : null,
    darkTarget: darkClass ? darkClass.target : (darkAttr ? darkAttr.target : 'body'),
    tokenTarget: (bg && bg.target) || 'body',
    themedTarget: 'body',
    backgroundVar: bg ? bg.name : '',
    foregroundVar: fg ? fg.name : '',
    surfaceSelectors: [surface],
    glassSelectors: [],
    textSelectors: [],
    skipSelector: null,
    varMap: bg || fg ? autoVarMap(bg && bg.name, fg && fg.name, vars) : {},
    mediaDelivery: info.csp && info.csp.present && !info.csp.fileImage && info.csp.blobImage ? 'blob' : 'file'
  };
  return {
    port: info.port || null,
    title: info.title || '',
    url: info.url,
    vars: vars.length,
    csp: info.csp || null,
    suggestion
  };
}

// 从祖先链里挑应用本体：Electron 的监听者就是应用；WebView2 宿主要跳过 msedgewebview2 子进程
function pickAppExe(paths) {
  if (!Array.isArray(paths)) return null;
  for (const p of paths) {
    if (p && !/msedgewebview2|Microsoft\\\\EdgeWebView|chromium\\\\|electron\\\\/i.test(p)) return p;
  }
  return paths[0] || null;
}

async function probePort(port, timeoutMs = 600) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
    if (!response.ok) return null;
    const targets = await response.json();
    return Array.isArray(targets) ? targets : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function scanHosts({ ports = SCAN_PORTS, logger = null, knownProfiles = [], appRoot = null } = {}) {
  const knownIds = knownProfiles.map((p) => p.id);
  const results = [];

  await Promise.all(ports.map(async (port) => {
    let targets;
    try {
      targets = await probePort(port);
    } catch {
      return;
    }
    if (!targets) return;

    const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl
      && !/^(devtools|about:)/i.test(target.url));
    if (!page) return;

    // 已接入的宿主（rendererPattern 命中）标记 imported，不重复给建议
    const known = knownProfiles.find((p) => {
      try { return new RegExp(p.rendererPattern).test(page.url); } catch { return false; }
    });
    if (known) {
      results.push({ port, title: page.title || '', url: page.url, imported: true, hostId: known.id, hostName: known.name });
      return;
    }

    let info = null;
    try {
      const session = await CdpSession.open(page.webSocketDebuggerUrl, { timeoutMs: 4000 });
      try {
        info = await session.evaluate(inspectExpression(), { timeoutMs: 8000 });
      } finally {
        session.close();
      }
    } catch (error) {
      logger?.warn('autoscan inspect failed', { port, message: error.message });
    }
    if (!info || typeof info !== 'object') return;

    const suggestion = buildSuggestion({ ...info, port }, { existingIds: [...knownIds, ...results.map((r) => r.suggestion && r.suggestion.id).filter(Boolean)] });
    if (!suggestion) return;

    // 端口归属：拿监听进程的祖先链，挑出应用本体
    if (appRoot) {
      try {
        const listener = await runPowerShellJson('host/port-listener.ps1', { appRoot, args: ['-Port', String(port)], timeout: 10000 });
        const exe = pickAppExe(listener && listener.paths);
        if (exe) suggestion.suggestion.exe = exe;
      } catch (error) {
        logger?.warn('autoscan port-listener failed', { port, message: error.message });
      }
    }
    results.push({ port, title: suggestion.title, url: suggestion.url, imported: false, vars: suggestion.vars, csp: suggestion.csp, suggestion: suggestion.suggestion });
  }));

  results.sort((a, b) => (a.imported ? 0 : 1) - (b.imported ? 0 : 1) || a.port - b.port);
  return results;
}
