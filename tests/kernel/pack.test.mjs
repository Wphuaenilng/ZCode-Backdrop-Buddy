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
  assert.equal(listed.data.themes.length, 41);
  for (const id of ['sakura-dawn', 'silver-glass-dream', 'preset-cold-elegance']) {
    const theme = listed.data.themes.find((item) => item.id === id);
    assert.ok(theme, `missing ${id}`);
    assert.ok(theme.media, `${id} media missing`);
    assert.match(theme.media.url, /^https:\/\/media\.backdropbuddy\.invalid\/user\//);
  }
  const settings = await call(METHODS.SETTINGS_GET);
  assert.equal(settings.data.settings.localAssetsSeeded, true);

  const source = listed.data.themes.find((item) => item.id === 'sakura-dawn');
  const packPath = path.join(dataDir, 'exports', 'sakura-dawn.bbskin');
  const exported = await call(METHODS.THEME_EXPORT, { themeId: source.id, destPath: packPath });
  assert.equal(exported.ok, true);
  assert.equal(exported.data.format, 'bbskin');
  assert.ok(exported.data.bytes > 1000);

  const mediaTarget = path.join(dataDir, 'exports', 'sakura-dawn.jpg');
  const mediaExport = await call(METHODS.THEME_EXPORT, { themeId: source.id, destPath: mediaTarget });
  assert.equal(mediaExport.ok, true);
  assert.equal(mediaExport.data.format, 'media');
  assert.equal(mediaExport.data.file, source.media.file);
  assert.deepEqual(
    fs.readFileSync(mediaTarget),
    fs.readFileSync(path.join(dataDir, 'themes', 'user', source.id, source.media.file))
  );

  const wrongExtension = await call(METHODS.THEME_EXPORT, {
    themeId: source.id,
    destPath: path.join(dataDir, 'exports', 'sakura-dawn.png')
  });
  assert.equal(wrongExtension.ok, false);
  assert.equal(wrongExtension.error.code, 'BAD_PARAMS');

  const zipTarget = path.join(dataDir, 'exports', 'sakura-dawn.zip');
  const zipExport = await call(METHODS.THEME_EXPORT, { themeId: source.id, destPath: zipTarget });
  assert.equal(zipExport.ok, true);
  assert.equal(zipExport.data.format, 'bbskin');

  const jsonTarget = path.join(dataDir, 'exports', 'sakura-dawn.json');
  const jsonExport = await call(METHODS.THEME_EXPORT, { themeId: source.id, destPath: jsonTarget });
  assert.equal(jsonExport.ok, true);
  assert.equal(jsonExport.data.format, 'json');

  // 未知或空扩展名不得静默降级成 JSON：素材导出会写出一个没人要的文件。
  for (const name of ['sakura-no-extension', 'sakura-notes.txt']) {
    const target = path.join(dataDir, 'exports', name);
    const rejected = await call(METHODS.THEME_EXPORT, { themeId: source.id, destPath: target });
    assert.equal(rejected.ok, false, name);
    assert.equal(rejected.error.code, 'BAD_PARAMS', name);
    assert.equal(fs.existsSync(target), false, `${name} must not be created`);
  }

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
    assert.equal(list2.data.themes.length, 42);
    const status = await call2(METHODS.STATUS_GET);
    assert.equal(status.data.running, true);
    assert.equal(status.data.theme.themeId, copy.id);
    const settings2 = await call2(METHODS.SETTINGS_GET);
    assert.equal(settings2.data.settings.selectedThemeId, copy.id);
    assert.equal(settings2.data.settings.localAssetsSeeded, true);

    const saved = await call2(METHODS.THEME_SAVE, { name: '参数主题', tags: ['艺术'], params: { accent: '#445566' } });
    assert.equal(saved.ok, true);
    const noMediaExport = await call2(METHODS.THEME_EXPORT, {
      themeId: saved.data.theme.id,
      destPath: path.join(dataDir, 'exports', 'no-media.jpg')
    });
    assert.equal(noMediaExport.ok, false);
    assert.equal(noMediaExport.error.code, 'MEDIA_INVALID');
    const pack2 = path.join(dataDir, 'exports', 'saved.bbskin');
    const savedExport = await call2(METHODS.THEME_EXPORT, { themeId: saved.data.theme.id, destPath: pack2 });
    assert.equal(savedExport.ok, true);
    assert.equal(savedExport.data.entries, 2);
    const savedImport = await call2(METHODS.THEME_IMPORT, { path: pack2, name: '森林副本' });
    assert.equal(savedImport.ok, true);
    assert.equal(savedImport.data.theme.name, '森林副本');
    assert.equal(savedImport.data.theme.media, null);
  } finally {
    await second.close();
  }
});
