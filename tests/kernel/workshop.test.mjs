import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger } from '../../kernel/util/logger.mjs';
import { runPowerShellJson } from '../../kernel/platform/exec.mjs';
import { AppError } from '../../kernel/protocol/errors.mjs';
import registerWorkshop from '../../kernel/handlers/workshop.mjs';
import {
  WORKSHOP_APP_ID,
  parseProject,
  scanWorkshop,
  workshopRoots,
  findSteamLibraries
} from '../../kernel/workshop/discover.mjs';
import { METHODS, PROTOCOL_VERSION } from '../../shared/protocol/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const VIDEO_ASSET = path.join(ROOT, 'assets', 'ink-feather-glow.mp4');

// 只需骗过 detectMime 的魔数检查（预览与媒体校验同款 16 字节头读取）。
const PNG_BYTES = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(24, 7)
]);
const MP4_BYTES = Buffer.concat([
  Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]),
  Buffer.from('TOP-SECRET-CONTENT')
]);

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeHost() {
  const status = {
    host: 'zcode', installed: true, running: false, ready: false, portOpen: false,
    supported: true, ownership: { verified: false }, target: null, page: null,
    path: 'C:\\fake\\ZCode.exe', port: 9229
  };
  return {
    status: () => status,
    detect: async () => status,
    apply: () => ({ dryRun: true }),
    restore: () => ({ restored: true, verified: true }),
    pause: () => ({ paused: true }),
    resume: () => ({ paused: false }),
    reset: () => ({ paused: false })
  };
}

async function openKernel(t) {
  const dataDir = tempDir(t, 'bb-workshop-');
  const kernel = await createKernel({
    dataDir,
    appRoot: ROOT,
    seedLocalAssets: false,
    logger: createLogger({ dir: path.join(dataDir, 'logs'), level: 'error' }),
    host: fakeHost()
  });
  t.after(() => kernel.close());
  return { kernel, dataDir };
}

// 造一个 WE 工坊夹具：1 个可导入视频 + 1 个场景型 + 3 个应被跳过的坏条目。
// 返回 Steam 根目录；结构对齐 steamapps\workshop\content\431960\<id>\。
function makeWorkshopTree(dataDir) {
  const steamRoot = path.join(dataDir, 'steam');
  const workshop = path.join(steamRoot, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID);

  const videoDir = path.join(workshop, '289030001');
  fs.mkdirSync(path.join(videoDir, 'contents'), { recursive: true });
  fs.writeFileSync(path.join(videoDir, 'project.json'), JSON.stringify({
    title: '星穹列车', type: 'video', file: 'contents/train.mp4'
  }));
  fs.copyFileSync(VIDEO_ASSET, path.join(videoDir, 'contents', 'train.mp4'));
  fs.writeFileSync(path.join(videoDir, 'preview.png'), PNG_BYTES);

  const sceneDir = path.join(workshop, '289030002');
  fs.mkdirSync(sceneDir, { recursive: true });
  fs.writeFileSync(path.join(sceneDir, 'project.json'), JSON.stringify({
    title: '粒子星云', type: 'scene', file: 'scene.pkg'
  }));
  fs.writeFileSync(path.join(sceneDir, 'preview.jpg'), PNG_BYTES);

  const escapeDir = path.join(workshop, '289030003');
  fs.mkdirSync(escapeDir, { recursive: true });
  fs.writeFileSync(path.join(escapeDir, 'project.json'), JSON.stringify({
    title: '穿越者', type: 'video', file: '..\\..\\..\\outside.mp4'
  }));

  const brokenDir = path.join(workshop, '289030004');
  fs.mkdirSync(brokenDir, { recursive: true });
  fs.writeFileSync(path.join(brokenDir, 'project.json'), '{not json');

  const missingDir = path.join(workshop, '289030005');
  fs.mkdirSync(missingDir, { recursive: true });
  fs.writeFileSync(path.join(missingDir, 'project.json'), JSON.stringify({
    title: '失踪', type: 'video', file: 'gone.mp4'
  }));

  fs.writeFileSync(path.join(workshop, 'not-a-dir.txt'), 'x');
  return steamRoot;
}

