import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPowerShellJson } from '../../kernel/platform/exec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function dataPolicy(dataDir, args) {
  return runPowerShellJson('install/data-policy.ps1', {
    appRoot: ROOT,
    args: ['-DataDir', dataDir, ...args]
  });
}

function makeDataDir(root) {
  fs.mkdirSync(path.join(root, 'themes', 'user'), { recursive: true });
  fs.writeFileSync(path.join(root, 'themes', 'pointer.json'), '{}');
  fs.writeFileSync(path.join(root, 'config.json'), '{}');
  fs.mkdirSync(path.join(root, 'cache'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cache', 'thumb.jpg'), 'x');
  fs.mkdirSync(path.join(root, 'logs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'logs', 'kernel.log'), 'x');
}

test('data policy: a real data directory is reported and purgeable', async (t) => {
  const root = tempDir('bb-policy-ok-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  makeDataDir(root);

  const report = await dataPolicy(root, []);
  assert.equal(report.ok, true);
  assert.equal(report.dryRun, true);
  assert.equal(report.report.themes.exists, true);
  assert.ok(report.report['themes\\user'].files >= 0);
  assert.equal(report.report.cache.files, 1);

  const purged = await dataPolicy(root, ['-Purge', '-Confirm']);
  assert.equal(purged.ok, true);
  assert.equal(fs.existsSync(path.join(root, 'cache')), false);
  assert.equal(fs.existsSync(path.join(root, 'logs')), false);
  assert.equal(fs.existsSync(path.join(root, 'themes', 'pointer.json')), true, 'themes are untouched');
});

test('data policy: purge refuses a directory that is not a BackdropBuddy data dir', async (t) => {
  const root = tempDir('bb-policy-bad-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'themes'), { recursive: true });
  fs.writeFileSync(path.join(root, 'important.txt'), 'keep');

  await assert.rejects(
    dataPolicy(root, ['-Purge', '-Confirm']),
    (error) => error.code === 'DATA_DIR_UNRECOGNIZED'
  );
  assert.equal(fs.existsSync(path.join(root, 'important.txt')), true);
  assert.equal(fs.existsSync(path.join(root, 'themes')), true);
});

test('data policy: an empty or missing data directory is refused before deletion', async (t) => {
  const root = tempDir('bb-policy-empty-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  await assert.rejects(
    dataPolicy(root, ['-PurgeUserThemes', '-Confirm']),
    (error) => error.code === 'DATA_DIR_UNRECOGNIZED'
  );
  await assert.rejects(
    dataPolicy(path.join(root, 'does-not-exist'), ['-Purge', '-Confirm']),
    (error) => error.code === 'DATA_DIR_UNRECOGNIZED'
  );
});

test('data policy: read-only reporting still works for an unrecognized directory', async (t) => {
  const root = tempDir('bb-policy-report-');
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'note.txt'), 'x');

  const report = await dataPolicy(root, []);
  assert.equal(report.ok, true);
  assert.equal(report.dryRun, true);
  assert.equal(report.report.themes.exists, false);
});
