export const PROTOCOL_VERSION = 'dreamskin.manager/1';

const TIMEOUT_MS = 30000;

function nativeBridge() {
  const webview = window.chrome.webview;
  const pending = new Map();
  const listeners = new Map();
  // The kernel keeps its dedupe cache across page reloads; scope ids to this page load.
  const session = Math.random().toString(36).slice(2, 8);
  let seq = 0;

  const dispatch = (event, data) => {
    const set = listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) {
      try { handler(data); } catch (error) { console.error('[bridge] event handler failed', error); }
    }
  };

  const onMessage = (event) => {
    const message = event.data;
    if (!message || typeof message !== 'object') return;

    if (message.type === 'response') {
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      clearTimeout(entry.timer);
      entry.resolve(message);
      return;
    }

    if (message.type === 'event') dispatch(message.event, message.data);
  };

  webview.addEventListener('message', onMessage);

  return {
    native: true,
    request(method, params = {}, timeoutMs = TIMEOUT_MS) {
      return new Promise((resolve) => {
        const id = `ui-${session}-${++seq}`;
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ v: PROTOCOL_VERSION, id, type: 'response', ok: false, error: { code: 'TIMEOUT', message: 'no response from shell', retryable: true } });
        }, timeoutMs);

        pending.set(id, { resolve, timer });

        try {
          webview.postMessage({ v: PROTOCOL_VERSION, id, type: 'request', method, params });
        } catch (error) {
          pending.delete(id);
          clearTimeout(timer);
          resolve({ v: PROTOCOL_VERSION, id, type: 'response', ok: false, error: { code: 'POST_FAILED', message: String(error && error.message || error), retryable: false } });
        }
      });
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => {
        const set = listeners.get(event);
        if (!set) return;
        set.delete(handler);
        if (!set.size) listeners.delete(event);
      };
    },
    // 壳用它判断启动窗何时交接：React 完成首屏数据（hello + 主题列表 + 设置）后调用一次。
    notifyReady() {
      try {
        webview.postMessage({ signal: 'ui.ready' });
      } catch {
        /* 启动窗有自己的超时回退，丢了也不影响 */
      }
    },
    close() {
      webview.removeEventListener('message', onMessage);
    }
  };
}

function mockBridge() {
  const startedAt = Date.now();
  const listeners = new Map();
  const applied = { themeId: null, name: null, params: null, paused: false };

  const envelope = (id, data) => ({ v: PROTOCOL_VERSION, id, type: 'response', ok: true, data });
  const failure = (id, code, message, retryable = false) => ({
    v: PROTOCOL_VERSION, id, type: 'response', ok: false, error: { code, message, retryable }
  });

  const emit = (event, data) => {
    const set = listeners.get(event);
    if (!set) return;
    for (const handler of [...set]) handler(data);
  };

  const publish = () => {
    emit('theme.status', {
      themeId: applied.themeId,
      paused: applied.paused,
      state: !applied.themeId ? 'restored' : applied.paused ? 'paused' : 'running'
    });
  };

  return {
    native: false,
    async request(method, params = {}) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      const id = `mock-${Math.random().toString(36).slice(2, 8)}`;

      switch (method) {
        case 'system.hello':
          return envelope(id, {
            protocol: PROTOCOL_VERSION,
            kernel: 'backdropbuddy-browser-mock/1.0.0',
            node: 'browser',
            capabilities: ['theme.list', 'theme.apply', 'theme.pause', 'theme.resume', 'theme.reset', 'theme.restore', 'status.get', 'host.detect']
          });
        case 'system.ping':
          return envelope(id, { pong: true, at: Date.now() });
        case 'status.get':
          return envelope(id, {
            protocol: PROTOCOL_VERSION,
            startedAt,
            running: !!applied.themeId,
            theme: applied.themeId ? { themeId: applied.themeId, name: applied.name } : null,
            paused: applied.paused
          });
        case 'host.detect':
          return envelope(id, {
            host: 'browser',
            installed: false,
            running: false,
            ready: false,
            reason: '浏览器演示模式，未连接桌面宿主'
          });
        case 'theme.list':
          return envelope(id, { themes: [] });
        case 'theme.apply': {
          if (!params || typeof params.themeId !== 'string' || !params.themeId) {
            return failure(id, 'BAD_PARAMS', 'themeId required');
          }
          applied.themeId = params.themeId;
          applied.name = typeof params.name === 'string' ? params.name : params.themeId;
          applied.params = params.params || {};
          applied.paused = false;
          publish();
          return envelope(id, { themeId: applied.themeId, paused: false });
        }
        case 'theme.pause':
          if (!applied.themeId) return failure(id, 'BAD_PARAMS', 'no applied theme');
          applied.paused = true;
          publish();
          return envelope(id, { paused: true });
        case 'theme.resume':
          if (!applied.themeId) return failure(id, 'BAD_PARAMS', 'no applied theme');
          applied.paused = false;
          publish();
          return envelope(id, { paused: false });
        case 'theme.reset':
          applied.params = {};
          publish();
          return envelope(id, { paused: applied.paused });
        case 'theme.restore':
          applied.themeId = null;
          applied.name = null;
          applied.params = null;
          applied.paused = false;
          publish();
          return envelope(id, { restored: true });
        default:
          return failure(id, 'METHOD_NOT_FOUND', `unknown method: ${method}`);
      }
    },
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => {
        const set = listeners.get(event);
        if (!set) return;
        set.delete(handler);
        if (!set.size) listeners.delete(event);
      };
    },
    notifyReady() {},
    close() {}
  };
}

export function createBridge() {
  if (typeof window !== 'undefined' && window.chrome && window.chrome.webview) return nativeBridge();
  return mockBridge();
}