// —— 信任边界（对应审查 #1/#2/#6）——

test('workshop: junction and hardlink escapes into outside files are rejected', (t) => {
  const dataDir = tempDir(t, 'bb-workshop-escape-');
  const workshop = path.join(dataDir, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID);
  const outside = path.join(dataDir, 'outside');
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, 'secret.mp4'), MP4_BYTES);

  // 目录 junction（重解析点，无需提权）：realpath containment 拦截
  const junctionItem = path.join(workshop, 'j1');
  fs.mkdirSync(junctionItem, { recursive: true });
  fs.symlinkSync(outside, path.join(junctionItem, 'linked'), 'junction');
  fs.writeFileSync(path.join(junctionItem, 'project.json'), JSON.stringify({ type: 'video', file: 'linked/secret.mp4' }));

  // 硬链接（realpath 就在条目内，路径校验原理上拦不住）：靠 nlink>1 拒收
  const hardItem = path.join(workshop, 'h1');
  fs.mkdirSync(hardItem, { recursive: true });
  fs.linkSync(path.join(outside, 'secret.mp4'), path.join(hardItem, 'hard.mp4'));
  fs.writeFileSync(path.join(hardItem, 'project.json'), JSON.stringify({ type: 'video', file: 'hard.mp4' }));

  const scan = scanWorkshop({ roots: [workshop] });
  assert.equal(scan.items.length, 0);
  assert.equal(scan.skipped, 2);
});

test('workshop: video projects pointing at non-video files are skipped', (t) => {
  const dataDir = tempDir(t, 'bb-workshop-route-');
  const workshop = path.join(dataDir, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID);

  // .json 会被 importTheme 的扩展名路由劫到 importJsonPack（走私主题记录）
  const jsonItem = path.join(workshop, 'json-item');
  fs.mkdirSync(jsonItem, { recursive: true });
  fs.writeFileSync(path.join(jsonItem, 'project.json'), JSON.stringify({ type: 'video', file: 'payload.json' }));
  fs.writeFileSync(path.join(jsonItem, 'payload.json'), JSON.stringify({ schema: 'backdropbuddy.theme/1', name: '走私' }));

  // .zip 会被路由到 importPack（300 MiB 包上限而非视频 200 MiB）
  const zipItem = path.join(workshop, 'zip-item');
  fs.mkdirSync(zipItem, { recursive: true });
  fs.writeFileSync(path.join(zipItem, 'project.json'), JSON.stringify({ type: 'video', file: 'pack.zip' }));
  fs.writeFileSync(path.join(zipItem, 'pack.zip'), 'PK\x03\x04');

  const scan = scanWorkshop({ roots: [workshop] });
  assert.equal(scan.items.length, 0);
  assert.equal(scan.skipped, 2);
});

test('workshop: same unsafe directory name in two roots gets distinct ids', (t) => {
  const dataDir = tempDir(t, 'bb-workshop-clash-');
  const rootA = path.join(dataDir, 'steam-a', 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID);
  const rootB = path.join(dataDir, 'steam-b', 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID);
  for (const root of [rootA, rootB]) {
    fs.mkdirSync(path.join(root, '我的壁纸'), { recursive: true });
    fs.writeFileSync(path.join(root, '我的壁纸', 'project.json'), JSON.stringify({ type: 'scene' }));
  }
  const scan = scanWorkshop({ roots: [rootA, rootB] });
  assert.equal(scan.items.length, 2);
  const ids = new Set(scan.items.map((item) => item.id));
  assert.equal(ids.size, 2, `distinct ids expected, got ${[...ids].join(',')}`);
});

