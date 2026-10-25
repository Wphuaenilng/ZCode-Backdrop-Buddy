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

function fakeHost({ restoreError = null } = {}) {
  const status = {
    host: 'zcode',
    installed: true,
    running: true,
    ready: true,
    portOpen: true,
    supported: true,
    ownership: { verified: true },
    target: { id: 'test-target', url: 'file:///test/renderer/index.html', fingerprint: 'test' },
    page: { dark: false },
    path: 'F:\\shop\\ZCode\\ZCode.exe',
    port: 9229
  };

  return {
    status: () => status,
    detect: async () => status,
    apply: ({ theme }) => ({ dryRun: false, injected: true, themeId: theme.id, target: status.target }),
    restore: () => {
      if (restoreError) throw restoreError;
      return { dryRun: false, restored: true, verified: true, hostFiles: { unchanged: true } };
    },
    pause: () => ({ paused: true, verified: true }),
    resume: () => ({ paused: false, verified: true }),
    reset: () => ({ paused: false, verified: true })
  };
}

function request(id, method, params = {}) {
  return { v: PROTOCOL_VERSION, id, type: 'request', method, params };
}

async function openKernel(dataDir, hostOptions) {
  return createKernel({
    dataDir,
    appRoot: ROOT,
    seedLocalAssets: false,
    logger: createLogger({ dir: path.join(dataDir, 'logs'), level: 'error' }),
    host: fakeHost(hostOptions)
  });
}

test('theme.remove: restore failure is reported instead of crashing the kernel', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-remove-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const rejections = [];
  const onRejection = (reason) => rejections.push(reason);
  process.on('unhandledRejection', onRejection);
  t.after(() => process.off('unhandledRejection', onRejection));

  const kernel = await openKernel(dataDir, { restoreError: new Error('cdp disconnected') });
  try {
    let seq = 0;
    const call = (method, params = {}) => kernel.handle(request(`r-${++seq}`, method, params));

    assert.equal((await call(METHODS.SYSTEM_HELLO)).ok, true);
    const saved = await call(METHODS.THEME_SAVE, { name: '崩溃测试' });
    assert.equal(saved.ok, true);
    const themeId = saved.data.theme.id;

    assert.equal((await call(METHODS.THEME_APPLY, { themeId })).ok, true);

    const removed = await call(METHODS.THEME_REMOVE, { themeId });
    assert.equal(removed.ok, true);
    assert.equal(removed.data.removed, themeId);
    assert.equal(removed.data.restore, undefined);
    assert.equal(removed.data.restoreFailed.code, 'INTERNAL');
    assert.match(removed.data.restoreFailed.message, /cdp disconnected/);

    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(rejections, []);

    const status = await call(METHODS.STATUS_GET);
    assert.equal(status.ok, true);
    assert.equal(status.data.running, false);
    assert.equal(status.data.theme, null);

    const pointer = JSON.parse(fs.readFileSync(path.join(dataDir, 'themes', 'pointer.json'), 'utf8'));
    assert.equal(pointer.activeThemeId, null);
    const settings = await call(METHODS.SETTINGS_GET);
    assert.equal(settings.data.settings.selectedThemeId, null);
    assert.equal(settings.data.settings.lastAppliedThemeId, null);
  } finally {
    await kernel.close();
  }
});

test('theme.remove: active theme is restored and the response carries the result', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-remove-ok-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const kernel = await openKernel(dataDir);
  try {
    let seq = 0;
    const call = (method, params = {}) => kernel.handle(request(`o-${++seq}`, method, params));

    await call(METHODS.SYSTEM_HELLO);
    const saved = await call(METHODS.THEME_SAVE, { name: '正常删除' });
    const themeId = saved.data.theme.id;
    await call(METHODS.THEME_APPLY, { themeId });

    const removed = await call(METHODS.THEME_REMOVE, { themeId });
    assert.equal(removed.ok, true);
    assert.equal(removed.data.restore.restored, true);
    assert.equal(removed.data.restoreFailed, undefined);

    const status = await call(METHODS.STATUS_GET);
    assert.equal(status.data.running, false);
  } finally {
    await kernel.close();
  }
});

test('theme.remove: inactive user theme is deleted without touching the running one', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-remove-idle-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const kernel = await openKernel(dataDir);
  try {
    let seq = 0;
    const call = (method, params = {}) => kernel.handle(request(`i-${++seq}`, method, params));

    await call(METHODS.SYSTEM_HELLO);
    const running = await call(METHODS.THEME_SAVE, { name: '运行中' });
    const idle = await call(METHODS.THEME_SAVE, { name: '未运行' });
    await call(METHODS.THEME_APPLY, { themeId: running.data.theme.id });

    const removed = await call(METHODS.THEME_REMOVE, { themeId: idle.data.theme.id });
    assert.equal(removed.ok, true);
    assert.equal(removed.data.restore, undefined);

    const status = await call(METHODS.STATUS_GET);
    assert.equal(status.data.running, true);
    assert.equal(status.data.theme.themeId, running.data.theme.id);
  } finally {
    await kernel.close();
  }
});
