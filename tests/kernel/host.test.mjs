import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runPowerShellJson } from '../../kernel/platform/exec.mjs';
import {
  buildThemeCss,
  discoverExecutable,
  isSupportedVersion,
  normalizeThemeParams,
  versionParts
} from '../../kernel/host/zcode.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

const TOKENS = {
  panel: 'rgba(255,255,255,0.30)',
  sidebar: 'rgba(255,255,255,0.28)',
  header: 'rgba(255,255,255,0.27)',
  card: 'rgba(255,255,255,0.55)',
  popover: 'rgba(255,255,255,0.96)',
  input: 'rgba(255,255,255,0.40)',
  surface: 'rgba(255,255,255,0.18)',
  surfaceHover: 'rgba(255,255,255,0.25)',
  selected: 'rgba(111,146,117,0.18)',
  accentSoft: 'rgba(111,146,117,0.14)',
  terminal: 'rgba(255,255,255,1.00)',
  contrast: '#000000',
  scrim: 'rgba(255,255,255,0.10)',
  dim: 'rgba(255,255,255,0.16)',
  foreground: '#1c1c1e',
  foregroundSubtle: 'rgba(28,28,30,0.72)',
  foregroundSubtlest: 'rgba(28,28,30,0.58)',
  border: 'rgba(0,0,0,0.12)',
  cardBorder: 'rgba(0,0,0,0.14)',
  inputBorder: 'rgba(0,0,0,0.16)',
  popoverBorder: 'rgba(0,0,0,0.12)',
  popoverForeground: '#1c1c1e',
  tooltipForeground: '#1c1c1e'
};

test('host profile: version support and parameter clamping', () => {
  assert.equal(versionParts('3.16.2.8769').text, '3.16.2');
  assert.equal(isSupportedVersion('3.16.2').ok, true);
  assert.equal(isSupportedVersion('2.9.0').ok, false);
  assert.equal(isSupportedVersion('unknown').ok, false);

  const params = normalizeThemeParams({ panel: 140, bubble: -4, zoom: 20, accent: 'bad', safe: 'nope' });
  assert.equal(params.panel, 100);
  assert.equal(params.bubble, 0);
  assert.equal(params.zoom, 100);
  assert.equal(params.accent, '#6f9275');
  assert.equal(params.safe, 'auto');
});

