import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createKernel } from '../../kernel/app/kernel.mjs';
import { createLogger } from '../../kernel/util/logger.mjs';
import { createZip, readZipEntries } from '../../kernel/store/atomic.mjs';
import { createStartupPreviewHtml, startupScript, STARTUP_LIMITS } from '../../kernel/host/startup-template.mjs';
import { METHODS, PROTOCOL_VERSION } from '../../shared/protocol/constants.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const request = (id, method, params = {}) => ({ v: PROTOCOL_VERSION, id, type: 'request', method, params });

function fakeHost() {
  const status = { host: 'zcode', installed: true, running: false, ready: false, ownership: { verified: false }, targets: [] };
  return {
    status: () => status,
    detect: async () => status,
    apply: async ({ theme }) => ({ dryRun: true, injected: false, themeId: theme.id }),
    restore: async () => ({ dryRun: true, restored: true }),
    pause: async () => ({ paused: true }),
    resume: async () => ({ paused: false })
  };
}

async function openKernel(dataDir) {
  const kernel = await createKernel({
    dataDir,
    appRoot: ROOT,
    seedLocalAssets: false,
    host: fakeHost(),
    logger: createLogger({ dir: path.join(dataDir, 'logs'), level: 'error' })
  });
  let seq = 0;
  const call = (method, params = {}) => kernel.handle(request(`startup-theme-${++seq}`, method, params));
  await call(METHODS.SYSTEM_HELLO);
  return { kernel, call };
}

test('startup theme: persistence, safe media, bbskin round trip and controlled preview', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-startup-theme-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const legacyDir = path.join(dataDir, 'themes', 'user', 'legacy');
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'theme.json'), JSON.stringify({ id: 'legacy', name: '旧主题', tags: ['艺术'] }));

  const first = await openKernel(dataDir);
  const hello = await first.call(METHODS.SYSTEM_HELLO);
  assert.ok(hello.data.capabilities.includes(METHODS.THEME_STARTUP_PREVIEW));
  const legacy = await first.call(METHODS.THEME_GET, { themeId: 'legacy' });
  assert.deepEqual(legacy.data.theme.startup, { enabled: false, preset: 'zcode-pop', holdMs: 900, media: null, mediaUrl: null });

  const saved = await first.call(METHODS.THEME_SAVE, {
    name: '</script>',
    params: { accent: '#123456' },
    startup: { enabled: true, preset: 'theme-reveal', holdMs: 1200, media: null }
  });
  assert.equal(saved.ok, true, JSON.stringify(saved.error));
  const blankId = saved.data.theme.id;
  const preview = await first.call(METHODS.THEME_STARTUP_PREVIEW, { themeId: blankId });
  assert.equal(preview.ok, true);
  assert.equal(preview.data.config.preset, 'theme-reveal');
  assert.equal(preview.data.config.mediaUrl, null);
  assert.doesNotMatch(preview.data.html, /<\/script><script>alert/);
  assert.match(preview.data.html, /connect-src 'none'/);

  for (const startup of [
    { enabled: true, preset: 'remote-code', holdMs: 900, media: null },
    { enabled: true, preset: 'zcode-pop', holdMs: 899, media: null },
    { enabled: true, preset: 'zcode-pop', holdMs: 900, media: '../outside.png' },
    { enabled: true, preset: 'zcode-pop', holdMs: 900, media: 'https://evil.example/a.png' }
  ]) {
    const rejected = await first.call(METHODS.THEME_SAVE, { id: blankId, name: 'safe', startup });
    assert.equal(rejected.ok, false, JSON.stringify(startup));
  }

  const sourcePath = path.join(dataDir, 'pixel.png');
  fs.writeFileSync(sourcePath, PNG);
  const imported = await first.call(METHODS.THEME_IMPORT, { path: sourcePath, name: '静图主题' });
  assert.equal(imported.ok, true, JSON.stringify(imported.error));
  const imageId = imported.data.theme.id;
  const enabled = await first.call(METHODS.THEME_SAVE, {
    id: imageId,
    name: '静图主题',
    startup: { enabled: true, preset: 'zcode-pop', holdMs: 1000, media: null }
  });
  assert.equal(enabled.ok, true, JSON.stringify(enabled.error));
  assert.ok(enabled.data.theme.startup.media, 'a safe theme still is selected');
  assert.match(enabled.data.theme.startup.mediaUrl, /^https:\/\/media\.backdropbuddy\.invalid\//);
  const imageDir = path.join(dataDir, 'themes', 'user', imageId);
  const chosen = enabled.data.theme.startup.media;
  const chosenBytes = fs.readFileSync(path.join(imageDir, chosen));
  assert.ok(chosenBytes.length <= STARTUP_LIMITS.maxMediaBytes);

  const oversized = Buffer.alloc(STARTUP_LIMITS.maxMediaBytes + 1);
  PNG.copy(oversized);
  fs.writeFileSync(path.join(imageDir, 'oversized.png'), oversized);
  const tooLarge = await first.call(METHODS.THEME_SAVE, {
    id: imageId, name: '静图主题', startup: { enabled: true, preset: 'zcode-pop', holdMs: 900, media: 'oversized.png' }
  });
  assert.equal(tooLarge.ok, false);
  assert.equal(tooLarge.error.code, 'MEDIA_TOO_LARGE');
  fs.writeFileSync(path.join(imageDir, 'fake.png'), '<script>alert(1)</script>');
  const fake = await first.call(METHODS.THEME_SAVE, {
    id: imageId, name: '静图主题', startup: { enabled: true, preset: 'zcode-pop', holdMs: 900, media: 'fake.png' }
  });
  assert.equal(fake.ok, false);
  assert.equal(fake.error.code, 'MEDIA_INVALID');

  const packPath = path.join(dataDir, 'with-startup.bbskin');
  const exported = await first.call(METHODS.THEME_EXPORT, { themeId: imageId, destPath: packPath });
  assert.equal(exported.ok, true, JSON.stringify(exported.error));
  const entries = await readZipEntries(fs.readFileSync(packPath));
  const packed = JSON.parse(entries.find((entry) => entry.name === 'theme.json').data.toString('utf8'));
  assert.equal(packed.startup.enabled, true);
  assert.equal(packed.startup.holdMs, 1000);
  assert.ok(entries.some((entry) => entry.name === packed.startup.media));
  const roundTrip = await first.call(METHODS.THEME_IMPORT, { path: packPath });
  assert.equal(roundTrip.ok, true, JSON.stringify(roundTrip.error));
  assert.equal(roundTrip.data.theme.startup.enabled, true);
  assert.equal(roundTrip.data.theme.startup.preset, 'zcode-pop');
  const importedBytes = fs.readFileSync(path.join(dataDir, 'themes', 'user', roundTrip.data.theme.id, roundTrip.data.theme.startup.media));
  assert.deepEqual(importedBytes, chosenBytes);

  const oldPack = path.join(dataDir, 'legacy.bbskin');
  fs.writeFileSync(oldPack, createZip([{ name: 'theme.json', data: JSON.stringify({ schema: 'backdropbuddy.theme/1', id: 'old', name: '旧包' }) }]));
  const oldImported = await first.call(METHODS.THEME_IMPORT, { path: oldPack });
  assert.equal(oldImported.ok, true);
  assert.equal(oldImported.data.theme.startup.enabled, false);
  const missingMedia = path.join(dataDir, 'missing.bbskin');
  fs.writeFileSync(missingMedia, createZip([{ name: 'theme.json', data: JSON.stringify({ schema: 'backdropbuddy.theme/1', name: '缺素材', startup: { enabled: true, preset: 'zcode-pop', holdMs: 900, media: 'missing.png' } }) }]));
  const missing = await first.call(METHODS.THEME_IMPORT, { path: missingMedia });
  assert.equal(missing.ok, false);
  assert.equal(missing.error.code, 'MEDIA_INVALID');

  await first.kernel.close();
  const second = await openKernel(dataDir);
  t.after(() => second.kernel.close());
  const persisted = await second.call(METHODS.THEME_GET, { themeId: imageId });
  assert.equal(persisted.data.theme.startup.enabled, true);
  assert.equal(persisted.data.theme.startup.holdMs, 1000);
  assert.equal(persisted.data.theme.startup.media, chosen);
});

