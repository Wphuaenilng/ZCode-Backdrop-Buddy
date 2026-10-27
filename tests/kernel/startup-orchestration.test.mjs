import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHostAdapter } from '../../kernel/host/adapter.mjs';
import { ZCODE_PROFILE } from '../../kernel/host/zcode.mjs';
import { resolvePaths } from '../../kernel/store/paths.mjs';

function readyStatus() {
  return {
    installed: true,
    running: true,
    ready: true,
    safeToInject: true,
    portOpen: true,
    supported: true,
    ownership: { verified: true },
    target: { id: 'main', wsUrl: 'ws://127.0.0.1:9229/devtools/page/main' }
  };
}

function setup(t, startupInject) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-startup-orchestration-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const paths = resolvePaths({ dataRoot: dataDir, appRoot: dataDir });
  const videoPath = path.join(dataDir, 'legacy-intro.mp4');
  fs.writeFileSync(videoPath, 'video');
  fs.writeFileSync(paths.startupAnimation, JSON.stringify({ schemaVersion: 1, enabled: true, videoPath }));
  const theme = {
    id: 'my-startup',
    name: '启动主题',
    source: 'user',
    params: { accent: '#A6536A' },
    startup: {
      enabled: true,
      preset: 'theme-reveal',
      holdMs: 1100,
      media: null,
      script: 'alert(1)',
      html: '<img src=x>'
    }
  };
  const calls = { restarts: 0, videos: 0, config: null, configDir: null };
  const adapter = createHostAdapter({
    detector: { detect: async () => readyStatus(), invalidate() {} },
    appRoot: dataDir,
    paths,
    profile: { ...ZCODE_PROFILE, exe: videoPath },
    getStartupTheme: () => theme,
    restartHost: async ({ args, alreadyOpen }) => {
      calls.restarts += 1;
      const configPath = args[args.indexOf('-StartupConfig') + 1];
      calls.configDir = path.dirname(configPath);
      calls.config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      return { ok: true, alreadyOpen: false, startupInject };
    },
    playStartupAnimation: async () => {
      calls.videos += 1;
      return { started: true, phase: 'playing' };
    }
  });
  return { adapter, calls, paths };
}

test('startup orchestration: early success suppresses the legacy late video and cleans config', async (t) => {
  const { adapter, calls } = setup(t, { attached: true, injected: true, elapsedMs: 25, reason: 'injected' });
  const result = await adapter.restart({ reapply: false });
  assert.equal(result.startupInjection.injected, true);
  assert.equal(result.startupAnimation, null);
  assert.equal(calls.videos, 0);
  assert.equal(calls.config.template.preset, 'theme-reveal');
  assert.equal(calls.config.template.holdMs, 1100);
  assert.equal(calls.config.template.accent, '#a6536a');
  assert.match(calls.config.template.launchId, /^[a-z0-9-]{36}$/);
  assert.equal(JSON.stringify(calls.config).includes('alert(1)'), false);
  assert.equal(JSON.stringify(calls.config).includes('<img'), false);
  assert.equal(fs.existsSync(calls.configDir), false);
});

test('startup orchestration: early failure preserves the legacy video fallback', async (t) => {
  const { adapter, calls } = setup(t, { attached: true, injected: false, elapsedMs: 30, reason: 'test-fallback' });
  const result = await adapter.restart({ reapply: false });
  assert.equal(result.startupInjection.injected, false);
  assert.equal(result.startupAnimation.started, true);
  assert.equal(calls.videos, 1);
});

test('startup orchestration: alreadyOpen never starts either animation', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-startup-existing-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const paths = resolvePaths({ dataRoot: dataDir, appRoot: dataDir });
  let configDir = null;
  let videos = 0;
  const adapter = createHostAdapter({
    detector: { detect: async () => readyStatus(), invalidate() {} },
    appRoot: dataDir,
    paths,
    getStartupTheme: () => ({ id: 'my-startup', name: '启动主题', startup: { enabled: true } }),
    restartHost: async ({ args }) => {
      const configPath = args[args.indexOf('-StartupConfig') + 1];
      configDir = path.dirname(configPath);
      return { ok: true, alreadyOpen: true };
    },
    playStartupAnimation: async () => { videos += 1; }
  });
  const result = await adapter.restart({ reapply: false });
  assert.equal(result.startupInjection.reason, 'already-open');
  assert.equal(result.startupInjection.injected, false);
  assert.equal(result.startupAnimation, null);
  assert.equal(videos, 0);
  assert.equal(fs.existsSync(configDir), false);
});