test('host css: generated injection uses only whitelisted shape', () => {
  const css = buildThemeCss({
    params: normalizeThemeParams({ accent: '#6F9275', panel: 30 }),
    media: { kind: 'image', url: 'file:///C:/data/media.jpg' },
    tokens: TOKENS,
    mode: 'light'
  });

  assert.match(css, /--color-background: rgba\(255,255,255,0\.30\) !important/);
  assert.match(css, /url\("file:\/\/\/C:\/data\/media\.jpg"\)/);
  assert.match(css, /#backdropbuddy-backdrop/);
  assert.doesNotMatch(css, /@import|https?:\/\/|expression\(|javascript:/);
});

test('host platform: generated css passes the PowerShell whitelist', async (t) => {
  const dir = tempDir('bb-css-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'theme.css');
  fs.writeFileSync(file, buildThemeCss({
    params: normalizeThemeParams({ accent: '#6F9275', panel: 30 }),
    media: { kind: 'image', url: 'file:///C:/data/media.jpg' },
    tokens: TOKENS,
    mode: 'light'
  }), 'utf8');

  const result = await runPowerShellJson('theme/validate-css.ps1', { appRoot: ROOT, args: ['-Path', file] });
  assert.equal(result.ok, true);
  assert.ok(result.rules >= 5);
  assert.ok(result.selectors.includes('#backdropbuddy-backdrop'));
});

test('host platform: remote css is rejected', async (t) => {
  const dir = tempDir('bb-css-bad-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'bad.css');
  fs.writeFileSync(file, 'body { background-image: url("https://evil.example/x.png"); }', 'utf8');

  await assert.rejects(
    runPowerShellJson('theme/validate-css.ps1', { appRoot: ROOT, args: ['-Path', file] }),
    (error) => error.code === 'CSS_REJECTED'
  );
});

test('host platform: port owner is verified by PID and executable', async (t) => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  const result = await runPowerShellJson('host/port-owner.ps1', {
    appRoot: ROOT,
    args: ['-Port', String(port), '-ExePath', process.execPath]
  });
  assert.equal(result.listening, true);
  assert.equal(result.loopbackOnly, true);
  assert.equal(result.matchesExe, true);
  assert.equal(result.owner.pid, process.pid);
});

test('host platform: restart refuses a missing ZCode executable', async (t) => {
  const dir = tempDir('bb-restart-missing-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  await assert.rejects(
    runPowerShellJson('host/restart.ps1', {
      appRoot: ROOT,
      args: ['-ExePath', path.join(dir, 'ZCode.exe'), '-Port', '19329']
    }),
    (error) => error.code === 'HOST_NOT_FOUND'
  );
});

test('host platform: restart refuses a debug port owned by another process', async (t) => {
  const dir = tempDir('bb-restart-port-');
  const fakeExe = path.join(dir, 'ZCode.exe');
  fs.writeFileSync(fakeExe, 'fake-exe', 'utf8');

  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  t.after(async () => {
    fs.rmSync(dir, { recursive: true, force: true });
    await new Promise((resolve) => server.close(resolve));
  });

  await assert.rejects(
    runPowerShellJson('host/restart.ps1', {
      appRoot: ROOT,
      args: ['-ExePath', fakeExe, '-Port', String(port)]
    }),
    (error) => error.code === 'PORT_IN_USE'
  );
});

test('host profile: discovery prefers an existing explicit path', async (t) => {
  const dir = tempDir('bb-find-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const exe = path.join(dir, 'ZCode.exe');
  fs.writeFileSync(exe, 'fake-exe', 'utf8');

  const found = await discoverExecutable({ appRoot: null, env: { ZCODE_PATH: exe } });
  assert.equal(found.path, exe);
  assert.equal(found.source, 'env');
});

test('host platform: executable discovery reports a missing name', async () => {
  const result = await runPowerShellJson('host/find.ps1', {
    appRoot: ROOT,
    args: ['-Name', 'BackdropBuddyMissingHost.exe']
  });
  assert.equal(result.ok, true);
  assert.equal(result.found, false);
  assert.equal(result.path, null);
});

test('host platform: host hash changes when a host file changes', async (t) => {
  const dir = tempDir('bb-hash-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'resources'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'ZCode.exe'), 'fake-exe', 'utf8');
  fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), 'fake-asar', 'utf8');

  const first = await runPowerShellJson('backup/host-hash.ps1', {
    appRoot: ROOT,
    args: ['-HostRoot', dir]
  });
  assert.equal(first.ok, true);
  assert.equal(first.count, 2);
  assert.equal(first.complete, true);

  fs.writeFileSync(path.join(dir, 'resources', 'app.asar'), 'changed-asar', 'utf8');
  const second = await runPowerShellJson('backup/host-hash.ps1', {
    appRoot: ROOT,
    args: ['-HostRoot', dir]
  });
  assert.notEqual(second.aggregate, first.aggregate);
});

test('host css: dual-mode blocks carry separate surfaces and foreground tokens', () => {
  const light = { ...TOKENS };
  const dark = {
    ...TOKENS,
    panel: 'rgba(18,18,20,0.52)',
    dim: 'rgba(18,18,20,0.31)',
    foreground: '#e8e8ea',
    foregroundSubtle: 'rgba(232,232,234,0.78)'
  };
  const css = buildThemeCss({
    params: normalizeThemeParams({ accent: '#6F9275', panel: 30 }),
    media: { kind: 'image', url: 'file:///C:/data/media.jpg' },
    tokens: dark,
    tokensByMode: { light, dark },
    mode: 'dark'
  });

  assert.match(css, /:root, html\.theme-zai-light \{/);
  assert.match(css, /html\.dark, html\.theme-zai-dark \{/);
  assert.ok(css.includes('html.dark, html.theme-zai-dark {\n  --color-background: rgba(18,18,20,0.52)'));
  assert.match(css, /--color-foreground: #e8e8ea !important/);
  assert.match(css, /--color-foreground-subtle: rgba\(232,232,234,0\.78\)/);
  assert.match(css, /--color-border: rgba\(0,0,0,0\.12\) !important/);
  assert.match(css, /background: var\(--bb-dim\)/);
  assert.match(css, /background: var\(--bb-safe\)/);
  assert.match(css, /filter: blur\(2px\)/);
});

test('host platform: luminance raises panel alpha on bright wallpapers', async () => {
  const run = (values) => runPowerShellJson('theme/color.ps1', {
    appRoot: ROOT,
    args: [
      '-Mode', 'dark',
      '-Panel', '30',
      '-Bubble', '0',
      '-Mean', values.mean,
      '-Center', values.center,
      '-P15', values.p15,
      '-P75', values.p75,
      '-P85', values.p85,
      '-P90', values.p90,
      '-P99', values.p99,
      '-Highlight', values.highlight
    ]
  });
  const dim = await run({ mean: '0.18', center: '0.2', p15: '0.05', p75: '0.28', p85: '0.32', p90: '0.34', p99: '0.4', highlight: '0.01' });
  const bright = await run({ mean: '0.92', center: '0.94', p15: '0.9', p75: '0.97', p85: '0.98', p90: '0.99', p99: '1', highlight: '0.7' });

  assert.equal(dim.ok, true);
  assert.ok(bright.luminance.darkPanel > dim.luminance.darkPanel);
  assert.ok(bright.luminance.darkDim > dim.luminance.darkDim);
  assert.match(bright.panel, /^rgba\(18,18,20,0\./);
  assert.match(bright.dark.panel, /^rgba\(18,18,20,0\./);
  assert.match(bright.light.panel, /^rgba\(255,255,255,0\./);
  assert.ok(bright.light.panel !== bright.dark.panel);
});

test('host platform: luminance analysis returns a 4x3 grid', async () => {
  const file = path.join(ROOT, 'assets', 'original.jpg');
  const result = await runPowerShellJson('theme/luminance.ps1', { appRoot: ROOT, args: ['-Path', file] });

  assert.equal(result.ok, true);
  assert.equal(result.grid.length, 12);
  assert.ok(result.mean >= 0 && result.mean <= 1);
  assert.ok(result.p90 >= result.p50);
  assert.ok(result.highlight >= 0 && result.highlight <= 1);
});

test('host platform: selectors outside the whitelist are rejected', async (t) => {
  const dir = tempDir('bb-css-selector-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'bad-selector.css');
  fs.writeFileSync(file, 'html > div { color: red; }', 'utf8');

  await assert.rejects(
    runPowerShellJson('theme/validate-css.ps1', { appRoot: ROOT, args: ['-Path', file] }),
    (error) => error.code === 'CSS_REJECTED'
  );
});
