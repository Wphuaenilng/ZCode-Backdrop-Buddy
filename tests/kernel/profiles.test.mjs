import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger } from '../../kernel/util/logger.mjs';
import { ZCODE_PROFILE } from '../../kernel/host/zcode.mjs';
import { createGenericProfile } from '../../kernel/host/generic.mjs';
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
  // 向导产出的 generic profile 与内置 ZCode 同接口，向导宿主才能复用同一套适配器
  const GENERIC = createGenericProfile(GENERIC_HOST_DATA);
  for (const profile of [ZCODE_PROFILE, GENERIC]) {
    for (const key of INTERFACE) {
      assert.ok(key in profile, `${profile.id} 缺少 ${key}`);
    }
    assert.equal(typeof profile.buildThemeCss, 'function');
    assert.equal(typeof profile.injectionExpression, 'function');
    assert.match(profile.rendererPattern.source, /.+/);
  }

  assert.equal(ZCODE_PROFILE.id, 'zcode');
  assert.equal(GENERIC.id, 'agent-app');
  assert.ok(resolveProfile({}).exe.length > 0, 'ZCode 解析后要有 exe 路径');
  assert.ok(GENERIC.exe.length > 0);
  assert.notEqual(resolveProfile({}).port, GENERIC.port, '两个宿主不能共用调试端口');
});

test('profiles: expressions carry their own tokens and ids', () => {
  const zcodeVerify = ZCODE_PROFILE.verifyExpression();
  const genericVerify = createGenericProfile(GENERIC_HOST_DATA).verifyExpression();

  assert.match(zcodeVerify, /--color-background/);
  assert.match(zcodeVerify, /document\.documentElement\.getAttribute\('data-bb-theme'\)/);
  assert.match(genericVerify, /--background-primary/);
  assert.match(genericVerify, /document\.body\.getAttribute\('data-bb-theme'\)/);
  assert.match(createGenericProfile({ ...GENERIC_HOST_DATA, darkClass: 'theme-dark' }).fingerprintExpression(), /theme-dark/);
  assert.match(ZCODE_PROFILE.fingerprintExpression(), /classList\.contains\('dark'\)/);
});

test('registry: resolves by env and rejects unknown hosts', () => {
  assert.equal(resolveProfile({}).id, 'zcode');
  assert.throws(() => resolveProfile({ BACKDROPBUDDY_HOST: 'codex' }), /unknown host/);
  assert.throws(() => resolveProfile({ BACKDROPBUDDY_HOST: 'obsidian' }), /unknown host/, 'Obsidian 已下线，应报未知宿主');

  const hosts = listHosts();
  assert.deepEqual(hosts.map((h) => h.id), ['zcode', 'chatgpt']);
  assert.equal(resolveProfile({ BACKDROPBUDDY_HOST: 'chatgpt' }).id, 'chatgpt');
  assert.equal(resolveProfile({ BACKDROPBUDDY_HOST: 'chatgpt' }).port, 9232);
});

// 向导会产出的那种纯数据宿主：一个带 CSS 变量的 agent 应用形态。
const GENERIC_HOST_DATA = {
  id: 'agent-app', name: 'Agent App', exe: 'C:\\fake\\AgentApp.exe', port: 9334,
  rendererPattern: 'app://agent\\.app/',
  readySelector: '.app-root', rootSelector: '.app-root',
  darkClass: 'theme-dark', darkTarget: 'body',
  backgroundVar: '--background-primary', foregroundVar: '--text-normal',
  varMap: { '--background-primary': 'panel', '--text-normal': 'foreground' },
  surfaceSelectors: ['.app-root', '.side-pane'], glassSelectors: ['.chat-card']
};

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
          url: 'app://agent.app/index.html',
          title: 'Agent App 1.0.0',
          ready: true,
          loading: false,
          rootChildren: 3,
          htmlClass: '',
          bodyClass: 'agent-app theme-light',
          darkClass: false,
          backgroundToken: '#ffffff',
          foregroundToken: '#222222',
          version: '1.0.0'
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
      host: 'agent-app',
      installed: true,
      running: true,
      ready: true,
      portOpen: true,
      supported: true,
      ownership: { verified: true },
      target: { id: 'agent-app-target', url: 'app://agent.app/index.html', fingerprint: 'test' },
      page: { dark: false },
      path: 'C:\\fake\\AgentApp.exe',
      port: 9334
    }),
    invalidate() {}
  };
}

