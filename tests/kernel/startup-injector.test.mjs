import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runStartupInjector, isStartupRendererUrl } from '../../kernel/host/startup-injector.mjs';
import {
  createStartupPreviewHtml,
  normalizeStartupTemplate,
  startupScript
} from '../../kernel/host/startup-template.mjs';

const MAIN_URL = 'file:///F:/shop/ZCode/resources/app.asar/out/renderer/index.html';
const LAUNCH_ID = '12345678-abcd-4ef0-aaaa-1234567890ab';

class FakeBrowser {
  constructor({ url = MAIN_URL, type = 'page', launchId = LAUNCH_ID, currentTimeOrigin = 100 } = {}) {
    this.url = url;
    this.type = type;
    this.launchId = launchId;
    this.currentTimeOrigin = currentTimeOrigin;
    this.handlers = new Map();
    this.calls = [];
    this.closed = false;
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, new Set());
    this.handlers.get(method).add(handler);
    return () => this.handlers.get(method)?.delete(handler);
  }

  fire(method, params, sessionId = 'main-session') {
    for (const handler of this.handlers.get(method) || []) handler(params, { sessionId });
  }

  reportInstalled(timeOrigin, sessionId = 'main-session') {
    this.fire('Runtime.bindingCalled', {
      name: '__backdropBuddyStartupReport',
      payload: JSON.stringify({ stage: 'installed', launchId: this.launchId, timeOrigin })
    }, sessionId);
  }

  async send(method, params, timeoutMs, sessionId) {
    this.calls.push({ method, params, timeoutMs, sessionId });
    if (method === 'Target.setAutoAttach') {
      queueMicrotask(() => this.fire('Target.attachedToTarget', {
        sessionId: 'main-session',
        targetInfo: { targetId: 'main', type: this.type, url: this.url },
        waitingForDebugger: true
      }, 'browser'));
      return {};
    }
    if (method === 'Runtime.evaluate') {
      this.reportInstalled(this.currentTimeOrigin, sessionId);
      return { result: { value: { installed: true, timeOrigin: this.currentTimeOrigin } } };
    }
    if (method === 'Page.reload') {
      // CDP acknowledges reload before the replacement document executes.
      setTimeout(() => this.reportInstalled(this.currentTimeOrigin + 1, sessionId), 0);
      return {};
    }
    return {};
  }

  close() {
    this.closed = true;
  }
}

function options(browser, extra = {}) {
  return {
    port: 9229,
    template: { launchId: LAUNCH_ID, themeName: '测试主题', preset: 'zcode-pop' },
    waitPortMs: 30,
    settleMs: 60,
    watchdogMs: 40,
    fetchVersion: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/browser/fake' }),
    openSession: async () => browser,
    emit() {},
    ...extra
  };
}

test('startup template: sanitizes preset data and never accepts remote code or media', () => {
  const normalized = normalizeStartupTemplate({
    preset: 'not-a-preset',
    holdMs: 99999,
    themeName: `  ${'名'.repeat(40)}  `,
    accent: 'url(javascript:alert(1))',
    mediaUrl: 'https://evil.example/a.jpg',
    launchId: 'bad id'
  });
  assert.equal(normalized.preset, 'zcode-pop');
  assert.equal(normalized.holdMs, 3000);
  assert.equal(normalized.themeName.length, 24);
  assert.equal(normalized.accent, '#6f9275');
  assert.equal(normalized.mediaUrl, null);
  assert.equal(normalized.launchId, 'preview');

  const source = startupScript({ launchId: LAUNCH_ID, themeName: '</script><script>alert(1)</script>' });
  assert.doesNotMatch(source, /<\/script><script>/);
  assert.match(source, /sessionStorage/);
  assert.match(source, /#loading\{opacity:0!important\}/);
  assert.match(source, /-webkit-app-region:drag/);
  assert.match(source, /3500 - fadeMs/);
  assert.doesNotMatch(source, /https?:\/\/evil/);

  const html = createStartupPreviewHtml({ mediaUrl: 'https://media.backdropbuddy.invalid/user/demo/thumb.jpg' });
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /connect-src 'none'/);
  assert.doesNotMatch(html, /allow-same-origin/);
});

test('startup target: only the main ZCode renderer is eligible', () => {
  assert.equal(isStartupRendererUrl(MAIN_URL), true);
  assert.equal(isStartupRendererUrl(`${MAIN_URL}?windowKind=update-status`), false);
  assert.equal(isStartupRendererUrl('file:///F:/plugin-sandbox/out/renderer/index.html'), false);
  assert.equal(isStartupRendererUrl('https://example.com/out/renderer/index.html'), false);
  assert.equal(isStartupRendererUrl('about:blank'), false);
  assert.equal(isStartupRendererUrl('about:blank', { allowBlank: true }), true);
});

test('startup injector: queues document_start before resume and confirms the handoff document', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-startup-injector-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const resultPath = path.join(dir, 'result.json');
  const browser = new FakeBrowser();
  const result = await runStartupInjector(options(browser, { resultPath }));

  assert.equal(result.attached, true);
  assert.equal(result.injected, true);
  assert.equal(result.reason, 'injected');
  assert.equal(browser.closed, true);
  assert.equal(JSON.parse(fs.readFileSync(resultPath, 'utf8')).injected, true);

  const methods = browser.calls.map((call) => call.method);
  assert.ok(methods.indexOf('Page.addScriptToEvaluateOnNewDocument') < methods.indexOf('Runtime.runIfWaitingForDebugger'));
  assert.ok(methods.indexOf('Runtime.runIfWaitingForDebugger') < methods.indexOf('Runtime.evaluate'));
  assert.ok(methods.indexOf('Runtime.evaluate') < methods.indexOf('Page.reload'));
  assert.equal(browser.calls.find((call) => call.method === 'Page.addScriptToEvaluateOnNewDocument').sessionId, 'main-session');
});