test('startup preview: fixed template installs inside a sandboxed child, without same-origin access', (t) => {
  const require = createRequire(path.join(ROOT, 'ui', 'package.json'));
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><iframe sandbox="allow-scripts"></iframe>', {
    url: 'https://shell.backdropbuddy.invalid/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  t.after(() => dom.window.close());
  const frame = dom.window.document.querySelector('iframe');
  assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
  assert.equal(frame.contentWindow.top === frame.contentWindow, false);
  frame.contentWindow.matchMedia = () => ({ matches: false });
  const source = startupScript({ launchId: 'preview', themeName: '沙盒主题', preset: 'theme-reveal' }, { preview: true });
  const result = frame.contentWindow.eval(source);
  assert.equal(result.installed, true);
  assert.ok(frame.contentDocument.querySelector('#backdropbuddy-startup-layer'));
  assert.match(frame.contentDocument.querySelector('.bb-startup-name').textContent, /沙盒主题/);

  const html = createStartupPreviewHtml({ mediaUrl: 'https://evil.example/a.png', themeName: '安全预览' });
  assert.doesNotMatch(html, /evil\.example/);
  assert.match(html, /default-src 'none'/);
});

test('startup preview: layer replays after finish instead of leaving a blank frame', (t) => {
  const require = createRequire(path.join(ROOT, 'ui', 'package.json'));
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><body></body>', {
    url: 'https://shell.backdropbuddy.invalid/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  t.after(() => dom.window.close());
  const win = dom.window;
  let now = 100000;
  win.performance.now = () => now;
  win.matchMedia = () => ({ matches: false });
  const source = startupScript({ launchId: 'preview', themeName: '重播主题' }, { preview: true });
  const result = win.eval(source);
  assert.equal(result.installed, true);
  const firstLayer = win.document.querySelector('#backdropbuddy-startup-layer');
  assert.ok(firstLayer);

  now += 2000; // 越过 finish 里 900ms 的跳过保护
  win.__backdropBuddyStartupLayer.dispose();
  assert.match(firstLayer.className, /bb-startup-leaving/);

  return new Promise((resolve) => setTimeout(resolve, 700)).then(() => {
    const replayed = win.document.querySelector('#backdropbuddy-startup-layer');
    assert.ok(replayed, 'preview layer should be reinstalled after finish');
    assert.notEqual(replayed, firstLayer);
    assert.doesNotMatch(replayed.className, /bb-startup-leaving/);
  });
});