test('workshop: candidate hit expands libraryfolders.vdf to a second library', async (t) => {
  const dataDir = tempDir(t, 'bb-workshop-vdf-');
  const steamRoot = path.join(dataDir, 'steam');
  const second = path.join(dataDir, 'second-library');
  fs.mkdirSync(path.join(steamRoot, 'steamapps'), { recursive: true });
  fs.mkdirSync(path.join(second, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID, '222001'), { recursive: true });
  fs.writeFileSync(path.join(second, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID, '222001', 'project.json'),
    JSON.stringify({ type: 'video', file: 'bg.mp4' }));
  fs.writeFileSync(path.join(second, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID, '222001', 'bg.mp4'), MP4_BYTES);

  const vdfLines = [
    '"libraryfolders"',
    '{',
    '\t"0"',
    '\t{',
    `\t\t"path"\t\t"${steamRoot.replace(/\\/g, '\\\\')}"`,
    '\t}',
    '\t"1"',
    '\t{',
    `\t\t"path"\t\t"${second.replace(/\\/g, '\\\\')}"`,
    '\t}',
    '}'
  ];
  fs.writeFileSync(path.join(steamRoot, 'steamapps', 'libraryfolders.vdf'), vdfLines.join('\n'), 'utf8');

  const discovery = await findSteamLibraries({ appRoot: null, configured: steamRoot, env: {} });
  assert.equal(discovery.source, 'config');
  assert.equal(discovery.libraries.length, 2, `libraries=${discovery.libraries.join('|')}`);

  const roots = workshopRoots(discovery);
  assert.ok(roots.some((root) => root.toLowerCase().startsWith(second.toLowerCase())));
  const scan = scanWorkshop({ roots });
  assert.equal(scan.items.length, 1);
});

// —— parseProject（纯函数）——

test('workshop: parseProject reads a video project and falls back to the directory name', () => {
  const parsed = parseProject('289030001', JSON.stringify({ title: '  星穹列车  ', type: 'video', file: 'contents/train.mp4' }));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.item.id, '289030001');
  assert.equal(parsed.item.title, '星穹列车');
  assert.equal(parsed.item.type, 'video');
  assert.equal(parsed.item.supported, true);
  assert.equal(parsed.item.file, 'contents/train.mp4');

  const untitled = parseProject('289030009', JSON.stringify({ type: 'video', file: 'bg.mp4' }));
  assert.equal(untitled.ok, true);
  assert.equal(untitled.item.title, '289030009');
});

test('workshop: parseProject rejects unknown types, bad json and unsafe file references', () => {
  // application/scene/web 是合法类型（只是不支持导入，UI 置灰）；真正未知或缺失的类型才拒收。
  assert.equal(parseProject('x', JSON.stringify({ type: 'screensaver' })).ok, false);
  assert.equal(parseProject('x', JSON.stringify({})).ok, false);
  assert.equal(parseProject('x', '{nope').ok, false);
  assert.equal(parseProject('x', 'null').ok, false);

  const absolute = parseProject('x', JSON.stringify({ type: 'video', file: 'C:\\evil\\x.mp4' }));
  assert.equal(absolute.ok, false);
  const traversal = parseProject('x', JSON.stringify({ type: 'video', file: '..\\..\\x.mp4' }));
  assert.equal(traversal.ok, false);
  const noFile = parseProject('x', JSON.stringify({ type: 'video' }));
  assert.equal(noFile.ok, false);
});

test('workshop: ids for unsafe directory names are deterministic and protocol-safe', () => {
  const first = parseProject('我的壁纸 / 测试', JSON.stringify({ type: 'scene' }));
  const second = parseProject('我的壁纸 / 测试', JSON.stringify({ type: 'scene' }));
  assert.equal(first.ok, true);
  assert.match(first.item.id, /^[A-Za-z0-9_.-]{1,80}$/);
  assert.equal(first.item.id, second.item.id);
});

// —— scanWorkshop / workshopRoots（mkdtemp 真目录）——

