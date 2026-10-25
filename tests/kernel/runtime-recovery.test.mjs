import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger } from '../../kernel/util/logger.mjs';
import { ZCODE_PROFILE } from '../../kernel/host/zcode.mjs';
import { PROTOCOL_VERSION, METHODS } from '../../shared/protocol/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGINAL_BG = 'rgba(255,255,255,1.00)';

function fakeHostPage() {
  const page = { themeId: null, css: '', paused: false };

  const panelColor = () => {
    const match = page.css.match(/--color-background:\s*([^;!]+)/);
    return match ? match[1].trim() : ORIGINAL_BG;
  };

  const session = async () => ({
    close() {},
    async evaluate(script) {
      if (script.includes('const THEME_ID = ')) {
        const themeId = script.match(/const THEME_ID = ("[^"]*")/);
        const css = script.match(/const CSS = ("(?:[^"\\]|\\.)*")/);
        page.themeId = themeId ? JSON.parse(themeId[1]) : null;
        page.css = css ? JSON.parse(css[1]) : '';
        page.paused = false;
        return true;
      }
      if (script.includes("removeAttribute('src')")) {
        page.themeId = null;
        page.css = '';
        page.paused = false;
        return { style: false, layer: false, video: false, themed: null, background: ORIGINAL_BG };
      }
      if (script.includes('themed:')) {
        return {
          style: !!page.themeId,
          layer: !!page.themeId,
          video: false,
          kind: null,
          background: page.paused ? ORIGINAL_BG : panelColor(),
          layerImage: null,
          videoReady: null,
          themed: page.themeId,
          paused: page.paused
        };
      }
      if (script.includes('style.disabled = true')) {
        page.paused = true;
        return { paused: true, styleDisabled: true, background: ORIGINAL_BG, layerVisible: false };
      }
      if (script.includes('style.disabled = false')) {
        page.paused = false;
        return { paused: false, styleDisabled: false, background: panelColor(), layerVisible: true };
      }
      if (script.includes('testidCount')) {
        return {
          url: 'file:///test/renderer/index.html',
          title: 'ZCode',
          ready: true,
          loading: false,
          htmlClass: 'theme-zai-light',
          bodyClass: 'zcode-startup-ready',
          testidCount: 12,
          injected: { style: page.themeId === null ? false : true, layer: false, video: false },
          tokens: { background: ORIGINAL_BG, foreground: '#1c1c1e', sidebar: ORIGINAL_BG, border: 'rgba(0,0,0,0.12)' }
        };
      }
      throw new Error('unexpected script: ' + script.slice(0, 80));
    }
  });

  return { page, session };
}

function fakeDetector() {
  const status = {
    host: 'zcode',
    installed: true,
    running: true,
    ready: true,
    portOpen: true,
    supported: true,
    ownership: { verified: true },
    target: { id: 'test-target', url: 'file:///test/renderer/index.html', fingerprint: 'test' },
    page: { dark: false },
    path: 'C:\\fake\\ZCode.exe',
    port: 9229
  };
  return {
    detect: async () => status,
    invalidate() {}
  };
}

function request(id, method, params = {}) {
  return { v: PROTOCOL_VERSION, id, type: 'request', method, params };
}

async function openKernel(dataDir, { session, hostRoot, detector }) {
  return createKernel({
    dataDir,
    appRoot: ROOT,
    seedLocalAssets: false,
    logger: createLogger({ dir: path.join(dataDir, 'logs'), level: 'error' }),
    detector: detector || fakeDetector(),
    session,
    profile: { ...ZCODE_PROFILE, exe: path.join(hostRoot, 'ZCode.exe'), hostRoot, port: 9229 }
  });
}

test('runtime recovery: pause, resume and reset survive a kernel restart', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-runtime-'));
  const hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-runtime-host-'));
  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(hostRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(hostRoot, 'ZCode.exe'), 'fake-exe', 'utf8');

  const host = fakeHostPage();
  const options = { session: host.session, hostRoot };

  const first = await openKernel(dataDir, options);
  let themeId;
  try {
    let seq = 0;
    const call = (method, params = {}) => first.handle(request(`a-${++seq}`, method, params));
    assert.equal((await call(METHODS.SYSTEM_HELLO)).ok, true);
    const saved = await call(METHODS.THEME_SAVE, { name: '重启回归' });
    themeId = saved.data.theme.id;
    const applied = await call(METHODS.THEME_APPLY, { themeId });
    assert.equal(applied.ok, true);
    assert.equal(applied.data.injected, true);

    const runtimeFile = path.join(dataDir, 'themes', 'runtime.json');
    assert.equal(fs.existsSync(runtimeFile), true);
    const persisted = JSON.parse(fs.readFileSync(runtimeFile, 'utf8'));
    assert.equal(persisted.schema, 'backdropbuddy.runtime/1');
    assert.equal(persisted.state.theme.id, themeId);
    assert.equal(persisted.state.hostHash.targetId, 'test-target');
    assert.ok(persisted.state.baseline);
  } finally {
    await first.close();
  }

  assert.equal(host.page.themeId, themeId);

  const second = await openKernel(dataDir, options);
  try {
    let seq = 0;
    const call = (method, params = {}) => second.handle(request(`b-${++seq}`, method, params));
    await call(METHODS.SYSTEM_HELLO);

    assert.equal(second.adoption.adopted, true);
    const outcome = await second.adoption.ready;
    assert.equal(outcome.cleared, false);
    assert.equal(outcome.reason, 'verified');

    const status = await call(METHODS.STATUS_GET);
    assert.equal(status.data.running, true);
    assert.equal(status.data.theme.themeId, themeId);
    assert.equal(status.data.host.applied.themeId, themeId);

    const paused = await call(METHODS.THEME_PAUSE);
    assert.equal(paused.ok, true, JSON.stringify(paused.error || {}));
    assert.equal(paused.data.paused, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'themes', 'runtime.json'), 'utf8')).state.paused, true);

    const resumed = await call(METHODS.THEME_RESUME);
    assert.equal(resumed.ok, true, JSON.stringify(resumed.error || {}));
    assert.equal(resumed.data.paused, false);

    const reset = await call(METHODS.THEME_RESET);
    assert.equal(reset.ok, true, JSON.stringify(reset.error || {}));
    assert.equal(reset.data.reset, true);

    const restored = await call(METHODS.THEME_RESTORE);
    assert.equal(restored.ok, true, JSON.stringify(restored.error || {}));
    assert.equal(fs.existsSync(path.join(dataDir, 'themes', 'runtime.json')), false);
    assert.equal(host.page.themeId, null);
  } finally {
    await second.close();
  }
});

