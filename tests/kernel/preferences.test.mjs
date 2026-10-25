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

// 记录宿主页面收到了什么：注入次数、最后一次的主题与媒体
function fakeHostPage() {
  const page = { injections: [], themeId: null, media: null, paused: false, hasVideo: false };

  const session = async () => ({
    close() {},
    async evaluate(script) {
      if (script.includes('const THEME_ID = ')) {
        const themeId = script.match(/const THEME_ID = ("[^"]*")/);
        const media = script.match(/const MEDIA = (null|\{[^}]*\});/);
        page.themeId = themeId ? JSON.parse(themeId[1]) : null;
        page.media = media && media[1] !== 'null' ? JSON.parse(media[1]) : null;
        page.hasVideo = !!page.media && page.media.kind === 'video';
        page.paused = false;
        page.injections.push({ themeId: page.themeId, mediaKind: page.media ? page.media.kind : null });
        return true;
      }
      if (script.includes("removeAttribute('src')")) {
        page.themeId = null;
        page.media = null;
        page.hasVideo = false;
        page.paused = false;
        return { style: false, layer: false, video: false, themed: null, background: ORIGINAL_BG, dark: false };
      }
      if (script.includes('style.disabled = true')) {
        page.paused = true;
        return { paused: true, styleDisabled: true, background: ORIGINAL_BG, dark: false, layerVisible: false };
      }
      if (script.includes('style.disabled = false')) {
        page.paused = false;
        return { paused: false, styleDisabled: false, background: 'rgba(255,255,255,0.35)', dark: false, layerVisible: true };
      }
      if (script.includes('themed:')) {
        return {
          style: !!page.themeId,
          layer: !!page.themeId,
          video: page.hasVideo,
          kind: page.media ? page.media.kind : null,
          background: page.paused ? ORIGINAL_BG : 'rgba(255,255,255,0.35)',
          layerImage: page.media ? `url(${page.media.url})` : null,
          videoReady: page.hasVideo ? 4 : null,
          themed: page.themeId,
          dark: false,
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
          htmlClass: 'theme-zai-light',
          bodyClass: 'zcode-startup-ready',
          darkClass: false,
          backgroundToken: ORIGINAL_BG,
          foregroundToken: '#1c1c1e',
          injected: { style: page.themeId !== null, layer: false, video: page.hasVideo },
          tokens: { background: ORIGINAL_BG, foreground: '#1c1c1e', sidebar: ORIGINAL_BG, border: 'rgba(0,0,0,0.12)' }
        };
      }
      throw new Error('unexpected script: ' + script.slice(0, 80));
    }
  });

  return { page, session };
}

function fakeDetector() {
  return {
    detect: async () => ({
      host: 'zcode',
      installed: true,
      running: true,
      ready: true,
      portOpen: true,
      supported: true,
      ownership: { verified: true },
      target: { id: 'pref-target', url: 'file:///test/renderer/index.html', fingerprint: 'pref-test' },
      page: { dark: false },
      path: 'C:\\fake\\ZCode.exe',
      port: 9229
    }),
    invalidate() {}
  };
}

function request(id, method, params = {}) {
  return { v: PROTOCOL_VERSION, id, type: 'request', method, params };
}

