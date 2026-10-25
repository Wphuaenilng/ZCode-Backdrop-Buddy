import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger } from '../../kernel/util/logger.mjs';
import { createGenericProfile } from '../../kernel/host/generic.mjs';
import { createHostAdapter } from '../../kernel/host/adapter.mjs';
import { createRegistry } from '../../kernel/host/registry.mjs';
import { saveUserProfile } from '../../kernel/host/user-profiles.mjs';
import { RuntimeStore } from '../../kernel/store/runtime.mjs';
import { resolvePaths } from '../../kernel/store/paths.mjs';
import { buildSuggestion } from '../../kernel/host/autoscan.mjs';
import { PROTOCOL_VERSION, METHODS } from '../../shared/protocol/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const CHATGPT_INFO = {
  url: 'app://-/index.html',
  title: 'ChatGPT',
  port: 9232,
  vars: [
    { name: '--color-surface', value: '#181818', target: 'html' },
    { name: '--color-text-primary', value: '#ffffff', target: 'html' },
    { name: '--color-border-soft', value: 'rgba(255,255,255,0.07)', target: 'html' }
  ],
  darkCandidates: [],
  darkAttrCandidates: [{ target: 'html', attr: 'data-theme', value: 'dark' }],
  csp: { present: true, inlineStyle: true, fileImage: false, blobImage: true, fileVideo: false, blobVideo: true },
  readyCandidates: [{ selector: '#root', area: 100 }],
  surfaces: [{ selector: '#app-shell-sidebar', area: 5000 }]
};

