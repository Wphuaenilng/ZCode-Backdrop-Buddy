import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger } from '../../kernel/util/logger.mjs';
import { validateProfile } from '../../kernel/host/user-profiles.mjs';
import { createGenericProfile, buildGenericThemeCss, cssSelectorsFor } from '../../kernel/host/generic.mjs';
import { runPowerShellJson } from '../../kernel/platform/exec.mjs';
import { PROTOCOL_VERSION, METHODS } from '../../shared/protocol/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const RAW = {
  id: 'varless-demo',
  name: 'Varless Demo',
  exe: 'C:\\fake\\varless.exe',
  port: 9345,
  rendererPattern: '^http://localhost:5199/',
  readySelector: '#app',
  rootSelector: '#app',
  darkClass: null,
  darkTarget: 'body',
  tokenTarget: 'body',
  themedTarget: 'body',
  backgroundVar: '',
  foregroundVar: '',
  surfaceSelectors: ['.page'],
  glassSelectors: ['section.card'],
  textSelectors: ['body', 'section.card'],
  skipSelector: '.pet-root',
  varMap: {}
};

const TOKENS = { panel: 'rgba(255,255,255,0.55)', dim: 'rgba(20,16,14,0.05)', foreground: '#2a2320', contrast: '#fff' };
const TOKENS_BY_MODE = {
  light: { ...TOKENS, foreground: '#2a2320' },
  dark: { ...TOKENS, foreground: '#e8e8ea' }
};

test('无变量宿主：profile 校验允许空变量与空 varMap', () => {
  const ok = validateProfile(RAW);
  assert.equal(ok.ok, true, JSON.stringify(ok.errors));
  assert.equal(ok.profile.backgroundVar, '');
  assert.deepEqual(ok.profile.varMap, {});
  assert.deepEqual(ok.profile.textSelectors, ['body', 'section.card']);
  assert.equal(ok.profile.skipSelector, '.pet-root');

  const noVarsField = validateProfile({ ...RAW, backgroundVar: undefined, foregroundVar: undefined, varMap: undefined, textSelectors: undefined, skipSelector: undefined });
  assert.equal(noVarsField.ok, true, JSON.stringify(noVarsField.errors));
  assert.deepEqual(noVarsField.profile.textSelectors, []);
  assert.equal(noVarsField.profile.skipSelector, null);

  const badVar = validateProfile({ ...RAW, backgroundVar: 'color-bg' });
  assert.equal(badVar.ok, false, '变量名写错还是要挡下来');

  const badSkip = validateProfile({ ...RAW, skipSelector: 'div{color:red}' });
  assert.equal(badSkip.ok, false, 'skipSelector 里不许带大括号');

  const badText = validateProfile({ ...RAW, textSelectors: ['body', 'a{b}'] });
  assert.equal(badText.ok, false, '文字选择器同样要过白名单形状检查');
});

