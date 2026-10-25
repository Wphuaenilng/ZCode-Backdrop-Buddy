import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger } from '../../kernel/util/logger.mjs';
import { ZCODE_PROFILE } from '../../kernel/host/zcode.mjs';
import { OBSIDIAN_PROFILE } from '../../kernel/host/obsidian.mjs';
import { listHosts, resolveProfile } from '../../kernel/host/registry.mjs';
import { PROTOCOL_VERSION, METHODS } from '../../shared/protocol/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const INTERFACE = [
  'id', 'name', 'rendererPattern',
  'readySelector', 'rootSelector', 'backgroundVar', 'foregroundVar',
  'buildThemeCss', 'normalizeThemeParams', 'isSupportedVersion',
  'fingerprintExpression', 'snapshotExpression', 'injectionExpression',
  'verifyExpression', 'pauseExpression', 'removeExpression'
];

test('profiles: every host exposes the same interface', () => {
  for (const profile of [ZCODE_PROFILE, OBSIDIAN_PROFILE]) {
    for (const key of INTERFACE) {
      assert.ok(key in profile, `${profile.id} 缺少 ${key}`);
    }
    assert.equal(typeof profile.buildThemeCss, 'function');
    assert.ok(resolveProfile({}).exe.length > 0);
    assert.equal(typeof profile.injectionExpression, 'function');
    assert.match(profile.rendererPattern.source, /.+/);
  }

  assert.equal(ZCODE_PROFILE.id, 'zcode');
  assert.equal(OBSIDIAN_PROFILE.id, 'obsidian');
  assert.notEqual(resolveProfile({}).port, resolveProfile({ BACKDROPBUDDY_HOST: 'obsidian' }).port, '两个宿主不能共用调试端口');
});

test('profiles: expressions carry their own tokens and ids', () => {
  const zcodeVerify = ZCODE_PROFILE.verifyExpression();
  const obsidianVerify = OBSIDIAN_PROFILE.verifyExpression();

  assert.match(zcodeVerify, /--color-background/);
  assert.match(zcodeVerify, /document\.documentElement\.getAttribute\('data-bb-theme'\)/);
  assert.match(obsidianVerify, /--background-primary/);
  assert.match(obsidianVerify, /document\.body\.getAttribute\('data-bb-theme'\)/);
  assert.match(OBSIDIAN_PROFILE.fingerprintExpression(), /theme-dark/);
  assert.match(ZCODE_PROFILE.fingerprintExpression(), /classList\.contains\('dark'\)/);
});

test('registry: resolves by env and rejects unknown hosts', () => {
  assert.equal(resolveProfile({}).id, 'zcode');
  assert.equal(resolveProfile({ BACKDROPBUDDY_HOST: 'obsidian' }).id, 'obsidian');
  assert.equal(resolveProfile({ BACKDROPBUDDY_HOST: 'OBSIDIAN' }).id, 'obsidian');
  assert.throws(() => resolveProfile({ BACKDROPBUDDY_HOST: 'codex' }), /unknown host/);

  const hosts = listHosts();
  assert.deepEqual(hosts.map((h) => h.id).sort(), ['obsidian', 'zcode']);
});

