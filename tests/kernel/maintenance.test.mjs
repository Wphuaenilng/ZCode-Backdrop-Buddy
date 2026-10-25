import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger, Logger } from '../../kernel/util/logger.mjs';
import { createLibrary } from '../../kernel/store/library.mjs';
import { resolvePaths, ensureDirs } from '../../kernel/store/paths.mjs';
import { pruneBackups, pruneOrphanDirs } from '../../kernel/store/atomic.mjs';
import { cleanCache } from '../../kernel/media/cache.mjs';
import { KeyedMutex } from '../../kernel/store/locks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function fakeHost() {
  const status = {
    host: 'zcode',
    installed: true,
    running: false,
    ready: false,
    portOpen: false,
    supported: true,
    ownership: { verified: false },
    target: null,
    page: null,
    path: 'C:\\fake\\ZCode.exe',
    port: 9229
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

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function age(file, ms) {
  const past = new Date(Date.now() - ms);
  fs.utimesSync(file, past, past);
}

test('maintenance: backups keep the newest 40 files per kind', (t) => {
  const dir = tempDir('bb-backup-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  for (let index = 0; index < 60; index += 1) {
    const file = path.join(dir, `snapshot-${String(index).padStart(3, '0')}-forest.json`);
    fs.writeFileSync(file, '{}');
    age(file, (60 - index) * 1000);
  }
  for (let index = 0; index < 45; index += 1) {
    const file = path.join(dir, `apply-${String(index).padStart(3, '0')}-forest.css`);
    fs.writeFileSync(file, 'a{}');
    age(file, (45 - index) * 1000);
  }
  fs.writeFileSync(path.join(dir, 'unrelated.txt'), 'keep me');

  const removed = pruneBackups(dir, { keep: 40 });
  assert.equal(removed, 25);

  const snapshots = fs.readdirSync(dir).filter((name) => name.startsWith('snapshot-'));
  const applies = fs.readdirSync(dir).filter((name) => name.startsWith('apply-'));
  assert.equal(snapshots.length, 40);
  assert.equal(applies.length, 40);
  assert.equal(fs.existsSync(path.join(dir, 'unrelated.txt')), true);
  assert.equal(fs.existsSync(path.join(dir, 'snapshot-059-forest.json')), true, 'newest snapshot survives');
  assert.equal(fs.existsSync(path.join(dir, 'snapshot-000-forest.json')), false, 'oldest snapshot is pruned');
});

test('maintenance: kernel startup prunes backups, cache and orphan theme directories', async (t) => {
  const dataDir = tempDir('bb-maint-');
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const paths = resolvePaths({ dataRoot: dataDir, appRoot: ROOT });
  ensureDirs(paths);

  for (let index = 0; index < 60; index += 1) {
    const file = path.join(paths.backup, `restore-${String(index).padStart(3, '0')}-forest.json`);
    fs.writeFileSync(file, '{}');
    age(file, (60 - index) * 1000);
  }

  const oldCache = path.join(paths.cache, 'luminance', 'stale.json');
  fs.mkdirSync(path.dirname(oldCache), { recursive: true });
  fs.writeFileSync(oldCache, '{}');
  age(oldCache, 40 * 24 * 60 * 60 * 1000);
  const freshCache = path.join(paths.cache, 'fresh.jpg');
  fs.writeFileSync(freshCache, 'x');

  const orphan = path.join(paths.user, 'my-orphan.old-1700000000000-abc');
  fs.mkdirSync(orphan, { recursive: true });
  age(orphan, 2 * 60 * 60 * 1000);
  const youngOrphan = path.join(paths.user, 'my-young.old-1700000000000-def');
  fs.mkdirSync(youngOrphan, { recursive: true });

  const kernel = await createKernel({
    dataDir,
    appRoot: ROOT,
    seedLocalAssets: false,
    logger: createLogger({ dir: paths.logs, level: 'error' }),
    host: fakeHost()
  });

  try {
    const snapshots = fs.readdirSync(paths.backup).filter((name) => name.startsWith('restore-'));
    assert.equal(snapshots.length, 40);
    assert.equal(fs.existsSync(oldCache), false);
    assert.equal(fs.existsSync(freshCache), true);
    assert.equal(fs.existsSync(orphan), false);
    assert.equal(fs.existsSync(youngOrphan), true, 'orphans younger than an hour are left alone');
  } finally {
    await kernel.close();
  }
});

test('maintenance: logger rotates to kernel.log.1 at the size cap', (t) => {
  const dir = tempDir('bb-log-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const logger = new Logger({ dir, level: 'debug', maxBytes: 400 });
  for (let index = 0; index < 40; index += 1) logger.info('entry', { index, padding: 'x'.repeat(20) });

  const file = path.join(dir, 'kernel.log');
  const archive = file + '.1';
  assert.equal(fs.existsSync(archive), true, 'archive is created');
  assert.ok(fs.statSync(file).size <= 400, 'active log stays under the cap');
  assert.ok(fs.statSync(archive).size > 0);
  assert.match(fs.readFileSync(file, 'utf8'), /entry/);
});

test('maintenance: cache cleanup walks nested directories', (t) => {
  const dir = tempDir('bb-cache-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const nested = path.join(dir, 'luminance', 'abc.json');
  fs.mkdirSync(path.dirname(nested), { recursive: true });
  fs.writeFileSync(nested, '{}');
  age(nested, 31 * 24 * 60 * 60 * 1000);
  const fresh = path.join(dir, 'fresh.json');
  fs.writeFileSync(fresh, '{}');

  assert.equal(cleanCache(dir), 1);
  assert.equal(fs.existsSync(nested), false);
  assert.equal(fs.existsSync(fresh), true);
});

test('maintenance: theme mutations invalidate the cached store stats', async (t) => {
  const dataDir = tempDir('bb-stats-');
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const paths = resolvePaths({ dataRoot: dataDir, appRoot: ROOT });
  ensureDirs(paths);
  const library = createLibrary({
    paths,
    logger: createLogger({ dir: paths.logs, level: 'error' }),
    media: { probe: async () => ({ kind: 'image' }), hash: async () => 'x', prepare: async () => null },
    locks: new KeyedMutex()
  });
  library.init();

  const before = library.stats();
  assert.equal(before.user, 0);
  await library.save({ name: '统计测试' });
  const after = library.stats();
  assert.equal(after.user, 1);
});

test('maintenance: pruneOrphanDirs only removes stale crash leftovers', (t) => {
  const dir = tempDir('bb-orphan-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const stale = path.join(dir, 'theme.old-1-a');
  const trash = path.join(dir, 'trash-123');
  const normal = path.join(dir, 'normal-theme');
  fs.mkdirSync(stale, { recursive: true });
  fs.mkdirSync(trash, { recursive: true });
  fs.mkdirSync(normal, { recursive: true });
  age(stale, 2 * 60 * 60 * 1000);
  age(trash, 2 * 60 * 60 * 1000);

  assert.equal(pruneOrphanDirs(dir), 2);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(trash), false);
  assert.equal(fs.existsSync(normal), true);
});