test('adapter: CSP 不给 file: 的宿主走页面内建 blob 交付', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-blob-'));
  const hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-blob-host-'));
  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(hostRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(hostRoot, 'AgentApp.exe'), 'fake-exe', 'utf8');

  // 一个带图片媒体的用户主题（真实文件，亮度分析走真路径）
  const themeDir = path.join(dataDir, 'themes', 'user', 'blob-demo');
  fs.mkdirSync(themeDir, { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'assets', 'paper-light.jpg'), path.join(themeDir, 'media.jpg'));
  fs.writeFileSync(path.join(themeDir, 'theme.json'), JSON.stringify({
    schema: 'backdropbuddy.theme/1',
    id: 'blob-demo',
    name: 'Blob 交付',
    tags: [],
    params: {},
    media: { kind: 'image', file: 'media.jpg', thumb: null, mime: 'image/jpeg' }
  }), 'utf8');

  const injected = { css: '', blobUrls: [] };
  const panel = () => { const m = injected.css.match(/--background-primary:s*([^;!]+)/); return m ? m[1].trim() : 'rgba(255,255,255,0.3)'; };
  const session = async () => ({
    close() {},
    async evaluate(script) {
      if (script.includes('window.__bbBuf = []')) return true;
      if (script.includes('window.__bbBuf.push(')) return true;
      if (script.includes('URL.createObjectURL')) {
        const url = `blob:app:///fake-${injected.blobUrls.length + 1}`;
        injected.blobUrls.push(url);
        return url;
      }
      if (script.includes('const THEME_ID = ')) {
        const css = script.match(/const CSS = ("(?:[^"\\]|\\.)*")/);
        injected.css = css ? JSON.parse(css[1]) : '';
        return true;
      }
      if (script.includes("removeAttribute('src')") || script.includes("removeAttribute('data-bb-theme')")) {
        injected.css = '';
        return { style: false, layer: false, video: false, themed: null, background: 'transparent' };
      }
      if (script.includes('style.disabled = true')) {
        return { paused: true, styleDisabled: true, background: 'transparent', dark: false, layerVisible: false };
      }
      if (script.includes('style.disabled = false')) {
        return { paused: false, styleDisabled: false, background: panel(), dark: false, layerVisible: true };
      }
      if (script.includes('themed:')) {
        return {
          style: !!injected.css, layer: !!injected.css, video: false, kind: 'image',
          background: panel(), dim: 'rgba(0,0,0,0.2)', layerImage: `url("${injected.blobUrls[0] || 'none'}")`,
          videoReady: null, themed: injected.css ? 'blob-demo' : null, dark: false, paused: false
        };
      }
      if (script.includes('testidCount')) {
        return {
          url: 'app://agent.app/index.html', title: 'Agent App 1.0.0', ready: true, loading: false,
          rootChildren: 3, htmlClass: '', bodyClass: 'agent-app theme-light', darkClass: false,
          backgroundToken: '#ffffff', foregroundToken: '#222222', version: '1.0.0'
        };
      }
      throw new Error('unexpected script: ' + script.slice(0, 80));
    }
  });

  const detector = {
    detect: async () => ({
      host: 'agent-app', installed: true, running: true, ready: true, portOpen: true, supported: true,
      ownership: { verified: true },
      target: { id: 'blob-target', url: 'app://agent.app/index.html', fingerprint: 'test' },
      page: { dark: false }, path: path.join(hostRoot, 'AgentApp.exe'), port: 9334
    }),
    invalidate() {}
  };
  const profile = createGenericProfile({ ...GENERIC_HOST_DATA, exe: path.join(hostRoot, 'AgentApp.exe'), mediaDelivery: 'blob' });
  const kernel = await createKernel({
    dataDir, appRoot: ROOT, seedLocalAssets: false,
    logger: createLogger({ dir: path.join(dataDir, 'logs'), level: 'error' }),
    detector, session, profile
  });

  try {
    let seq = 0;
    const call = (method, params = {}) => kernel.handle({ v: PROTOCOL_VERSION, id: `b-${++seq}`, type: 'request', method, params });
    await call(METHODS.SYSTEM_HELLO);

    const applied = await call(METHODS.THEME_APPLY, { themeId: 'blob-demo' });
    assert.equal(applied.ok, true, JSON.stringify(applied.error || {}));
    assert.equal(applied.data.injected, true);
    assert.ok(injected.blobUrls.length >= 1, '页面上至少创建了一个 blob URL');
    assert.match(injected.css, /url\("blob:app:\/\/\/fake-1"\)/, '注入 CSS 必须换成 blob: 地址');
    assert.doesNotMatch(injected.css, /url\("file:\/\/\//, 'file:// 地址不能出现在最终注入里');

    const paused = await call(METHODS.THEME_PAUSE);
    assert.equal(paused.ok, true, JSON.stringify(paused.error || {}));
    const resumed = await call(METHODS.THEME_RESUME);
    assert.equal(resumed.ok, true, JSON.stringify(resumed.error || {}));

    const restored = await call(METHODS.THEME_RESTORE);
    assert.equal(restored.ok, true, JSON.stringify(restored.error || {}));
    assert.equal(injected.css, '');
  } finally {
    await kernel.close();
  }
});

test('adapter: a wizard host is driven entirely by its profile', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-profile-'));
  const hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-profile-host-'));
  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(hostRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(hostRoot, 'AgentApp.exe'), 'fake-exe', 'utf8');

  const host = fakeHostPage();
  const profile = createGenericProfile({ ...GENERIC_HOST_DATA, exe: path.join(hostRoot, 'AgentApp.exe') });
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

    const saved = await call(METHODS.THEME_SAVE, { name: '向导宿主冒烟' });
    const themeId = saved.data.theme.id;

    const applied = await call(METHODS.THEME_APPLY, { themeId });
    assert.equal(applied.ok, true, JSON.stringify(applied.error || {}));
    assert.equal(applied.data.injected, true);
    assert.equal(applied.data.target.id, 'agent-app-target');
    assert.equal(host.page.themeId, themeId);
    assert.match(host.page.css, /--background-primary/, 'CSS 应该写宿主自己的变量而不是 ZCode 的');

    const paused = await call(METHODS.THEME_PAUSE);
    assert.equal(paused.ok, true, JSON.stringify(paused.error || {}));
    assert.equal(paused.data.paused, true);

    const resumed = await call(METHODS.THEME_RESUME);
    assert.equal(resumed.ok, true, JSON.stringify(resumed.error || {}));
    assert.equal(resumed.data.paused, false);

    const status = await call(METHODS.STATUS_GET);
    assert.equal(status.data.host.host, 'agent-app');
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

