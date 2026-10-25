import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger } from '../../kernel/util/logger.mjs';
import { createZip, readZipEntries } from '../../kernel/store/atomic.mjs';
import { PROTOCOL_VERSION, METHODS } from '../../shared/protocol/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function fakeHost() {
  let status = {
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
    restore: () => ({ dryRun: false, restored: true, verified: true, hostFiles: { unchanged: true } }),
    pause: () => ({ paused: true, verified: true }),
    resume: () => ({ paused: false, verified: true }),
    reset: () => ({ paused: false, verified: true })
  };
}

function request(id, method, params = {}) {
  return { v: PROTOCOL_VERSION, id, type: 'request', method, params };
}

async function openKernel(dataDir) {
  return createKernel({
    dataDir,
    appRoot: ROOT,
    logger: createLogger({ dir: path.join(dataDir, 'logs'), level: 'warn' }),
    host: fakeHost()
  });
}

test('zip: store round trip and traversal rejection', async () => {
  const zip = createZip([
    { name: 'theme.json', data: Buffer.from('{"schema":"backdropbuddy.theme/1"}') },
    { name: 'media/media.jpg', data: Buffer.from([1, 2, 3, 4, 5]) }
  ]);
  const entries = await readZipEntries(zip);
  assert.deepEqual(entries.map((entry) => entry.name), ['theme.json', 'media/media.jpg']);
  assert.deepEqual([...entries[1].data], [1, 2, 3, 4, 5]);
  assert.throws(() => createZip([{ name: '../evil.txt', data: 'x' }]), /unsafe zip entry/);
});

test('packs: local assets seed, bbskin round trip and restart persistence', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-pack-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));

  const first = await openKernel(dataDir);
  let seq = 0;
  const call = (method, params = {}) => first.handle(request(`p5-${++seq}`, method, params));

  const hello = await call(METHODS.SYSTEM_HELLO);
  assert.equal(hello.ok, true);
  const listed = await call(METHODS.THEME_LIST);
  assert.equal(listed.data.themes.length, 23);
  for (const id of ['local-original', 'local-video', 'local-test']) {
    const theme = listed.data.themes.find((item) => item.id === id);
    assert.ok(theme, `missing ${id}`);
    assert.ok(theme.media, `${id} media missing`);
    assert.match(theme.media.url, /^https:\/\/media\.backdropbuddy\.invalid\/user\//);
  }
  const settings = await call(METHODS.SETTINGS_GET);
  assert.equal(settings.data.settings.localAssetsSeeded, true);

  const source = listed.data.themes.find((item) => item.id === 'local-original');
  const packPath = path.join(dataDir, 'exports', 'local-original.bbskin');
  const exported = await call(METHODS.THEME_EXPORT, { themeId: source.id, destPath: packPath });
  assert.equal(exported.ok, true);
  assert.equal(exported.data.format, 'bbskin');
  assert.ok(exported.data.bytes > 1000);

  const imported = await call(METHODS.THEME_IMPORT, { path: packPath });
  assert.equal(imported.ok, true);
  const copy = imported.data.theme;
  assert.equal(copy.media.kind, 'image');
  assert.ok(copy.media.bytes > 0);
  assert.ok(fs.existsSync(path.join(dataDir, 'themes', 'user', copy.id, copy.media.file)));

  const applied = await call(METHODS.THEME_APPLY, { themeId: copy.id });
  assert.equal(applied.ok, true);
  const afterApply = await call(METHODS.SETTINGS_GET);
  assert.equal(afterApply.data.settings.selectedThemeId, copy.id);
  assert.equal(afterApply.data.settings.lastAppliedThemeId, copy.id);

  await first.close();

  const second = await openKernel(dataDir);
  try {
    let secondSeq = 0;
    const call2 = (method, params = {}) => second.handle(request(`p5b-${++secondSeq}`, method, params));
    await call2(METHODS.SYSTEM_HELLO);
    const list2 = await call2(METHODS.THEME_LIST, { source: 'user' });
    assert.equal(list2.data.themes.length, 4);
    const status = await call2(METHODS.STATUS_GET);
    assert.equal(status.data.running, true);
    assert.equal(status.data.theme.themeId, copy.id);
    const settings2 = await call2(METHODS.SETTINGS_GET);
    assert.equal(settings2.data.settings.selectedThemeId, copy.id);
    assert.equal(settings2.data.settings.localAssetsSeeded, true);

    const pack2 = path.join(dataDir, 'exports', 'forest.bbskin');
    const forestExport = await call2(METHODS.THEME_EXPORT, { themeId: 'forest', destPath: pack2 });
    assert.equal(forestExport.ok, true);
    assert.equal(forestExport.data.entries, 2);
    const forestImport = await call2(METHODS.THEME_IMPORT, { path: pack2, name: '森林副本' });
    assert.equal(forestImport.ok, true);
    assert.equal(forestImport.data.theme.name, '森林副本');
    assert.equal(forestImport.data.theme.media, null);
  } finally {
    await second.close();
  }
});