test('startup injector: blank and pre-navigation renderers are covered without forcing a reload', async () => {
  for (const url of ['about:blank', '']) {
    const browser = new FakeBrowser({ url });
    const originalSend = browser.send.bind(browser);
    browser.send = async (method, params, timeoutMs, sessionId) => {
      const result = await originalSend(method, params, timeoutMs, sessionId);
      if (method === 'Runtime.enable') queueMicrotask(() => browser.reportInstalled(200, sessionId));
      return result;
    };
    const result = await runStartupInjector(options(browser));
    assert.equal(result.injected, true);
    assert.equal(browser.calls.some((call) => call.method === 'Page.reload'), false);
    assert.equal(browser.calls.some((call) => call.method === 'Runtime.evaluate'), false);
  }
});

test('startup injector: secondary and embedded pages are resumed without injection', async () => {
  const browser = new FakeBrowser({ url: `${MAIN_URL}?windowKind=update-status` });
  const result = await runStartupInjector(options(browser, { settleMs: 25 }));
  assert.equal(result.attached, false);
  assert.equal(result.injected, false);
  assert.equal(result.reason, 'no-main-renderer');
  assert.ok(browser.calls.some((call) => call.method === 'Runtime.runIfWaitingForDebugger'));
  assert.equal(browser.calls.some((call) => call.method === 'Page.addScriptToEvaluateOnNewDocument'), false);
});

test('startup injector: connection and target failures return a fail-open result', async () => {
  const result = await runStartupInjector(options(null, {
    openSession: async () => { throw new Error('socket unavailable'); }
  }));
  assert.deepEqual({ attached: result.attached, injected: result.injected }, { attached: false, injected: false });
  assert.match(result.reason, /socket unavailable/);

  const broken = new FakeBrowser();
  const originalSend = broken.send.bind(broken);
  broken.send = async (method, params, timeoutMs, sessionId) => {
    if (method === 'Runtime.evaluate') throw new Error('evaluation rejected');
    return originalSend(method, params, timeoutMs, sessionId);
  };
  const fallback = await runStartupInjector(options(broken));
  assert.equal(fallback.injected, false);
  assert.match(fallback.reason, /evaluation rejected/);
  assert.equal(broken.closed, true);
});

test('startup injector: discovers a main renderer that existed before autoAttach', async () => {
  const browser = new FakeBrowser();
  const originalSend = browser.send.bind(browser);
  browser.send = async (method, params, timeoutMs, sessionId) => {
    browser.calls.push({ method, params, timeoutMs, sessionId });
    if (method === 'Target.setAutoAttach') return {};
    if (method === 'Target.getTargets') {
      return { targetInfos: [{ targetId: 'existing-main', type: 'page', url: MAIN_URL }] };
    }
    if (method === 'Target.attachToTarget') {
      queueMicrotask(() => browser.fire('Target.attachedToTarget', {
        sessionId: 'main-session',
        targetInfo: { targetId: 'existing-main', type: 'page', url: MAIN_URL },
        waitingForDebugger: false
      }, 'browser'));
      return { sessionId: 'main-session' };
    }
    if (method === 'Runtime.evaluate') {
      return { result: { value: { installed: true, timeOrigin: 100 } } };
    }
    if (method === 'Page.reload') {
      setTimeout(() => browser.reportInstalled(101, sessionId), 0);
      return {};
    }
    return {};
  };
  const result = await runStartupInjector(options(browser));
  assert.equal(result.injected, true);
  assert.equal(result.reason, 'injected');
  assert.ok(browser.calls.some((call) => call.method === 'Target.attachToTarget' && call.params.targetId === 'existing-main'));
  assert.ok(browser.calls.some((call) => call.method === 'Page.addScriptToEvaluateOnNewDocument'));
});

test('startup injector: deduplicates automatic and existing-target attachment for one renderer', async () => {
  const browser = new FakeBrowser();
  const originalSend = browser.send.bind(browser);
  browser.send = async (method, params, timeoutMs, sessionId) => {
    if (method === 'Target.setAutoAttach') {
      browser.calls.push({ method, params, timeoutMs, sessionId });
      queueMicrotask(() => {
        for (const duplicateSession of ['main-session-a', 'main-session-b']) {
          browser.fire('Target.attachedToTarget', {
            sessionId: duplicateSession,
            targetInfo: { targetId: 'main', type: 'page', url: MAIN_URL },
            waitingForDebugger: true
          }, 'browser');
        }
      });
      return {};
    }
    return originalSend(method, params, timeoutMs, sessionId);
  };

  const result = await runStartupInjector(options(browser));
  assert.equal(result.injected, true);
  assert.equal(result.reason, 'injected');
  assert.equal(browser.calls.filter((call) => call.method === 'Page.addScriptToEvaluateOnNewDocument').length, 1);
  assert.equal(browser.calls.filter((call) => call.method === 'Page.reload').length, 1);
  assert.ok(browser.calls.some((call) => call.method === 'Runtime.runIfWaitingForDebugger' && call.sessionId === 'main-session-b'));
});