test('runtime recovery: a page without the injection clears the stale pointer', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-runtime-clean-'));
  const hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-runtime-clean-host-'));
  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(hostRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(hostRoot, 'ZCode.exe'), 'fake-exe', 'utf8');

  const host = fakeHostPage();
  const options = { session: host.session, hostRoot };

  const first = await openKernel(dataDir, options);
  try {
    let seq = 0;
    const call = (method, params = {}) => first.handle(request(`c-${++seq}`, method, params));
    await call(METHODS.SYSTEM_HELLO);
    const saved = await call(METHODS.THEME_SAVE, { name: '将被清掉的' });
    await call(METHODS.THEME_APPLY, { themeId: saved.data.theme.id });
  } finally {
    await first.close();
  }

  host.page.themeId = null;

  const second = await openKernel(dataDir, options);
  try {
    let seq = 0;
    const call = (method, params = {}) => second.handle(request(`d-${++seq}`, method, params));
    await call(METHODS.SYSTEM_HELLO);

    assert.equal(second.adoption.adopted, true);
    const outcome = await second.adoption.ready;
    assert.equal(outcome.cleared, true);
    assert.equal(outcome.reason, 'page-clean');

    const audit = await second.audit;
    assert.equal(audit.verdict, 'stale-pointer');
    assert.equal(audit.attention, true);
    assert.equal(audit.action, 'reapply');

    const status = await call(METHODS.STATUS_GET);
    assert.equal(status.data.running, false);
    assert.equal(status.data.theme, null);
    assert.equal(status.data.host.applied, null);

    const pointer = JSON.parse(fs.readFileSync(path.join(dataDir, 'themes', 'pointer.json'), 'utf8'));
    assert.equal(pointer.activeThemeId, null);
    assert.equal(fs.existsSync(path.join(dataDir, 'themes', 'runtime.json')), false);
    const settings = await call(METHODS.SETTINGS_GET);
    assert.equal(settings.data.settings.selectedThemeId, null);
  } finally {
    await second.close();
  }
});

