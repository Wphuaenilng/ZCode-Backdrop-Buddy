import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger } from '../../kernel/util/logger.mjs';
import { createRecord } from '../../kernel/store/record.mjs';
import { writeTheme } from '../../kernel/store/writer.mjs';
import { readJson } from '../../kernel/store/json-file.mjs';
import { PROTOCOL_VERSION, METHODS } from '../../shared/protocol/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function request(id, method, params = {}) {
  return { v: PROTOCOL_VERSION, id, type: 'request', method, params };
}

async function makeKernel() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-startup-'));
  const logger = createLogger({ dir: path.join(dataDir, 'logs'), level: 'info' });
  const kernel = await createKernel({ dataDir, appRoot: ROOT, logger, seedLocalAssets: false });
  return { kernel, dataDir };
}

function writeVideoTheme(dataDir, id, name) {
  const dir = path.join(dataDir, 'themes', 'user', id);
  const record = createRecord({
    id,
    name,
    tags: ['风景'],
    params: {},
    media: { kind: 'video', file: 'media.mp4', bytes: 10 }
  });
  writeTheme(dir, record);
  fs.writeFileSync(path.join(dir, 'media.mp4'), 'stub');
  return record;
}

function writeImageTheme(dataDir, id, name) {
  const dir = path.join(dataDir, 'themes', 'user', id);
  const record = createRecord({
    id,
    name,
    tags: ['风景'],
    params: {},
    media: { kind: 'image', file: 'media.jpg', bytes: 10 }
  });
  writeTheme(dir, record);
  fs.writeFileSync(path.join(dir, 'media.jpg'), 'stub');
  return record;
}

test('startup: defaults, video selection, clear and error paths', async (t) => {
  const { kernel, dataDir } = await makeKernel();
  t.after(async () => {
    await kernel.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  let seq = 0;
  const call = async (method, params = {}) => kernel.handle(request(`s-${++seq}`, method, params));

  const hello = await call(METHODS.SYSTEM_HELLO);
  assert.equal(hello.ok, true);
  assert.ok(hello.data.capabilities.includes(METHODS.STARTUP_GET));
  assert.ok(hello.data.capabilities.includes(METHODS.STARTUP_UPDATE));

  const initial = await call(METHODS.STARTUP_GET);
  assert.equal(initial.ok, true);
  assert.deepEqual(initial.data.settings, {
    schemaVersion: 1,
    enabled: true,
    themeId: null,
    themeName: null,
    videoPath: null
  });

  writeVideoTheme(dataDir, 'my-video', '启动视频');
  writeImageTheme(dataDir, 'my-image', '静图主题');

  const chosen = await call(METHODS.STARTUP_UPDATE, { themeId: 'my-video' });
  assert.equal(chosen.ok, true);
  assert.equal(chosen.data.settings.themeId, 'my-video');
  assert.equal(chosen.data.settings.themeName, '启动视频');
  const expectedVideo = path.join(dataDir, 'themes', 'user', 'my-video', 'media.mp4');
  assert.equal(chosen.data.settings.videoPath, expectedVideo);
  assert.ok(fs.existsSync(expectedVideo));

  const persisted = readJson(path.join(dataDir, 'startup-animation.json'), null);
  assert.equal(persisted.schemaVersion, 1);
  assert.equal(persisted.enabled, true);

  const disabled = await call(METHODS.STARTUP_UPDATE, { enabled: false });
  assert.equal(disabled.ok, true);
  assert.equal(disabled.data.settings.enabled, false);
  assert.equal(disabled.data.settings.themeId, 'my-video', 'enabled toggle keeps the video choice');

  const missing = await call(METHODS.STARTUP_UPDATE, { themeId: 'my-nope' });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'THEME_NOT_FOUND');

  const notVideo = await call(METHODS.STARTUP_UPDATE, { themeId: 'my-image' });
  assert.equal(notVideo.ok, false);
  assert.equal(notVideo.error.code, 'MEDIA_INVALID');

  const cleared = await call(METHODS.STARTUP_UPDATE, { themeId: null });
  assert.equal(cleared.ok, true);
  assert.equal(cleared.data.settings.themeId, null);
  assert.equal(cleared.data.settings.videoPath, null);
  assert.equal(cleared.data.settings.enabled, false, 'clear only resets the theme choice');
});

test('startup: removing the startup theme clears the reference', async (t) => {
  const { kernel, dataDir } = await makeKernel();
  t.after(async () => {
    await kernel.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  let seq = 0;
  const call = async (method, params = {}) => kernel.handle(request(`r-${++seq}`, method, params));
  await call(METHODS.SYSTEM_HELLO);

  writeVideoTheme(dataDir, 'my-video', '启动视频');
  writeVideoTheme(dataDir, 'my-other', '另一个视频');

  const chosen = await call(METHODS.STARTUP_UPDATE, { themeId: 'my-video' });
  assert.equal(chosen.ok, true);

  const removedOther = await call(METHODS.THEME_REMOVE, { themeId: 'my-other' });
  assert.equal(removedOther.ok, true);
  const kept = readJson(path.join(dataDir, 'startup-animation.json'), null);
  assert.equal(kept.themeId, 'my-video', 'removing an unrelated theme keeps the choice');

  const removed = await call(METHODS.THEME_REMOVE, { themeId: 'my-video' });
  assert.equal(removed.ok, true);
  const cleared = readJson(path.join(dataDir, 'startup-animation.json'), null);
  assert.equal(cleared.themeId, null);
  assert.equal(cleared.themeName, null);
  assert.equal(cleared.videoPath, null);
  assert.equal(cleared.enabled, true, 'removal keeps the enabled switch');
});

test('startup: corrupt settings file falls back to defaults', async (t) => {
  const { kernel, dataDir } = await makeKernel();
  t.after(async () => {
    await kernel.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  let seq = 0;
  const call = async (method, params = {}) => kernel.handle(request(`c-${++seq}`, method, params));
  await call(METHODS.SYSTEM_HELLO);

  fs.writeFileSync(path.join(dataDir, 'startup-animation.json'), '{broken');
  const read = await call(METHODS.STARTUP_GET);
  assert.equal(read.ok, true);
  assert.equal(read.data.settings.enabled, true);
  assert.equal(read.data.settings.themeId, null);
});
