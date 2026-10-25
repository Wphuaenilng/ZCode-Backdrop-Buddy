import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PointerStore } from '../../kernel/store/pointer.mjs';
import { createRecord } from '../../kernel/store/record.mjs';
import { writeTheme } from '../../kernel/store/writer.mjs';
import { ThemeTransaction, cleanupStaging } from '../../kernel/store/transaction.mjs';
import { writeFileAtomic } from '../../kernel/store/atomic.mjs';

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('store: atomic file writes replace existing content', () => {
  const dir = tempDir('bb-atomic-');
  const file = path.join(dir, 'state.json');
  writeFileAtomic(file, 'first');
  writeFileAtomic(file, 'second');
  assert.equal(fs.readFileSync(file, 'utf8'), 'second');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('store: transaction commits staged theme and rejects missing media', () => {
  const root = tempDir('bb-tx-');
  const staging = path.join(root, 'staging');
  const dest = path.join(root, 'user', 'my-test');
  fs.mkdirSync(staging, { recursive: true });

  const tx = ThemeTransaction.begin({ stagingRoot: staging });
  const record = createRecord({ id: 'my-test', name: '事务测试', tags: ['艺术'], params: {} });
  writeTheme(tx.dir, record);
  tx.commit(dest);
  assert.ok(fs.existsSync(path.join(dest, 'theme.json')));

  const bad = ThemeTransaction.begin({ stagingRoot: staging });
  const badRecord = createRecord({
    id: 'my-bad',
    name: '坏事务',
    tags: ['艺术'],
    params: {},
    media: { kind: 'image', file: 'missing.jpg' }
  });
  writeTheme(bad.dir, badRecord);
  assert.throws(() => bad.commit(path.join(root, 'user', 'my-bad')), /staged media file is missing/);
  bad.abort();
  assert.equal(fs.existsSync(path.join(root, 'user', 'my-bad')), false);

  fs.rmSync(root, { recursive: true, force: true });
});

test('store: stale staging directories are cleaned', () => {
  const root = tempDir('bb-staging-');
  const stale = path.join(root, 'tx-old');
  const fresh = path.join(root, 'tx-fresh');
  fs.mkdirSync(stale);
  fs.mkdirSync(fresh);
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(stale, old, old);

  const removed = cleanupStaging(root, 60 * 60 * 1000);
  assert.equal(removed, 1);
  assert.equal(fs.existsSync(stale), false);
  assert.equal(fs.existsSync(fresh), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('store: pointer revisions increase and clear resets the active theme', () => {
  const root = tempDir('bb-pointer-');
  const pointer = new PointerStore(path.join(root, 'pointer.json'));
  const first = pointer.write({ activeThemeId: 'forest', activeName: '森林薄雾', params: { panel: 30 }, paused: false });
  assert.equal(first.revision, 1);
  assert.equal(pointer.read().activeThemeId, 'forest');

  const second = pointer.write({ activeThemeId: 'forest', activeName: '森林薄雾', params: { panel: 30 }, paused: true });
  assert.equal(second.revision, 2);
  assert.equal(pointer.read().paused, true);

  pointer.clear();
  assert.equal(pointer.read().activeThemeId, null);
  assert.equal(pointer.read().paused, false);
  fs.rmSync(root, { recursive: true, force: true });
});