test('workshop: scanWorkshop keeps importable items and skips broken ones', (t) => {
  const dataDir = tempDir(t, 'bb-workshop-scan-');
  const steamRoot = makeWorkshopTree(dataDir);
  const roots = workshopRoots({ steamPath: steamRoot, libraries: [steamRoot] });
  assert.equal(roots.length, 1);

  const scan = scanWorkshop({ roots });
  assert.equal(scan.truncated, false);
  assert.equal(scan.skipped, 3);
  assert.equal(scan.items.length, 2);

  const video = scan.items.find((item) => item.id === '289030001');
  assert.equal(video.supported, true);
  assert.equal(video.title, '星穹列车');
  assert.ok(video.bytes > 0);
  assert.ok(video.mediaPath.toLowerCase().endsWith('train.mp4'));
  assert.ok(video.previewPath.toLowerCase().endsWith('preview.png'));

  const scene = scan.items.find((item) => item.id === '289030002');
  assert.equal(scene.supported, false);
  assert.equal(scene.mediaPath, null);
});

test('workshop: scanWorkshop honors the cap and reports truncation', (t) => {
  const dataDir = tempDir(t, 'bb-workshop-cap-');
  const workshop = path.join(dataDir, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID);
  for (const id of ['a1', 'a2', 'a3']) {
    const dir = path.join(workshop, id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({ type: 'video', file: 'bg.mp4' }));
    fs.writeFileSync(path.join(dir, 'bg.mp4'), 'x');
  }
  const scan = scanWorkshop({ roots: [workshop], cap: 2 });
  assert.equal(scan.items.length, 2);
  assert.equal(scan.truncated, true);
});

test('workshop: workshopRoots collects workshop content and WE project dirs, skipping missing ones', (t) => {
  const dataDir = tempDir(t, 'bb-workshop-roots-');
  const steamRoot = path.join(dataDir, 'steam');
  const libraryTwo = path.join(dataDir, 'library-two');
  fs.mkdirSync(path.join(steamRoot, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID), { recursive: true });
  fs.mkdirSync(path.join(steamRoot, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'myprojects'), { recursive: true });
  fs.mkdirSync(path.join(libraryTwo, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID), { recursive: true });

  const roots = workshopRoots({ steamPath: steamRoot, libraries: [steamRoot, libraryTwo] });
  assert.equal(roots.length, 3);
  const normalized = roots.map((root) => root.toLowerCase());
  assert.ok(normalized.includes(path.join(steamRoot, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID).toLowerCase()));
  assert.ok(normalized.includes(path.join(steamRoot, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'myprojects').toLowerCase()));
  assert.ok(normalized.includes(path.join(libraryTwo, 'steamapps', 'workshop', 'content', WORKSHOP_APP_ID).toLowerCase()));
});

// —— findSteamLibraries（appRoot 传 null 跳过 PowerShell 回退）——

test('workshop: discovery prefers configured over env and reports not-found without candidates', async (t) => {
  const dir = tempDir(t, 'bb-workshop-steam-');

  const viaConfig = await findSteamLibraries({ appRoot: null, configured: dir, env: { BACKDROPBUDDY_STEAM_PATH: 'Z:\\elsewhere' } });
  assert.equal(viaConfig.steamPath, path.normalize(dir));
  assert.equal(viaConfig.source, 'config');

  const viaEnv = await findSteamLibraries({ appRoot: null, configured: null, env: { BACKDROPBUDDY_STEAM_PATH: dir } });
  assert.equal(viaEnv.steamPath, path.normalize(dir));
  assert.equal(viaEnv.source, 'env');

  const none = await findSteamLibraries({ appRoot: null, configured: null, env: {} });
  assert.equal(none.steamPath, null);
});

// —— handler（真实内核协议栈，假宿主免 PowerShell）——