async function openKernel(options = {}) {
  const dataDir = options.dataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pref-'));
  const hostRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pref-host-'));
  fs.writeFileSync(path.join(hostRoot, 'ZCode.exe'), 'fake-exe', 'utf8');
  if (options.config) fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify(options.config), 'utf8');
  const mediaHome = path.join(dataDir, 'themes', 'user', 'video-theme');
  fs.mkdirSync(mediaHome, { recursive: true });
  if (!fs.existsSync(path.join(mediaHome, 'theme.json'))) {
    fs.writeFileSync(path.join(mediaHome, 'media.mp4'), 'fake-video-bytes', 'utf8');
    fs.writeFileSync(path.join(mediaHome, 'thumb.jpg'), fs.readFileSync(path.join(ROOT, 'assets', 'sakura-dawn.jpg')));
    fs.writeFileSync(path.join(mediaHome, 'theme.json'), JSON.stringify({
      schema: 'backdropbuddy.theme/1',
      id: 'video-theme',
      name: '测试视频主题',
      tags: ['动态'],
      params: { panel: 35, accent: '#c98f8f' },
      media: { kind: 'video', file: 'media.mp4', thumb: 'thumb.jpg', mime: 'video/mp4' },
      source: 'user',
      createdAt: 1,
      updatedAt: 1
    }), 'utf8');
  }

  const host = fakeHostPage();
  const kernel = await createKernel({
    dataDir,
    appRoot: ROOT,
    seedLocalAssets: false,
    logger: createLogger({ dir: path.join(dataDir, 'logs'), level: 'error' }),
    detector: fakeDetector(),
    session: host.session,
    profile: { ...ZCODE_PROFILE, exe: path.join(hostRoot, 'ZCode.exe'), hostRoot, port: 9229 }
  });
  const seq = { n: 0 };
  const call = (method, params = {}) => kernel.handle(request(`p-${++seq.n}`, method, params));
  await call(METHODS.SYSTEM_HELLO);
  return { kernel, host, call, dataDir, cleanup: () => {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(hostRoot, { recursive: true, force: true });
  } };
}

test('减弱动效：视频主题降级为首帧静图，关掉后恢复播放', async (t) => {
  const { kernel, host, call, dataDir, cleanup } = await openKernel();
  t.after(async () => { await kernel.close(); cleanup(); });

  const plain = await call(METHODS.THEME_APPLY, { themeId: 'video-theme' });
  assert.equal(plain.ok, true, JSON.stringify(plain.error || {}));
  assert.equal(plain.data.media.kind, 'video');
  assert.equal(host.page.hasVideo, true, '默认应当注入播放中的视频');

  const reduced = await call(METHODS.SETTINGS_SET, { settings: { reducedMotion: true } });
  assert.equal(reduced.ok, true, JSON.stringify(reduced.error || {}));
  assert.equal(reduced.data.reapplied.media.kind, 'image', '改偏好后要立刻按静图重放');
  assert.equal(reduced.data.reapplied.media.degraded, 'video');
  assert.equal(host.page.hasVideo, false, '降级后宿主里不该再有视频元素');
  assert.equal(host.page.media.url.replace(/\\/g, '/').endsWith('thumb.jpg'), true, '用的就是主题已有的首帧');
  assert.equal(host.page.injections.at(-1).mediaKind, 'image');

  const back = await call(METHODS.SETTINGS_SET, { settings: { reducedMotion: false } });
  assert.equal(back.data.reapplied.media.kind, 'video');
  assert.equal(host.page.hasVideo, true);

  const status = await call(METHODS.STATUS_GET);
  assert.deepEqual(status.data.preferences, { applyOnStart: false, reducedMotion: false });
});

test('减弱动效 + 没有首帧：视频主题退成渐变底，不再放视频', async (t) => {
  const { kernel, host, call, dataDir, cleanup } = await openKernel();
  t.after(async () => { await kernel.close(); cleanup(); });

  const plain = await call(METHODS.THEME_APPLY, { themeId: 'video-theme' });
  assert.equal(plain.ok, true, JSON.stringify(plain.error || {}));
  fs.rmSync(path.join(dataDir, 'themes', 'user', 'video-theme', 'thumb.jpg'));

  const set = await call(METHODS.SETTINGS_SET, { settings: { reducedMotion: true } });
  assert.equal(set.ok, true, JSON.stringify(set.error || {}));
  assert.equal(set.data.reapplied.media, null, '没有首帧时不硬凑媒体，直接退成渐变底');
  assert.equal(set.data.reapplyError, undefined);
  assert.equal(host.page.hasVideo, false);
  assert.equal(host.page.media, null);

  const idle = await openKernel();
  t.after(async () => { await idle.kernel.close(); idle.cleanup(); });
  const noThemeApplied = await idle.call(METHODS.SETTINGS_SET, { settings: { reducedMotion: true } });
  assert.equal(noThemeApplied.data.reapplied, undefined, '没有正在运行的主题时不做重放');
});

