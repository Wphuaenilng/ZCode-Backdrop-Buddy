import fs from 'node:fs';
import crypto from 'node:crypto';
import { AppError } from '../protocol/errors.mjs';
import { runPowerShellJson } from '../platform/exec.mjs';
import { ZCODE_PROFILE } from './zcode.mjs';

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

export class CdpSession {
  constructor(socket) {
    this.socket = socket;
    this.seq = 0;
    this.pending = new Map();
    this.closed = false;

    socket.addEventListener('message', (event) => {
      let message;
      try { message = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)); } catch { return; }
      if (!message.id) return;
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      if (message.error) entry.reject(new Error(message.error.message || 'CDP error'));
      else entry.resolve(message.result);
    });

    socket.addEventListener('close', () => {
      this.closed = true;
      for (const entry of this.pending.values()) entry.reject(new Error('CDP socket closed'));
      this.pending.clear();
    });
  }

  static async open(url, { timeoutMs = 5000 } = {}) {
    if (typeof WebSocket !== 'function') throw new Error('WebSocket is not available in this Node runtime');
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { try { socket.close(); } catch { /* ignore */ } reject(new Error('CDP connect timeout')); }, timeoutMs);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('CDP connect failed')); }, { once: true });
    });
    return new CdpSession(socket);
  }

  send(method, params = {}, timeoutMs = 8000) {
    if (this.closed) return Promise.reject(new Error('CDP socket is closed'));
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value); },
        reject: (error) => { clearTimeout(timer); reject(error); }
      });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, { timeoutMs = 8000, awaitPromise = true } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise
    }, timeoutMs);
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception && result.exceptionDetails.exception.description;
      throw new Error(detail || result.exceptionDetails.text || 'CDP evaluation failed');
    }
    return result.result ? result.result.value : null;
  }

  close() {
    try { this.socket.close(); } catch { /* ignore */ }
  }
}

export async function openCdp(statusOrTarget, { timeoutMs = 5000 } = {}) {
  // 既接受整份 detect 结果（沿用主目标），也接受单个 target 摘要，方便多窗口逐个连接
  const target = statusOrTarget && statusOrTarget.wsUrl
    ? statusOrTarget
    : statusOrTarget && statusOrTarget.target;
  const wsUrl = target && target.wsUrl;
  if (!wsUrl) throw new AppError('HOST_NOT_READY', 'ZCode 调试目标不可用', { retryable: true });

  let parsed;
  try { parsed = new URL(wsUrl); } catch { throw new AppError('HOST_UNREACHABLE', 'ZCode 调试地址格式无效'); }
  if (!['127.0.0.1', 'localhost', '[::1]', '::1'].includes(parsed.hostname)) {
    throw new AppError('HOST_UNREACHABLE', `拒绝连接非回环调试地址：${parsed.hostname}`);
  }

  try {
    return await CdpSession.open(wsUrl, { timeoutMs });
  } catch (error) {
    throw new AppError('HOST_UNREACHABLE', `无法连接 ZCode 调试页面：${error.message}`, { retryable: true });
  }
}