test('workshop: scan and import round trip through the kernel protocol', async (t) => {
  const { kernel, dataDir } = await openKernel(t);
  const steamRoot = makeWorkshopTree(dataDir);

  const previous = process.env.BACKDROPBUDDY_STEAM_PATH;
  process.env.BACKDROPBUDDY_STEAM_PATH = steamRoot;
  t.after(() => {
    if (previous === undefined) delete process.env.BACKDROPBUDDY_STEAM_PATH;
    else process.env.BACKDROPBUDDY_STEAM_PATH = previous;
  });

  await kernel.handle({ v: PROTOCOL_VERSION, id: 'h', type: 'request', method: METHODS.SYSTEM_HELLO, params: {} });
  let seq = 0;
  const call = (method, params = {}) => kernel.handle({ v: PROTOCOL_VERSION, id: `w-${++seq}`, type: 'request', method, params });

  const scan = await call(METHODS.WORKSHOP_SCAN);
  assert.equal(scan.ok, true);
  assert.equal(scan.data.found, true);
  assert.equal(scan.data.items.length, 2);
  assert.equal(scan.data.skipped, 3);
  // 协议响应要带 cap：UI 的截断提示直接渲染它（审查 #8）
  assert.equal(scan.data.cap, 300);
  const video = scan.data.items.find((item) => item.id === '289030001');
  assert.equal(video.supported, true);
  assert.ok(video.previewUrl.startsWith('https://preview.backdropbuddy.invalid/workshop/'));
  const previewDir = path.join(dataDir, 'cache', 'preview', 'workshop');
  assert.ok(fs.readdirSync(previewDir).length >= 1);
  // 第三方条目的真实路径不过协议
  assert.equal(JSON.stringify(scan.data).includes('train.mp4'), false);

  const first = await call(METHODS.WORKSHOP_IMPORT, { id: video.id });
  assert.equal(first.ok, true);
  assert.equal(first.data.imported, true);
  assert.equal(first.data.theme.name, '星穹列车');
  assert.equal(first.data.theme.source, 'user');
  assert.equal(first.data.theme.media.kind, 'video');
  assert.deepEqual(first.data.theme.tags, ['动态']);
  const themeDir = path.join(dataDir, 'themes', 'user', first.data.theme.id);
  assert.ok(fs.existsSync(path.join(themeDir, 'theme.json')));

  const again = await call(METHODS.WORKSHOP_IMPORT, { id: video.id });
  assert.equal(again.ok, true);
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.theme.id, first.data.theme.id);

  const scene = scan.data.items.find((item) => item.id === '289030002');
  const invalid = await call(METHODS.WORKSHOP_IMPORT, { id: scene.id });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'WORKSHOP_ITEM_INVALID');

  const missing = await call(METHODS.WORKSHOP_IMPORT, { id: 'does-not-exist' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'WORKSHOP_ITEM_NOT_FOUND');
});

test('workshop: import failures surface as a normal result so batches can continue', async (t) => {
  const dataDir = tempDir(t, 'bb-workshop-fail-');
  const steamRoot = makeWorkshopTree(dataDir);

  const registered = new Map();
  registerWorkshop(
    { register: (method, schema, handler) => registered.set(method, handler) },
    {
      paths: { appRoot: ROOT, cache: path.join(dataDir, 'cache') },
      config: { get: () => ({ steamPath: steamRoot }) },
      media: { hash: async () => 'ff'.repeat(32) },
      library: {
        findByMediaHash: async () => null,
        importTheme: async () => {
          throw new AppError('TRANSACTION_FAILED', 'theme import failed');
        }
      }
    }
  );

  const scan = await registered.get(METHODS.WORKSHOP_SCAN)({});
  assert.equal(scan.found, true);
  const video = scan.items.find((item) => item.id === '289030001');

  const result = await registered.get(METHODS.WORKSHOP_IMPORT)({ id: video.id });
  assert.equal(result.imported, false);
  assert.equal(result.code, 'TRANSACTION_FAILED');
  assert.ok(result.message);
});

// —— steam-locations.ps1 真机冒烟：脚本至少要能优雅地报告"没装 Steam"——

test('workshop: steam-locations.ps1 runs and reports a valid payload', async () => {
  const result = await runPowerShellJson('workshop/steam-locations.ps1', { appRoot: ROOT, timeout: 20000 });
  assert.equal(result.ok, true);
  if (result.found) {
    assert.equal(typeof result.steamPath, 'string');
    assert.ok(Array.isArray(result.libraries) && result.libraries.length >= 1);
  } else {
    assert.equal(result.steamPath, null);
  }
});