test('启动自动应用：只在没有主题在跑时补一次', async (t) => {
  const idle = await openKernel({ config: { applyOnStart: true, lastAppliedThemeId: 'video-theme' } });
  t.after(async () => { await idle.kernel.close(); idle.cleanup(); });

  await idle.kernel.startup;
  assert.equal(idle.host.page.injections.length, 1, '启动时补应用一次');
  assert.equal(idle.host.page.injections[0].themeId, 'video-theme');
  assert.equal(idle.kernel.ctx.pointer.read().activeThemeId, 'video-theme');
  const status = await idle.call(METHODS.STATUS_GET);
  assert.equal(status.data.running, true);

  // 已经挂着主题（adopt 成功）就不要再应用一次
  const busy = await openKernel({ config: { applyOnStart: true, lastAppliedThemeId: 'video-theme' } });
  t.after(async () => { await busy.kernel.close(); busy.cleanup(); });
  busy.kernel.ctx.pointer.write({ activeThemeId: 'video-theme', activeName: '测试视频主题', params: {}, paused: false });
  busy.host.page.injections.length = 0;
  await busy.kernel.startup;
  assert.equal(busy.host.page.injections.length, 0, '指针已有主题时不重复应用');

  // 关掉开关就什么都不动
  const off = await openKernel({ config: { applyOnStart: false, lastAppliedThemeId: 'video-theme' } });
  t.after(async () => { await off.kernel.close(); off.cleanup(); });
  await off.kernel.startup;
  assert.equal(off.host.page.injections.length, 0);
  assert.equal(off.kernel.ctx.pointer.read().activeThemeId, null);
});

test('启动自动应用：恢复过原貌再重启，仍把上次的主题换回来', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pref-restart-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const first = await openKernel({ dataDir, config: { applyOnStart: true, lastAppliedThemeId: 'video-theme' } });
  t.after(() => first.kernel.close());

  const applied = await first.call(METHODS.THEME_APPLY, { themeId: 'video-theme' });
  assert.equal(applied.ok, true, JSON.stringify(applied.error || {}));
  const restored = await first.call(METHODS.THEME_RESTORE);
  assert.equal(restored.ok, true, JSON.stringify(restored.error || {}));
  assert.equal(first.kernel.ctx.config.get().lastAppliedThemeId, 'video-theme', '恢复原貌不该把"上次的主题"一起抹掉');
  await first.kernel.close();

  const second = await openKernel({ dataDir });
  t.after(() => second.kernel.close());
  await second.kernel.startup;
  assert.equal(second.kernel.ctx.pointer.read().activeThemeId, 'video-theme', '重启后自动补应用');
  assert.equal(second.host.page.injections.length, 1);
});

test('启动自动应用：应用没开的时候宿主重载过，重启也要把它换回来', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pref-reload-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dataDir, 'config.json'), JSON.stringify({ applyOnStart: true, lastAppliedThemeId: 'video-theme' }), 'utf8');

  const first = await openKernel({ dataDir });
  t.after(() => first.kernel.close());
  const applied = await first.call(METHODS.THEME_APPLY, { themeId: 'video-theme' });
  assert.equal(applied.ok, true, JSON.stringify(applied.error || {}));
  await first.kernel.close();

  // 换一个全新的假页面：指针与运行态还写着 video-theme，页面上却什么都没有
  const second = await openKernel({ dataDir });
  t.after(() => second.kernel.close());
  await second.kernel.startup;

  assert.equal(second.kernel.ctx.config.get().lastAppliedThemeId, 'video-theme', '页面变素不该把"上次的主题"一起抹掉');
  assert.equal(second.kernel.ctx.pointer.read().activeThemeId, 'video-theme', '补应用要真的发生');
  assert.equal(second.host.page.injections.length, 1);
});

test('启动自动应用：开关开但没有可用主题时安静跳过', async (t) => {
  const { kernel, host, call, cleanup } = await openKernel({ config: { applyOnStart: true, lastAppliedThemeId: 'gone-theme' } });
  t.after(async () => { await kernel.close(); cleanup(); });

  await kernel.startup;
  assert.equal(host.page.injections.length, 0);
  const status = await call(METHODS.STATUS_GET);
  assert.equal(status.ok, true);
  assert.equal(status.data.running, false);
});