test('autoscan: 从指纹直接产出可保存的 ChatGPT 形态 profile', async () => {
  const { saveUserProfile: save } = await import('../../kernel/host/user-profiles.mjs');
  const found = buildSuggestion(CHATGPT_INFO, { existingIds: [] });
  assert.ok(found, '应产出建议');
  const s = found.suggestion;
  assert.equal(s.rendererPattern, '^app://-/');
  assert.equal(s.rootSelector, '#root');
  assert.equal(s.darkAttr, 'data-theme');
  assert.equal(s.darkAttrValue, 'dark');
  assert.equal(s.darkTarget, 'html');
  assert.equal(s.backgroundVar, '--color-surface');
  assert.equal(s.tokenTarget, 'html');
  assert.equal(s.mediaDelivery, 'blob');
  assert.equal(s.surfaceSelectors[0], '#app-shell-sidebar');
  assert.equal(s.varMap['--color-surface'], 'panel');

  // 建议（补上 exe 后）要能通过正式校验并保存
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-suggest-'));
  try {
    const saved = save(dir, { ...s, exe: 'C:\\Apps\\ChatGPT\\ChatGPT.exe' });
    assert.equal(saved.ok, true, JSON.stringify(saved.errors));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- host.use：双宿主切换 + 每宿主壁纸记忆 ----------

const HOST_DATA = (id, port) => ({
  id, name: id === 'host-a' ? 'Host A' : 'Host B', exe: `C:\\fake\\${id}.exe`, port,
  rendererPattern: `app://${id}/`,
  readySelector: '.app-root', rootSelector: '.app-root',
  darkClass: 'theme-dark', darkTarget: 'body',
  backgroundVar: '--background-primary', foregroundVar: '--text-normal',
  varMap: { '--background-primary': 'panel', '--text-normal': 'foreground' },
  surfaceSelectors: ['.app-root']
});

// 每个宿主一份假页面（表达式标记与内核通用表达式一一对应）
function fakeSessionState() {
  return { themeId: null, css: '', paused: false };
}

function fakeSessionFor(state) {
  return async () => ({
    close() {},
    async evaluate(script) {
      if (script.includes('const THEME_ID = ')) {
        const themeId = script.match(/const THEME_ID = ("[^"]*")/);
        const css = script.match(/const CSS = ("(?:[^"\\]|\\.)*")/);
        state.themeId = themeId ? JSON.parse(themeId[1]) : null;
        state.css = css ? JSON.parse(css[1]) : '';
        state.paused = false;
        return true;
      }
      if (script.includes("removeAttribute('src')")) {
        state.themeId = null;
        state.css = '';
        return { style: false, layer: false, video: false, themed: null, background: 'transparent' };
      }
      if (script.includes('style.disabled = true')) {
        state.paused = true;
        return { paused: true, styleDisabled: true, background: 'transparent', dark: false, layerVisible: false };
      }
      if (script.includes('style.disabled = false')) {
        state.paused = false;
        return { paused: false, styleDisabled: false, background: panelOf(state), dark: false, layerVisible: true };
      }
      if (script.includes('themed:')) {
        return {
          style: !!state.themeId, layer: !!state.themeId, video: false, kind: null,
          background: state.paused ? 'transparent' : panelOf(state), dim: 'rgba(0,0,0,0.2)',
          layerImage: state.css ? 'url("x")' : null, videoReady: null,
          themed: state.themeId, dark: false, paused: state.paused
        };
      }
      if (script.includes('testidCount')) {
        return {
          url: 'app://x/index.html', title: 'X', ready: true, loading: false, rootChildren: 3,
          htmlClass: '', bodyClass: 'theme-light', darkClass: false,
          backgroundToken: '#ffffff', foregroundToken: '#222222', version: null
        };
      }
      throw new Error('unexpected script: ' + script.slice(0, 90));
    }
  });
}

const panelOf = (state) => {
  const m = state.css.match(/--background-primary:s*([^;!]+)/);
  return m ? m[1].trim() : 'rgba(255,255,255,0.3)';
};

test('host.use：切换宿主并按宿主记忆自动补壁纸', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-switch-'));
  const hostsDir = path.join(dataDir, 'hosts');
  fs.mkdirSync(hostsDir, { recursive: true });
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  assert.equal(saveUserProfile(hostsDir, HOST_DATA('host-a', 9334)).ok, true);
  assert.equal(saveUserProfile(hostsDir, HOST_DATA('host-b', 9335)).ok, true);
  const registry = createRegistry({ hostsDir });

  const states = { 'host-a': fakeSessionState(), 'host-b': fakeSessionState() };
  // 与真内核同构：所有适配器共用一个 runtime store（adopt 靠它对账）
  const sharedRuntime = new RuntimeStore(path.join(dataDir, 'runtime.json'));
  const detectorFor = (id) => ({
    detect: async () => ({
      host: id, installed: true, running: true, ready: true, portOpen: true, supported: true,
      ownership: { verified: true },
      target: { id: `${id}-target`, url: `app://${id}/index.html`, fingerprint: 'test' },
      page: { dark: false }, path: `C:\\fake\\${id}.exe`, port: HOST_DATA(id, 0).port
    }),
    invalidate() {}
  });
  const adapterFor = (profile) => {
    const id = profile.id;
    return createHostAdapter({
      detector: detectorFor(id),
      logger: null,
      appRoot: ROOT,
      // paths 为 null 时适配器会把 apply 备份回落写到 appRoot/backup（仓库根目录），
      // 必须给完整 paths，让备份与缓存都落在测试的临时 dataDir 里
      paths: resolvePaths({ dataRoot: dataDir, appRoot: ROOT }),
      profile,
      runtime: sharedRuntime,
      getPreferences: () => ({}),
      session: fakeSessionFor(states[id])
    });
  };

  const kernel = await createKernel({
    dataDir,
    appRoot: ROOT,
    seedLocalAssets: false,
    registry,
    profile: createGenericProfile(HOST_DATA('host-a', 9334)),
    host: adapterFor(createGenericProfile(HOST_DATA('host-a', 9334))),
    logger: createLogger({ dir: path.join(dataDir, 'logs'), level: 'error' }),
    buildHostAdapter: adapterFor
  });

  try {
    let seq = 0;
    const call = (method, params = {}) => kernel.handle({ v: PROTOCOL_VERSION, id: `s-${++seq}`, type: 'request', method, params });
    await call(METHODS.SYSTEM_HELLO);

    // 两个真主题入库（自动补应用要求主题在库里，临时主题补不回来）
    const savedA = await call(METHODS.THEME_SAVE, { name: 'A 的壁纸' });
    const themeA = savedA.data.theme.id;
    const savedB = await call(METHODS.THEME_SAVE, { name: 'B 的壁纸' });
    const themeB = savedB.data.theme.id;

    // 宿主 A 应用主题 A → hostThemes['host-a'] 记住
    const applied1 = await call(METHODS.THEME_APPLY, { themeId: themeA });
    assert.equal(applied1.ok, true, JSON.stringify(applied1.error || {}));
    assert.equal(states['host-a'].themeId, themeA);
    assert.equal(kernel.ctx.config.get().hostThemes['host-a'], themeA);

    // 切到宿主 B：指针被校对清空（B 页面没有皮肤），无记忆不自动应用
    const switchB = await call(METHODS.HOST_USE, { id: 'host-b' });
    assert.equal(switchB.ok, true, JSON.stringify(switchB.error || {}));
    assert.equal(switchB.data.hostId, 'host-b');
    assert.equal(kernel.ctx.hostProfile.id, 'host-b');
    assert.equal(kernel.ctx.pointer.read().activeThemeId, null, 'B 页面干净，指针应被清空');
    assert.equal(switchB.data.appliedTheme, null);

    // 宿主 B 应用主题 B → hostThemes['host-b']；A 的皮肤还留在 A 的页面里
    const applied2 = await call(METHODS.THEME_APPLY, { themeId: themeB });
    assert.equal(applied2.ok, true, JSON.stringify(applied2.error || {}));
    assert.equal(states['host-b'].themeId, themeB);
    assert.equal(states['host-a'].themeId, themeA, 'A 的注入不受切换影响');

    // 切回宿主 A：自动补上它上次的壁纸
    const switchBack = await call(METHODS.HOST_USE, { id: 'host-a' });
    assert.equal(switchBack.ok, true, JSON.stringify(switchBack.error || {}));
    assert.equal(switchBack.data.appliedTheme, themeA, '应自动补上 A 的记忆壁纸');
    assert.equal(kernel.ctx.pointer.read().activeThemeId, themeA);
    assert.equal(states['host-b'].themeId, themeB, 'B 的皮肤继续留在 B 上');

    // 未知宿主要报错（注册表或切换层任一拦截）
    const unknown = await call(METHODS.HOST_USE, { id: 'nope' });
    assert.equal(unknown.ok, false);
    assert.match(unknown.error.message, /unknown host|未知宿主/);

    const status = await call(METHODS.STATUS_GET);
    assert.equal(status.data.hostId, 'host-a');
  } finally {
    await kernel.close();
  }
});
