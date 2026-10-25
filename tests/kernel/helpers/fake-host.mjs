import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../../kernel/app/kernel.mjs';
import { createLogger } from '../../../kernel/util/logger.mjs';
import { ZCODE_PROFILE } from '../../../kernel/host/zcode.mjs';
import { pickPrimary } from '../../../kernel/host/detect.mjs';
import { PROTOCOL_VERSION, METHODS } from '../../../shared/protocol/constants.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export const ORIGINAL_BG = 'rgba(255,255,255,1.00)';

// 取注入 CSS 里某个模式块中的变量值（真实页面读计算样式时不含 !important）
export function blockValue(css, name, dark) {
  const block = dark
    ? css.match(/html\.dark, html\.theme-zai-dark \{([\s\S]*?)\n\}/)
    : css.match(/:root, html\.theme-zai-light \{([\s\S]*?)\n\}/);
  if (!block) return null;
  const entry = block[1].match(new RegExp(name.replace(/-/g, '\\-') + ':\\s*([^;!]+)'));
  return entry ? entry[1].trim() : null;
}

export function request(id, method, params = {}) {
  return { v: PROTOCOL_VERSION, id, type: 'request', method, params };
}

// 一个会开多个渲染窗口的假宿主：每个窗口各自记录注入状态与明暗模式
export function fakeWorld() {
  const targets = new Map();
  let counter = 0;

  function openWindow({ dark = false, reject = false, ready = true } = {}) {
    const id = `win-${++counter}`;
    targets.set(id, {
      id,
      url: 'file:///test/renderer/index.html',
      wsUrl: `ws://127.0.0.1:9229/devtools/page/${id}`,
      title: 'ZCode',
      dark,
      reject,
      ready,
      themeId: null,
      media: null,
      css: '',
      paused: false
    });
    return id;
  }

  function summary(target) {
    return {
      id: target.id,
      url: target.url,
      title: target.title,
      wsUrl: target.wsUrl,
      fingerprint: `fp-${target.id}`,
      page: {
        ready: target.ready !== false,
        loading: false,
        rootChildren: 3,
        testidCount: 12,
        htmlClass: target.dark ? 'dark theme-zai-dark' : 'theme-zai-light',
        bodyClass: 'zcode-startup-ready',
        dark: target.dark,
        backgroundToken: ORIGINAL_BG,
        foregroundToken: target.dark ? '#e8e8ea' : '#1c1c1e'
      }
    };
  }

  const session = async (targetOrStatus) => {
    const key = targetOrStatus && targetOrStatus.id ? targetOrStatus.id : null;
    const win = key ? targets.get(key) : [...targets.values()][0];
    if (!win) throw new Error('no window');

    const background = () => (win.paused || !win.themeId
      ? ORIGINAL_BG
      : (blockValue(win.css, '--color-background', win.dark) || ORIGINAL_BG));

    return {
      close() {},
      async evaluate(script) {
        if (win.reject && script.includes('const THEME_ID = ')) throw new Error('该窗口拒绝注入');

        if (script.includes('const THEME_ID = ')) {
          const themeId = script.match(/const THEME_ID = ("[^"]*")/);
          const media = script.match(/const MEDIA = (null|\{[^}]*\});/);
          const css = script.match(/const CSS = ("(?:[^"\\]|\\.)*")/);
          win.themeId = themeId ? JSON.parse(themeId[1]) : null;
          win.media = media && media[1] !== 'null' ? JSON.parse(media[1]) : null;
          win.css = css ? JSON.parse(css[1]) : '';
          win.paused = false;
          return true;
        }
        if (script.includes("removeAttribute('src')")) {
          win.themeId = null;
          win.media = null;
          win.css = '';
          win.paused = false;
          return { style: false, layer: false, video: false, themed: null, background: ORIGINAL_BG, dark: win.dark };
        }
        if (script.includes('style.disabled = true')) {
          win.paused = true;
          return { paused: true, styleDisabled: true, background: ORIGINAL_BG, dark: win.dark, layerVisible: false };
        }
        if (script.includes('style.disabled = false')) {
          win.paused = false;
          return { paused: false, styleDisabled: false, background: background(), dark: win.dark, layerVisible: true };
        }
        if (script.includes('themed:')) {
          return {
            style: !!win.themeId,
            layer: !!win.themeId,
            video: !!win.media && win.media.kind === 'video',
            kind: win.media ? win.media.kind : null,
            background: background(),
            layerImage: win.media ? `url(${win.media.url})` : null,
            videoReady: win.media && win.media.kind === 'video' ? 4 : null,
            themed: win.themeId,
            dark: win.dark,
            paused: win.paused
          };
        }
        if (script.includes('testidCount')) {
          return {
            url: win.url,
            title: win.title,
            rootChildren: 3,
            testidCount: 12,
            htmlClass: win.dark ? 'dark theme-zai-dark' : 'theme-zai-light',
            bodyClass: 'zcode-startup-ready',
            ready: win.ready !== false,
            loading: false,
            darkClass: win.dark,
            backgroundToken: ORIGINAL_BG,
            foregroundToken: win.dark ? '#e8e8ea' : '#1c1c1e',
            injected: { style: !!win.themeId, layer: false, video: !!win.media && win.media.kind === 'video' },
            tokens: { background: ORIGINAL_BG, foreground: '#1c1c1e', sidebar: ORIGINAL_BG, border: 'rgba(0,0,0,0.12)' }
          };
        }
        throw new Error('unexpected script: ' + script.slice(0, 80));
      }
    };
  };

  const detector = {
    detect: async () => {
      const list = pickPrimary([...targets.values()].map((win) => {
        const item = summary(win);
        return { item, page: item.page };
      })).map((entry) => entry.item);
      const first = list[0] || null;
      return {
        host: 'zcode',
        hostName: 'ZCode',
        installed: true,
        running: true,
        ready: !!(first && first.page && first.page.ready),
        portOpen: true,
        supported: true,
        ownership: { verified: true },
        target: first,
        targets: list,
        page: first ? first.page : null,
        path: 'C:\\fake\\ZCode.exe',
        port: 9229,
        checkedAt: new Date().toISOString()
      };
    },
    invalidate() {},
    targets: async () => [...targets.values()].map(summary)
  };

  return { targets, openWindow, session, detector, list: () => [...targets.values()], setMode: (id, dark) => { targets.get(id).dark = dark; } };
}

export async function openWorld(t, options = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-win-'));
  const hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-win-host-'));
  t.after(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(hostRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(hostRoot, 'ZCode.exe'), 'fake-exe', 'utf8');
  if (options.config) fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(options.config), 'utf8');

  const world = fakeWorld();
  if (options.windows) options.windows.forEach((config) => world.openWindow(config));
  const kernel = await createKernel({
    dataDir,
    appRoot: ROOT,
    seedLocalAssets: false,
    logger: createLogger({ dir: path.join(dataDir, 'logs'), level: 'error' }),
    detector: world.detector,
    session: world.session,
    profile: { ...ZCODE_PROFILE, exe: path.join(hostRoot, 'ZCode.exe'), hostRoot, port: 9229 }
  });
  const seq = { n: 0 };
  const call = (method, params = {}) => kernel.handle(request(`w-${++seq.n}`, method, params));
  await call(METHODS.SYSTEM_HELLO);
  // 启动任务（applyOnStart + 启动期调度评估）要等干净，测试里才好控制触发时机
  await kernel.startup;
  return { kernel, world, call, dataDir };
}