test('无变量宿主：CSS 用选择器压文字色，且能过 PowerShell 白名单', async (t) => {
  const data = validateProfile(RAW).profile;
  const css = buildGenericThemeCss(data, {
    params: { accent: '#c98f8f', panel: 55 },
    media: null,
    tokens: TOKENS_BY_MODE.light,
    tokensByMode: TOKENS_BY_MODE,
    mode: 'light'
  });

  assert.match(css, /body,?\s*section\.card\s*\{[^}]*color: #2a2320 !important/s, '浅色文字色要压到文字选择器上');
  assert.doesNotMatch(css, /#e8e8ea/, '宿主没有明暗切换时不该凭空造一份深色');
  assert.match(css, /--bb-backdrop-image/, '背景层仍要按模式给');
  assert.doesNotMatch(css, /--color-background/, '没有变量就别硬编一个');

  // 有明暗类名时，两种前景色各压一份
  const withDark = validateProfile({ ...RAW, darkClass: 'dark', darkTarget: 'body' }).profile;
  const darkCss = buildGenericThemeCss(withDark, {
    params: { accent: '#c98f8f', panel: 55 },
    media: null,
    tokens: TOKENS_BY_MODE.light,
    tokensByMode: TOKENS_BY_MODE,
    mode: 'light'
  });
  assert.match(darkCss, /color: #2a2320 !important/);
  assert.match(darkCss, /color: #e8e8ea !important/);
  assert.match(darkCss, /body\.dark/, '深色规则要挂在宿主的模式类上');

  const selectors = cssSelectorsFor(data);
  assert.ok(selectors.includes('section.card'));
  assert.ok(selectors.includes('.page'));

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-varless-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'theme.css');
  fs.writeFileSync(file, css, 'utf8');
  const result = await runPowerShellJson('theme/validate-css.ps1', {
    appRoot: ROOT,
    args: ['-Path', file, '-ExtraSelectors', selectors.join('|')]
  });
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 300));
});

// 无变量假宿主：没有背景 token，只有我们注入的 --bb-dim 哨兵；其中一个窗口是"桌宠"
function fakeVarless() {
  const windows = new Map();
  const add = (id, { pet = false } = {}) => windows.set(id, { id, pet, themeId: null, paused: false, style: false, layer: false });
  const summary = (win) => ({
    id: win.id,
    url: 'http://localhost:5199/',
    title: 'Varless',
    wsUrl: `ws://127.0.0.1:9345/devtools/page/${win.id}`,
    fingerprint: `fp-${win.id}`,
    page: { ready: true, loading: false, dark: false, rootChildren: 1, testidCount: 0, htmlClass: '', bodyClass: '', backgroundToken: '', foregroundToken: '' }
  });
  const session = async (targetOrStatus) => {
    const key = targetOrStatus && targetOrStatus.id ? targetOrStatus.id : null;
    const win = key ? windows.get(key) : [...windows.values()][0];
    if (!win) throw new Error('no window');
    return {
      close() {},
      async evaluate(script) {
        if (script.includes('document.querySelector(".pet-root")')) return win.pet;
        if (script.includes('const THEME_ID = ')) {
          const themeId = script.match(/const THEME_ID = ("[^"]*")/);
          win.themeId = themeId ? JSON.parse(themeId[1]) : null;
          win.style = true;
          win.layer = true;
          win.paused = false;
          return true;
        }
        if (script.includes("removeAttribute('src')")) {
          win.themeId = null;
          win.style = false;
          win.layer = false;
          win.paused = false;
          return { style: false, layer: false, video: false, themed: null, background: '', dark: false };
        }
        if (script.includes('style.disabled = true')) {
          win.paused = true;
          return { paused: true, styleDisabled: true, background: '', dim: win.style ? 'rgba(0,0,0,0.05)' : '', dark: false, layerVisible: false };
        }
        if (script.includes('style.disabled = false')) {
          win.paused = false;
          return { paused: false, styleDisabled: false, background: '', dim: win.style ? 'rgba(0,0,0,0.05)' : '', dark: false, layerVisible: true };
        }
        if (script.includes('themed:')) {
          return {
            style: win.style,
            layer: win.layer,
            video: false,
            kind: null,
            background: '',
            dim: win.style ? 'rgba(0,0,0,0.05)' : '',
            layerImage: win.layer ? 'url("file:///C:/data/backdrop.png")' : null,
            videoReady: null,
            themed: win.themeId,
            dark: false,
            paused: win.paused
          };
        }
        if (script.includes('testidCount')) {
          return {
            url: 'http://localhost:5199/', title: 'Varless', ready: true, loading: false, rootChildren: 1, testidCount: 0,
            htmlClass: '', bodyClass: 'x', darkClass: false, backgroundToken: '', foregroundToken: '',
            injected: { style: win.style, layer: win.layer, video: false },
            tokens: { background: '', foreground: '', sidebar: '', border: '' }
          };
        }
        throw new Error('unexpected script: ' + script.slice(0, 60));
      }
    };
  };
  const detector = {
    detect: async () => {
      const list = [...windows.values()].map(summary);
      return {
        host: 'varless-demo', hostName: 'Varless Demo', installed: true, running: true, ready: true, portOpen: true, supported: true,
        ownership: { verified: true }, target: list[0] || null, targets: list, page: list[0] ? list[0].page : null,
        path: RAW.exe, port: RAW.port, checkedAt: new Date().toISOString()
      };
    },
    invalidate() {},
    targets: async () => [...windows.values()].map(summary)
  };
  return { windows, add, session, detector, list: () => [...windows.values()] };
}

test('无变量宿主：靠 --bb-dim 哨兵判定注入成功，桌宠窗口按 skipSelector 跳过', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-varless-run-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const world = fakeVarless();
  world.add('settings');
  world.add('chat');
  world.add('pet', { pet: true });

  const kernel = await createKernel({
    dataDir,
    appRoot: ROOT,
    seedLocalAssets: false,
    logger: createLogger({ dir: path.join(dataDir, 'logs'), level: 'error' }),
    detector: world.detector,
    session: world.session,
    profile: createGenericProfile(validateProfile(RAW).profile)
  });
  t.after(() => kernel.close());

  let seq = 0;
  const call = (method, params = {}) => kernel.handle({ v: PROTOCOL_VERSION, id: `v-${++seq}`, type: 'request', method, params });
  await call(METHODS.SYSTEM_HELLO);

  const saved = await call(METHODS.THEME_SAVE, { name: '无变量主题' });
  const applied = await call(METHODS.THEME_APPLY, { themeId: saved.data.theme.id });
  assert.equal(applied.ok, true, JSON.stringify(applied.error || {}));
  assert.equal(applied.data.windows.count, 2, '只打非桌宠的两个窗口');

  const settingsWin = world.windows.get('settings');
  const petWin = world.windows.get('pet');
  assert.equal(settingsWin.themeId, saved.data.theme.id);
  assert.equal(petWin.themeId, null, '桌宠窗口必须原样不动');

  const paused = await call(METHODS.THEME_PAUSE);
  assert.equal(paused.data.verified, true, '没有色值可比时不该误报失败');
  assert.equal(paused.data.tokenMatch, null);
  assert.equal(settingsWin.paused, true);

  const resumed = await call(METHODS.THEME_RESUME);
  assert.equal(resumed.data.verified, true);

  const restored = await call(METHODS.THEME_RESTORE);
  assert.equal(restored.ok, true, JSON.stringify(restored.error || {}));
  assert.ok(world.list().every((win) => win.themeId === null && win.layer === false));
});