function isDark(page) {
  if (!page) return false;
  if (page.darkClass) return true;
  if (/theme-[a-z-]*dark/i.test(String(page.htmlClass || ''))) return true;
  const hex = String(page.backgroundToken || '').trim().match(/^#([0-9a-f]{6})$/i);
  if (!hex) return false;
  const value = hex[1];
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.42;
}

// 宿主可能同时开着几个渲染窗口，皮肤要同时打在它们身上；
// 宿主自己的辅助小窗（更新状态等）不算渲染窗口，用 profile.secondaryPattern 排除。
export function rendererTargets(list, profile) {
  const secondary = profile.secondaryPattern || null;
  return (Array.isArray(list) ? list : []).filter((target) => target.type === 'page'
    && profile.rendererPattern.test(target.url || '')
    && !(secondary && secondary.test(target.url || '')));
}

export function targetSummary(target, probe) {
  return {
    id: target.id,
    url: target.url,
    title: target.title || '',
    wsUrl: target.webSocketDebuggerUrl || target.wsUrl || null,
    fingerprint: probe ? fingerprintFor(target, probe) : (target.fingerprint || null),
    page: probe ? pageSummary(probe) : (target.page || null)
  };
}

function entryReady(entry) {
  return !!(entry && entry.page && entry.page.ready && !entry.page.loading);
}

// 主目标取"已经就绪的那个窗口"；顺序稳定，未就绪的排在后面当附加窗口
export function pickPrimary(entries) {
  return (Array.isArray(entries) ? entries : []).slice()
    .sort((a, b) => (entryReady(b) ? 1 : 0) - (entryReady(a) ? 1 : 0));
}

function fingerprintFor(target, page) {
  const material = [target.id, page && page.url, page && page.title, page && page.testidCount, page && page.htmlClass, page && page.rootChildren].join('|');
  return crypto.createHash('sha256').update(material).digest('hex');
}

function pageSummary(page) {
  return {
    ready: !!page.ready,
    loading: !!page.loading,
    rootChildren: page.rootChildren,
    testidCount: page.testidCount,
    htmlClass: page.htmlClass,
    bodyClass: page.bodyClass,
    dark: isDark(page),
    backgroundToken: page.backgroundToken,
    foregroundToken: page.foregroundToken
  };
}

function ownershipMessage(profile, hostInfo) {
  const port = hostInfo.port || {};
  if (port.listening && port.path && !port.matchesExe) {
    return `端口 ${profile.port} 被其他进程占用：${port.path} (PID ${port.pid})。`;
  }
  if (port.listening && port.loopbackOnly === false) {
    return `调试端口 ${profile.port} 正在监听非回环地址（${port.localAddress}），已拒绝连接。`;
  }
  const selected = hostInfo.selected;
  if (port.listening && selected && port.pid && port.pid !== selected.pid) {
    return `端口 ${profile.port} 的 PID (${port.pid}) 与 ZCode 主进程 (${selected.pid}) 不一致。`;
  }
  return `端口归属校验失败：${hostInfo.reason || '原因未知'}`;
}

function fallbackHostInfo(profile, error) {
  return {
    installed: fs.existsSync(profile.exe),
    running: false,
    selected: null,
    port: { listening: false, matchesExe: false, loopbackOnly: false },
    ownership: { verified: false },
    reason: `PowerShell 宿主探测失败：${error.message}`,
    errorCode: 'HOST_UNREACHABLE'
  };
}

export function createDetector({ profile = ZCODE_PROFILE, appRoot, timeoutMs = 1500, cacheMs = 2000 } = {}) {
  let cached = null;
  let cachedAt = 0;

  async function probe() {
    let hostInfo;
    let platformError = null;
    try {
      hostInfo = await runPowerShellJson('host/detect.ps1', {
        appRoot,
        args: ['-ExePath', profile.exe, '-Port', profile.port],
        timeout: 15000
      });
    } catch (error) {
      platformError = error;
      hostInfo = fallbackHostInfo(profile, error);
    }

    const installed = !!hostInfo.installed;
    const selected = hostInfo.selected || null;
    const running = !!selected;
    const port = hostInfo.port || {};
    const ownership = hostInfo.ownership || { verified: false };
    const supported = profile.isSupportedVersion(selected && selected.version);

    let browser = null;
    let userAgent = null;
    let pageTarget = null;
    let page = null;
    let pageTargets = [];
    let cdpError = null;
    let fetchError = null;

    if (running && port.listening) {
      try {
        const version = await fetchJson(`http://127.0.0.1:${profile.port}/json/version`, timeoutMs);
        const list = await fetchJson(`http://127.0.0.1:${profile.port}/json/list`, timeoutMs);
        browser = version.Browser || null;
        userAgent = version['User-Agent'] || null;
        pageTargets = rendererTargets(list, profile);

        pageTargets = await Promise.all(pageTargets.map(async (target) => {
          if (!target.webSocketDebuggerUrl) return { target, page: null };
          try {
            const session = await CdpSession.open(target.webSocketDebuggerUrl, { timeoutMs: 5000 });
            try {
              return { target, page: await session.evaluate(profile.fingerprintExpression()) };
            } finally {
              session.close();
            }
          } catch (error) {
            cdpError = cdpError || error;
            return { target, page: null };
          }
        }));

        // 主目标取"已经就绪的那个窗口"：刚点开、还没挂载完的窗口
        // 不该把整个宿主判成未就绪（那会让皮肤显示"需处理"）。
        pageTargets = pickPrimary(pageTargets);
        pageTarget = pageTargets.length ? pageTargets[0].target : null;
        page = pageTargets.length ? pageTargets[0].page : null;
      } catch (error) {
        cdpError = error;
        fetchError = error;
        pageTargets = [];
      }
    }

    const targetSummaries = pageTargets.map(({ target, page: probe }) => targetSummary(target, probe));
    const fingerprint = pageTarget ? fingerprintFor(pageTarget, page) : null;

    const pageReady = !!(pageTarget && page && page.ready && !page.loading);
    const portOwnedByOther = !!(port.listening && port.path && !port.matchesExe);
    const reason = (() => {
      if (!installed) return `未找到 ZCode（已自动搜索运行进程、注册表和开始菜单）：${profile.exe}。可设置环境变量 ZCODE_PATH 指向 ZCode.exe。`;
      if (!running) {
        if (portOwnedByOther) return `端口 ${profile.port} 被其他进程占用：${port.path} (PID ${port.pid})。`;
        return 'ZCode 未运行。请先启动 ZCode。';
      }
      if (!port.listening) return `ZCode 已运行，但调试端口 ${profile.port} 未开放。请完全退出 ZCode 后带 --remote-debugging-port=${profile.port} 重新启动。`;
      if (!ownership.verified) return platformError ? hostInfo.reason : ownershipMessage(profile, hostInfo);
      if (!supported.ok) return supported.reason;
      if (!pageTarget) return fetchError
        ? `无法读取 ZCode 调试端口 ${profile.port}：${fetchError.message}`
        : '未找到 ZCode 渲染页面。';
      if (cdpError) return `ZCode 页面指纹读取失败：${cdpError.message}`;
      if (!pageReady) return 'ZCode 页面尚未就绪（缺少 #root 或 zcode-startup-ready）。';
      return '调试端口与页面指纹校验通过';
    })();

    const errorCode = (() => {
      if (!installed) return 'HOST_NOT_FOUND';
      if (!running) return portOwnedByOther ? 'HOST_UNREACHABLE' : 'HOST_NOT_FOUND';
      if (!port.listening) return 'HOST_NOT_READY';
      if (!ownership.verified) return 'HOST_UNREACHABLE';
      if (!supported.ok) return 'HOST_UNSUPPORTED';
      if (!pageTarget || cdpError) return 'HOST_UNREACHABLE';
      if (!pageReady) return 'HOST_NOT_READY';
      return null;
    })();

    return {
      host: profile.id,
      hostName: profile.name,
      installed,
      running,
      ready: pageReady,
      supported: supported.ok,
      supportedReason: supported.ok ? null : supported.reason,
      path: profile.exe,
      port: profile.port,
      portOpen: !!port.listening,
      version: selected ? selected.version || null : null,
      process: selected ? {
        pid: selected.pid,
        path: selected.path,
        version: selected.version,
        commandLine: selected.commandLine
      } : null,
      processes: Array.isArray(hostInfo.processes) ? hostInfo.processes.length : 0,
      owner: port.listening ? {
        pid: port.pid,
        path: port.path,
        localAddress: port.localAddress,
        loopbackOnly: !!port.loopbackOnly,
        matchesExe: !!port.matchesExe
      } : null,
      ownership: {
        exe: !!ownership.exe,
        port: !!ownership.port,
        loopback: !!ownership.loopback,
        pid: !!ownership.pid,
        verified: !!ownership.verified
      },
      debugPortFromCommandLine: !!hostInfo.debugPortFromCommandLine,
      browser,
      userAgent,
      target: pageTarget ? {
        id: pageTarget.id,
        url: pageTarget.url,
        title: pageTarget.title || '',
        wsUrl: pageTarget.webSocketDebuggerUrl || null,
        fingerprint
      } : null,
      targets: targetSummaries,
      page: page ? pageSummary(page) : null,
      safeToInject: !!(ownership.verified && supported.ok && pageReady),
      reason,
      errorCode,
      checkedAt: new Date().toISOString()
    };
  }

  return {
    profile,
    async detect({ force = false } = {}) {
      const now = Date.now();
      if (!force && cached && now - cachedAt < cacheMs) return cached;
      cached = await probe();
      cachedAt = now;
      return cached;
    },
    invalidate() {
      cached = null;
      cachedAt = 0;
    },
    // 只刷新一轮窗口列表（不跑宿主探测、不做指纹），给多窗口补打用
    async targets() {
      const list = await fetchJson(`http://127.0.0.1:${profile.port}/json/list`, timeoutMs);
      return rendererTargets(list, profile).map((target) => targetSummary(target, null));
    }
  };
}
