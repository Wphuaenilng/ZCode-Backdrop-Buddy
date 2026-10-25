import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger } from '../../kernel/util/logger.mjs';
import { ZCODE_PROFILE } from '../../kernel/host/zcode.mjs';
import { buildGenericThemeCss } from '../../kernel/host/generic.mjs';
import { PROTOCOL_VERSION, METHODS } from '../../shared/protocol/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ORIGINAL_BG = 'rgba(255,255,255,1.00)';

// 取注入 CSS 里某个模式块中的变量值
function blockVar(css, name, mode) {
  const block = mode === 'dark'
    ? css.match(/html\.dark, html\.theme-zai-dark \{([\s\S]*?)\n\}/)
    : css.match(/:root, html\.theme-zai-light \{([\s\S]*?)\n\}/);
  if (!block) return null;
  // 真实页面读计算样式时不含 !important，取 CSS 也要把它剔掉
  const entry = block[1].match(new RegExp(name.replace(/-/g, '\\-') + ':\\s*([^;!]+)'));
  return entry ? entry[1].trim() : null;
}

// 按「块 → --bb-backdrop-image 值」收集，验证渐变底确实各模式一份
function backdropImageByBlock(css) {
  const map = new Map();
  let block = null;
  for (const raw of css.split('\n')) {
    const line = raw.trim();
    if (line.endsWith('{') && !line.includes(';')) block = line.slice(0, -1).trim();
    else if (line === '}') block = null;
    else if (block && line.startsWith('--bb-backdrop-image:')) {
      map.set(block, line.slice('--bb-backdrop-image:'.length).trim().replace(/;$/, ''));
    }
  }
  return map;
}

const TOKENS_BY_MODE = {
  light: { panel: 'rgba(255,255,255,0.35)', dim: 'rgba(255,255,255,0.2)', contrast: '#000000', foreground: '#1c1c1e' },
  dark: { panel: 'rgba(18,18,20,0.41)', dim: 'rgba(18,18,20,0.18)', contrast: '#ffffff', foreground: '#e8e8ea' }
};
const CSS_ARGS = {
  params: { accent: '#c98f8f' },
  media: null,
  tokens: TOKENS_BY_MODE.dark,
  tokensByMode: TOKENS_BY_MODE,
  mode: 'dark'
};

const GENERIC_DATA = {
  id: 'demo-host', name: 'Demo', exe: 'C:\\fake\\demo.exe', port: 9333,
  rendererPattern: 'index.html', readySelector: 'body', rootSelector: '.app',
  darkClass: 'dark', darkTarget: 'html', tokenTarget: 'body', themedTarget: 'body',
  backgroundVar: '--background-primary', foregroundVar: '--text-normal',
  surfaceSelectors: ['.pane'], glassSelectors: ['.card']
};

test('明暗适配：zcode 与 generic 的渐变底都按模式各写一份', () => {
  const cases = [
    ['zcode', ZCODE_PROFILE.buildThemeCss(CSS_ARGS)],
    ['generic', buildGenericThemeCss(GENERIC_DATA, CSS_ARGS)]
  ];
  for (const [label, css] of cases) {
    const blocks = backdropImageByBlock(css);
    const values = [...blocks.values()];
    assert.ok(values.length >= 2, `${label}：至少两个模式块要各有一个 --bb-backdrop-image，实际 ${values.length}`);
    assert.ok(new Set(values).size > 1, `${label}：浅色与深色的渐变底必须不同`);
    assert.match(css, /background-image: var\(--bb-backdrop-image\)/, `${label}：背景层只引用变量`);
    assert.doesNotMatch(css, /background-image: radial-gradient/, `${label}：背景层不该再写死渐变`);
  }

  // 图片 / 视频主题与模式无关，两块必须同值
  const withImage = backdropImageByBlock(ZCODE_PROFILE.buildThemeCss({ ...CSS_ARGS, media: { kind: 'image', url: 'bds://a.png' } }));
  assert.equal(new Set(withImage.values()).size, 1, '有图片素材时两块应为同一张图');
  assert.ok([...withImage.values()][0].startsWith('url("bds://a.png")'));
});