test('startup audit: a leftover layer without a pointer is reported as orphan-layer', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-audit-orphan-'));
  const hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-audit-orphan-host-'));
  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(hostRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(hostRoot, 'ZCode.exe'), 'fake-exe', 'utf8');

  const host = fakeHostPage();
  const options = { session: host.session, hostRoot };

  const first = await openKernel(dataDir, options);
  let themeId;
  try {
    let seq = 0;
    const call = (method, params = {}) => first.handle(request(`o-${++seq}`, method, params));
    await call(METHODS.SYSTEM_HELLO);
    const saved = await call(METHODS.THEME_SAVE, { name: '残留主题' });
    themeId = saved.data.theme.id;
    assert.equal((await call(METHODS.THEME_APPLY, { themeId })).ok, true);
  } finally {
    await first.close();
  }

  // 记录侧丢失（模拟写入前被强杀），宿主页面仍带着注入层
  fs.writeFileSync(
    path.join(dataDir, 'themes', 'pointer.json'),
    JSON.stringify({ activeThemeId: null, activeName: null, params: null, paused: false, revision: 99, updatedAt: new Date().toISOString() }),
    'utf8'
  );
  fs.rmSync(path.join(dataDir, 'themes', 'runtime.json'), { force: true });
  assert.equal(host.page.themeId, themeId);

  const second = await openKernel(dataDir, options);
  try {
    const audit = await second.audit;
    assert.equal(audit.verdict, 'orphan-layer');
    assert.equal(audit.attention, true);
    assert.equal(audit.action, 'restore');
    assert.equal(audit.themeId, themeId);
    assert.equal(audit.page.themed, themeId);

    let seq = 0;
    const call = (method, params = {}) => second.handle(request(`p-${++seq}`, method, params));
    await call(METHODS.SYSTEM_HELLO);
    const status = await call(METHODS.STATUS_GET);
    assert.equal(status.data.host.recovery.verdict, 'orphan-layer');
    assert.equal(status.data.running, false);

    const restored = await call(METHODS.THEME_RESTORE);
    assert.equal(restored.ok, true, JSON.stringify(restored.error || {}));
    assert.equal(host.page.themeId, null);

    const after = await call(METHODS.STATUS_GET);
    assert.equal(after.data.host.recovery.verdict, 'clean');
    assert.equal(after.data.host.recovery.attention, false);
  } finally {
    await second.close();
  }
});

test('startup audit: a port owned by another process is reported as port-conflict', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-audit-port-'));
  const hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-audit-port-host-'));
  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(hostRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(hostRoot, 'ZCode.exe'), 'fake-exe', 'utf8');

  const detector = {
    detect: async () => ({
      host: 'zcode',
      installed: true,
      running: false,
      ready: false,
      portOpen: true,
      supported: false,
      ownership: { verified: false },
      target: null,
      page: null,
      path: 'C:\fake\ZCode.exe',
      port: 9229,
      owner: { pid: 4321, path: 'C:\Tools\other.exe', matchesExe: false },
      reason: '端口 9229 被其他进程占用：C:\Tools\other.exe (PID 4321)',
      errorCode: 'HOST_UNREACHABLE'
    }),
    invalidate() {}
  };

  const kernel = await openKernel(dataDir, { hostRoot, detector });
  try {
    const audit = await kernel.audit;
    assert.equal(audit.verdict, 'port-conflict');
    assert.equal(audit.attention, true);
    assert.equal(audit.action, 'redetect');
    assert.equal(audit.host.owner.pid, 4321);
    assert.equal(audit.host.owner.matchesExe, false);

    const status = await kernel.handle(request('q-1', METHODS.STATUS_GET));
    assert.equal(status.data.host.recovery.verdict, 'port-conflict');
  } finally {
    await kernel.close();
  }
});
