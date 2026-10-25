import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger } from '../../kernel/util/logger.mjs';
import { PROTOCOL_VERSION, METHODS } from '../../shared/protocol/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const IMAGE = path.join(ROOT, 'assets', 'original.jpg');

function request(id, method, params = {}) {
  return { v: PROTOCOL_VERSION, id, type: 'request', method, params };
}

function fakeHost() {
  const status = {
    host: 'zcode',
    installed: true,
    running: true,
    ready: true,
    path: 'F:\\shop\\ZCode\\ZCode.exe',
    port: 9229
  };

  return {
    status: () => status,
    detect: async () => status,
    apply: ({ theme }) => ({ dryRun: true, injected: false, themeId: theme.id }),
    restore: () => ({ dryRun: true, restored: true }),
    pause: () => ({ paused: true }),
    resume: () => ({ paused: false }),
    reset: () => ({ paused: false })
  };
}

async function makeKernel() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-kernel-'));
  const logger = createLogger({ dir: path.join(dataDir, 'logs'), level: 'info' });
  const kernel = await createKernel({ dataDir, appRoot: ROOT, logger, host: fakeHost(), seedLocalAssets: false });
  return { kernel, dataDir };
}

test('kernel: full theme lifecycle, import, media and settings', async (t) => {
  const { kernel, dataDir } = await makeKernel();
  t.after(async () => {
    await kernel.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  let seq = 0;
  const events = [];
  kernel.bus.on('theme.status', (data) => events.push(data));
  const call = async (method, params = {}) => kernel.handle(request(`t-${++seq}`, method, params));

  const hello = await call(METHODS.SYSTEM_HELLO);
  assert.equal(hello.ok, true);
  assert.equal(hello.data.protocol, PROTOCOL_VERSION);
  assert.ok(hello.data.capabilities.includes(METHODS.THEME_IMPORT));
  assert.ok(hello.data.capabilities.includes(METHODS.THEME_APPLY));
  assert.equal(hello.data.capabilities.includes(METHODS.FILE_PICK), false, 'shell-owned stub is not a kernel capability');
  assert.deepEqual(hello.data.localMethods, ['file.pick', 'shell.settings.get', 'shell.settings.set']);

  const initial = await call(METHODS.THEME_LIST);
  assert.equal(initial.ok, true);
  assert.equal(initial.data.themes.length, 20);
  assert.ok(initial.data.themes.every((theme) => theme.source === 'builtin'));

  const saved = await call(METHODS.THEME_SAVE, { name: '测试主题', tags: ['艺术'], params: { accent: '#123456' } });
  assert.equal(saved.ok, true);
  const savedId = saved.data.theme.id;
  assert.match(savedId, /^my-/);

  const fetched = await call(METHODS.THEME_GET, { themeId: savedId });
  assert.equal(fetched.ok, true);
  assert.equal(fetched.data.theme.name, '测试主题');

  const applied = await call(METHODS.THEME_APPLY, { themeId: 'forest' });
  assert.equal(applied.ok, true);
  assert.equal(applied.data.themeId, 'forest');
  assert.equal(applied.data.dryRun, true);

  let status = await call(METHODS.STATUS_GET);
  assert.equal(status.data.running, true);
  assert.equal(status.data.theme.themeId, 'forest');
  assert.equal(status.data.host.running, true);

  const paused = await call(METHODS.THEME_PAUSE);
  assert.equal(paused.ok, true);
  assert.equal((await call(METHODS.STATUS_GET)).data.paused, true);

  const resumed = await call(METHODS.THEME_RESUME);
  assert.equal(resumed.ok, true);
  assert.equal((await call(METHODS.STATUS_GET)).data.paused, false);

  const reset = await call(METHODS.THEME_RESET);
  assert.equal(reset.ok, true);

  const restored = await call(METHODS.THEME_RESTORE);
  assert.equal(restored.ok, true);
  assert.equal((await call(METHODS.STATUS_GET)).data.running, false);

  assert.deepEqual(
    events.map((event) => event.state),
    ['running', 'paused', 'running', 'running', 'restored']
  );

  const settings = await call(METHODS.SETTINGS_SET, {
    settings: { selectedThemeId: savedId, applyOnStart: true }
  });
  assert.equal(settings.ok, true);
  assert.equal(settings.data.settings.selectedThemeId, savedId);
  assert.equal(settings.data.settings.applyOnStart, true);

  const imported = await call(METHODS.THEME_IMPORT, {
    name: '导入测试',
    tags: ['艺术'],
    params: { accent: '#654321' },
    path: IMAGE,
    kind: 'auto'
  });
  assert.equal(imported.ok, true);
  const mediaTheme = imported.data.theme;
  assert.equal(mediaTheme.media.kind, 'image');
  assert.ok(mediaTheme.media.width <= 1400);
  assert.ok(mediaTheme.media.height <= 1400);
  assert.ok(mediaTheme.media.file);
  assert.equal(mediaTheme.media.thumb, 'thumb.jpg');
  assert.match(mediaTheme.media.url, /^https:\/\/media\.backdropbuddy\.invalid\/user\//);
  assert.match(mediaTheme.media.thumbUrl, /thumb\.jpg$/);

  const mediaUrl = await call(METHODS.MEDIA_URL, {
    source: 'user',
    themeId: mediaTheme.id,
    file: mediaTheme.media.file
  });
  assert.equal(mediaUrl.ok, true);
  assert.equal(mediaUrl.data.url, mediaTheme.media.url);

  const validated = await call(METHODS.FILE_VALIDATE, { path: IMAGE });
  assert.equal(validated.ok, true);
  assert.equal(validated.data.kind, 'image');

  const pick = await call(METHODS.FILE_PICK);
  assert.equal(pick.ok, false);
  assert.equal(pick.error.code, 'NOT_IMPLEMENTED');

  const packPath = path.join(dataDir, 'exports', 'theme.json');
  const exported = await call(METHODS.THEME_EXPORT, { themeId: mediaTheme.id, destPath: packPath });
  assert.equal(exported.ok, true);
  const pack = JSON.parse(fs.readFileSync(packPath, 'utf8'));
  assert.equal(pack.schema, 'backdropbuddy.theme/1');
  assert.equal(pack.media.kind, 'image');

  const listed = await call(METHODS.THEME_LIST, { source: 'user' });
  assert.equal(listed.data.themes.length, 2);

  const invalid = await call(METHODS.THEME_APPLY, {});
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'BAD_PARAMS');
  assert.ok(Array.isArray(invalid.error.details));

  const logs = await call(METHODS.LOG_TAIL, { limit: 20 });
  assert.equal(logs.ok, true);
  assert.ok(logs.data.lines.length > 0);

  const removed = await call(METHODS.THEME_REMOVE, { themeId: mediaTheme.id });
  assert.equal(removed.ok, true);
  const missing = await call(METHODS.THEME_GET, { themeId: mediaTheme.id });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'THEME_NOT_FOUND');
});

test('kernel: invalid import does not leave staging or user theme behind', async (t) => {
  const { kernel, dataDir } = await makeKernel();
  t.after(async () => {
    await kernel.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  await kernel.handle(request('h', METHODS.SYSTEM_HELLO));
  const before = await kernel.handle(request('l1', METHODS.THEME_LIST, { source: 'user' }));
  assert.equal(before.data.themes.length, 0);

  const failed = await kernel.handle(request('i1', METHODS.THEME_IMPORT, {
    name: '坏导入',
    path: path.join(dataDir, 'nope.jpg')
  }));
  assert.equal(failed.ok, false);
  assert.equal(failed.error.code, 'FILE_NOT_FOUND');

  const staging = path.join(dataDir, 'themes', 'staging');
  const leftovers = fs.readdirSync(staging).filter((name) => name.startsWith('tx-'));
  assert.deepEqual(leftovers, []);

  const after = await kernel.handle(request('l2', METHODS.THEME_LIST, { source: 'user' }));
  assert.equal(after.data.themes.length, 0);
});