// 假页面：带一个可翻转的明暗模式，token 值按当前模式从注入的 CSS 里取
function fakeHostPage(mode = 'dark') {
  const page = { mode, css: '', themeId: null, paused: false };

  const currentBackground = () => (
    !page.paused && page.css ? blockVar(page.css, '--color-background', page.mode) || ORIGINAL_BG : ORIGINAL_BG
  );

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
        return { style: false, layer: false, video: false, themed: null, background: ORIGINAL_BG, dark: page.mode === 'dark' };
      }
      if (script.includes('style.disabled = true')) {
        page.paused = true;
        return { paused: true, styleDisabled: true, background: ORIGINAL_BG, dark: page.mode === 'dark', layerVisible: false };
      }
      if (script.includes('style.disabled = false')) {
        page.paused = false;
        return { paused: false, styleDisabled: false, background: currentBackground(), dark: page.mode === 'dark', layerVisible: true };
      }
      if (script.includes('themed:')) {
        return {
          style: !!page.themeId,
          layer: !!page.themeId,
          video: false,
          kind: null,
          background: currentBackground(),
          layerImage: page.css ? getLayerImage(page.css, page.mode) : null,
          videoReady: null,
          themed: page.themeId,
          dark: page.mode === 'dark',
          paused: page.paused
        };
      }
      if (script.includes('testidCount')) {
        return {
          url: 'file:///test/renderer/index.html',
          title: 'ZCode',
          ready: true,
          loading: false,
          rootChildren: 3,
          testidCount: 12,
          htmlClass: page.mode === 'dark' ? 'dark theme-zai-dark' : 'theme-zai-light',
          bodyClass: 'zcode-startup-ready',
          darkClass: page.mode === 'dark',
          backgroundToken: ORIGINAL_BG,
          foregroundToken: page.mode === 'dark' ? '#e8e8ea' : '#1c1c1e',
          injected: { style: page.themeId !== null, layer: false, video: false },
          tokens: { background: ORIGINAL_BG, foreground: '#1c1c1e', sidebar: ORIGINAL_BG, border: 'rgba(0,0,0,0.12)' }
        };
      }
      throw new Error('unexpected script: ' + script.slice(0, 80));
    }
  });

  return { page, session };
}

// 背景层此刻实际渲染出来的 background-image（渐变按模式块取变量）
function getLayerImage(css, mode) {
  const image = blockVar(css, '--bb-backdrop-image', mode);
  return image ? `url(${image.slice(0, 40)})` : null;
}

function fakeDetector(mode) {
  return {
    detect: async () => ({
      host: 'zcode',
      installed: true,
      running: true,
      ready: true,
      portOpen: true,
      supported: true,
      ownership: { verified: true },
      target: { id: 'mode-target', url: 'file:///test/renderer/index.html', fingerprint: 'mode-test' },
      page: { dark: mode === 'dark' },
      path: 'C:\\fake\\ZCode.exe',
      port: 9229
    }),
    invalidate() {}
  };
}

function request(id, method, params = {}) {
  return { v: PROTOCOL_VERSION, id, type: 'request', method, params };
}

async function openKernel(dataDir, hostRoot, options) {
  return createKernel({
    dataDir,
    appRoot: ROOT,
    seedLocalAssets: false,
    logger: createLogger({ dir: path.join(dataDir, 'logs'), level: 'error' }),
    ...options
  });
}

test('明暗适配：切过明暗后暂停/继续不再误报校验失败', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mode-'));
  const hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-mode-host-'));
  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(hostRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(hostRoot, 'ZCode.exe'), 'fake-exe', 'utf8');

  const host = fakeHostPage('dark');
  const kernel = await openKernel(dataDir, hostRoot, {
    detector: fakeDetector('dark'),
    session: host.session,
    profile: { ...ZCODE_PROFILE, exe: path.join(hostRoot, 'ZCode.exe'), hostRoot, port: 9229 }
  });

  try {
    let seq = 0;
    const call = (method, params = {}) => kernel.handle(request(`m-${++seq}`, method, params));
    await call(METHODS.SYSTEM_HELLO);

    const saved = await call(METHODS.THEME_SAVE, { name: '明暗回归' });
    const themeId = saved.data.theme.id;
    const applied = await call(METHODS.THEME_APPLY, { themeId });
    assert.equal(applied.ok, true, JSON.stringify(applied.error || {}));
    assert.equal(host.page.mode, 'dark');

    // 宿主切到浅色：注入层还在，只是 token 换了另一块
    host.page.mode = 'light';

    const paused = await call(METHODS.THEME_PAUSE);
    assert.equal(paused.ok, true, JSON.stringify(paused.error || {}));
    assert.equal(paused.data.paused, true);
    assert.equal(paused.data.verified, true, '暂停后按宿主原色校验，翻过模式也不该失败');

    const resumed = await call(METHODS.THEME_RESUME);
    assert.equal(resumed.ok, true, JSON.stringify(resumed.error || {}));
    assert.equal(resumed.data.paused, false);
    assert.equal(resumed.data.verified, true, '继续后必须按浅色那一套 token 校验通过');
    assert.equal(resumed.data.background, host.page.css ? blockVar(host.page.css, '--color-background', 'light') : null);
  } finally {
    await kernel.close();
  }
});