// 与 runtime-recovery.test.mjs 同构的假页面：只认表达式里的稳定标记，不关心宿主。
function fakeHostPage() {
  const page = { themeId: null, css: '', paused: false };
  const panel = () => { const m = page.css.match(/--background-primary:s*([^;!]+)/); return m ? m[1].trim() : 'rgba(255,255,255,0.3)'; };
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
        return { style: false, layer: false, video: false, themed: null, background: 'transparent' };
      }
      if (script.includes('style.disabled = true')) {
        page.paused = true;
        return { paused: true, styleDisabled: true, background: 'transparent', layerVisible: false };
      }
      if (script.includes('style.disabled = false')) {
        page.paused = false;
        return { paused: false, styleDisabled: false, background: panel(), layerVisible: true };
      }
      if (script.includes('themed:')) {
        return {
          style: !!page.themeId,
          layer: !!page.themeId,
          video: false,
          kind: null,
          background: page.paused ? 'transparent' : panel(),
          layerImage: 'url("file:///x.png")',
          videoReady: null,
          themed: page.themeId,
          paused: page.paused,
          rootZ: '1'
        };
      }
      if (script.includes('testidCount')) {
        return {
          url: 'app://obsidian.md/index.html',
          title: 'Obsidian 1.13.7',
          ready: true,
          loading: false,
          rootChildren: 3,
          htmlClass: '',
          bodyClass: 'obsidian-app theme-light',
          darkClass: false,
          backgroundToken: '#ffffff',
          foregroundToken: '#222222',
          version: '1.13.7'
        };
      }
      throw new Error('unexpected script: ' + script.slice(0, 90));
    }
  });
  return { page, session };
}

function fakeDetector() {
  return {
    detect: async () => ({
      host: 'obsidian',
      installed: true,
      running: true,
      ready: true,
      portOpen: true,
      supported: true,
      ownership: { verified: true },
      target: { id: 'obsidian-target', url: 'app://obsidian.md/index.html', fingerprint: 'test' },
      page: { dark: false },
      path: 'C:\\fake\\Obsidian.exe',
      port: 9334
    }),
    invalidate() {}
  };
}

test('adapter: a second host is driven entirely by its profile', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-profile-'));
  const hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-profile-host-'));
  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(hostRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(hostRoot, 'Obsidian.exe'), 'fake-exe', 'utf8');

  const host = fakeHostPage();
  const profile = resolveProfile({ BACKDROPBUDDY_HOST: 'obsidian', OBSIDIAN_PATH: path.join(hostRoot, 'Obsidian.exe') });
  const kernel = await createKernel({
    dataDir,
    appRoot: ROOT,
    seedLocalAssets: false,
    logger: createLogger({ dir: path.join(dataDir, 'logs'), level: 'error' }),
    detector: fakeDetector(),
    session: host.session,
    profile
  });

  try {
    let seq = 0;
    const call = (method, params = {}) => kernel.handle({ v: PROTOCOL_VERSION, id: `p-${++seq}`, type: 'request', method, params });
    await call(METHODS.SYSTEM_HELLO);

    const saved = await call(METHODS.THEME_SAVE, { name: 'Obsidian 冒烟' });
    const themeId = saved.data.theme.id;

    const applied = await call(METHODS.THEME_APPLY, { themeId });
    assert.equal(applied.ok, true, JSON.stringify(applied.error || {}));
    assert.equal(applied.data.injected, true);
    assert.equal(applied.data.target.id, 'obsidian-target');
    assert.equal(host.page.themeId, themeId);
    assert.match(host.page.css, /--background-primary/, 'CSS 应该写 Obsidian 的变量而不是 ZCode 的');

    const paused = await call(METHODS.THEME_PAUSE);
    assert.equal(paused.ok, true, JSON.stringify(paused.error || {}));
    assert.equal(paused.data.paused, true);

    const resumed = await call(METHODS.THEME_RESUME);
    assert.equal(resumed.ok, true, JSON.stringify(resumed.error || {}));
    assert.equal(resumed.data.paused, false);

    const status = await call(METHODS.STATUS_GET);
    assert.equal(status.data.host.host, 'obsidian');
    assert.equal(status.data.theme.themeId, themeId);
    assert.equal(status.data.host.recovery.attention, false);
    assert.equal(status.data.host.recovery.verdict, 'applied');

    const restored = await call(METHODS.THEME_RESTORE);
    assert.equal(restored.ok, true, JSON.stringify(restored.error || {}));
    assert.equal(host.page.themeId, null);
    assert.equal(host.page.css, '');
  } finally {
    await kernel.close();
  }
});

