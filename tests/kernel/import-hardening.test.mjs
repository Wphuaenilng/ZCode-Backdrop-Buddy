import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger } from '../../kernel/util/logger.mjs';
import { createZip } from '../../kernel/store/atomic.mjs';
import { newThemeId } from '../../kernel/store/record.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-import-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
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

test('import: pack media is stored under a normalized name', async (t) => {
  const { kernel, dataDir } = await openKernel(t);
  const image = fs.readFileSync(path.join(ROOT, 'assets', 'sakura-dawn.jpg'));

  const record = {
    schema: 'backdropbuddy.theme/1',
    id: 'pack-source',
    name: '包内改名',
    tags: ['艺术'],
    params: {},
    media: { kind: 'image', file: 'secret name.jpg' }
  };
  const zip = createZip([
    { name: 'theme.json', data: Buffer.from(JSON.stringify(record), 'utf8') },
    { name: 'media/secret name.jpg', data: image }
  ]);
  const packPath = path.join(dataDir, 'exports', 'rename.bbskin');
  fs.mkdirSync(path.dirname(packPath), { recursive: true });
  fs.writeFileSync(packPath, zip);

  const theme = await kernel.ctx.library.importTheme({ path: packPath });
  assert.equal(theme.media.file, 'media.jpg');
  assert.equal(theme.media.kind, 'image');
  const dir = path.join(dataDir, 'themes', 'user', theme.id);
  assert.equal(fs.existsSync(path.join(dir, 'media.jpg')), true);
  assert.equal(fs.existsSync(path.join(dir, 'secret name.jpg')), false);
  assert.ok(theme.media.bytes > 0);
});

test('import: a json theme larger than 1 MiB is rejected before parsing', async (t) => {
  const { kernel, dataDir } = await openKernel(t);
  const target = path.join(dataDir, 'exports', 'huge.json');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const padding = 'x'.repeat(1024 * 1024 + 64);
  fs.writeFileSync(target, JSON.stringify({ schema: 'backdropbuddy.theme/1', name: 'huge', padding }), 'utf8');

  await assert.rejects(
    kernel.ctx.library.importTheme({ path: target }),
    (error) => {
      assert.equal(error.code, 'MEDIA_TOO_LARGE');
      return true;
    }
  );
});

test('import: an explicit id that already exists is rejected', async (t) => {
  const { kernel, dataDir } = await openKernel(t);
  const image = fs.readFileSync(path.join(ROOT, 'assets', 'sakura-dawn.jpg'));
  const source = path.join(dataDir, 'exports', 'source.jpg');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, image);

  const first = await kernel.ctx.library.importTheme({ path: source, id: 'my-fixed-id', name: '第一个' });
  assert.equal(first.id, 'my-fixed-id');

  await assert.rejects(
    kernel.ctx.library.importTheme({ path: source, id: 'my-fixed-id', name: '重复' }),
    (error) => error.code === 'THEME_EXISTS'
  );
});

test('import: a colliding generated id is retried instead of overwriting', async (t) => {
  const { kernel } = await openKernel(t);

  const fixedNow = Date.UTC(2026, 0, 1);
  const realNow = Date.now;
  const realRandom = Math.random;
  const firstRandom = 0.123456;

  try {
    Date.now = () => fixedNow;
    let randomCalls = 0;
    Math.random = () => {
      const value = randomCalls === 0 ? firstRandom : 0.987654;
      randomCalls += 1;
      return value;
    };

    const first = await kernel.ctx.library.save({ name: '第一个' });
    assert.equal(first.id, newThemeId(fixedNow, firstRandom));

    randomCalls = 0;
    const second = await kernel.ctx.library.save({ name: '第二个' });
    assert.notEqual(second.id, first.id);
    assert.equal(fs.existsSync(path.join(kernel.paths.user, first.id, 'theme.json')), true);
    assert.equal(fs.existsSync(path.join(kernel.paths.user, second.id, 'theme.json')), true);
  } finally {
    Date.now = realNow;
    Math.random = realRandom;
  }
});
