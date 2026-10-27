import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { installHostStartupVideo, playHostStartupAnimation } from '../../kernel/host/startup-animation.mjs';
import { createHostAdapter } from '../../kernel/host/adapter.mjs';
import { ZCODE_PROFILE } from '../../kernel/host/zcode.mjs';
import { resolvePaths } from '../../kernel/store/paths.mjs';

function fakeStatus() {
  return {
    ready: true,
    safeToInject: true,
    target: { id: 'main-window', wsUrl: 'ws://127.0.0.1:9229/devtools/page/main' }
  };
}

function fakeSession({ status = { phase: 'playing', ready: true, completed: false }, installResult = { installed: true } } = {}) {
  const calls = [];
  return {
    calls,
    async evaluate(expression) {
      calls.push({ method: 'evaluate', expression });
      if (expression.includes('installHostStartupVideo')) return installResult;
      if (expression.includes('.status()')) return status;
      return true;
    },
    async send(method, params) {
      calls.push({ method, params });
      if (method === 'Runtime.evaluate') return { result: { objectId: 'file-input' } };
      return {};
    },
    close() { calls.push({ method: 'close' }); }
  };
}

test('host startup: validated video is handed to the main window through CDP', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-host-startup-'));
  const video = path.join(dir, 'intro.mp4');
  fs.writeFileSync(video, 'video');
  const session = fakeSession();
  try {
    const result = await playHostStartupAnimation({
      status: fakeStatus(), videoPath: video, openSession: async () => session
    });
    assert.equal(result.started, true);
    const delivery = session.calls.find((call) => call.method === 'DOM.setFileInputFiles');
    assert.deepEqual(delivery.params.files, [video]);
    assert.equal(delivery.params.objectId, 'file-input');
    assert.ok(session.calls.some((call) => call.method === 'Runtime.releaseObject'));
    assert.equal(session.calls.at(-1).method, 'close');
    assert.equal(session.calls.some((call) => call.expression?.includes('.dispose()')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('host startup: failed playback disposes only the animation and closes CDP', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-host-startup-'));
  const video = path.join(dir, 'intro.mp4');
  fs.writeFileSync(video, 'video');
  const session = fakeSession({ status: { phase: 'failed', ready: false, completed: false } });
  try {
    await assert.rejects(playHostStartupAnimation({
      status: fakeStatus(), videoPath: video, openSession: async () => session
    }), /startup video failed/);
    assert.ok(session.calls.some((call) => call.expression?.includes('.dispose()')));
    assert.equal(session.calls.at(-1).method, 'close');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('host startup: unverified host and missing media never connect', async () => {
  let connections = 0;
  const openSession = async () => { connections += 1; return fakeSession(); };
  await assert.rejects(playHostStartupAnimation({
    status: { ...fakeStatus(), safeToInject: false },
    videoPath: 'F:\\missing.mp4', openSession
  }), /not verified/);
  await assert.rejects(playHostStartupAnimation({
    status: fakeStatus(), videoPath: 'F:\\missing.mp4', openSession
  }), /ENOENT|unavailable/);
  assert.equal(connections, 0);
});

test('host startup: overlay is one-shot, silent, muted and cleans itself up', () => {
  const source = installHostStartupVideo.toString();
  assert.match(source, /window\.__bbStartupShown/);
  assert.match(source, /video\.muted = true/);
  assert.match(source, /video\.loop = false/);
  assert.match(source, /video\.play\(\)/);
  assert.match(source, /createMediaElementSource/);
  assert.match(source, /gain\.gain\.value = 0/);
  assert.match(source, /audioContext\.close/);
  assert.match(source, /URL\.revokeObjectURL/);
  assert.match(source, /window\.__bbStartupAnimation = api/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.doesNotMatch(source, /https?:\/\//);
});

test('host startup: only a newly launched host plays; failures never fail restart', async (t) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-host-orchestration-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const videoPath = path.join(dataDir, 'intro.mp4');
  fs.writeFileSync(videoPath, 'video');
  const paths = resolvePaths({ dataRoot: dataDir, appRoot: dataDir });
  fs.writeFileSync(paths.startupAnimation, JSON.stringify({ schemaVersion: 1, enabled: true, videoPath }));
  const launches = [];
  const adapter = createHostAdapter({
    detector: {
      detect: async () => ({ ...fakeStatus(), installed: true, running: true, portOpen: true, supported: true, ownership: { verified: true } }),
      invalidate() {}
    },
    appRoot: dataDir,
    paths,
    profile: { ...ZCODE_PROFILE, exe: videoPath },
    restartHost: async () => ({ ok: true, alreadyOpen: false, pid: 42 }),
    playStartupAnimation: async ({ status, videoPath: selected }) => {
      launches.push({ status, videoPath: selected });
      return { started: true, phase: 'playing' };
    }
  });
  const launched = await adapter.restart({ reapply: false });
  assert.equal(launched.startupAnimation.started, true);
  assert.equal(launches.length, 1);
  assert.equal(launches[0].status.safeToInject, true);
  assert.equal(launches[0].videoPath, videoPath);

  const alreadyOpen = createHostAdapter({
    detector: {
      detect: async () => ({ ...fakeStatus(), installed: true, running: true, portOpen: true, supported: true, ownership: { verified: true } }),
      invalidate() {}
    },
    appRoot: dataDir,
    paths,
    profile: { ...ZCODE_PROFILE, exe: videoPath },
    restartHost: async () => ({ ok: true, alreadyOpen: true }),
    playStartupAnimation: async () => { throw new Error('must not play for an existing host'); }
  });
  const existing = await alreadyOpen.restart({ reapply: false });
  assert.equal(existing.startupAnimation, null);

  const failed = createHostAdapter({
    detector: {
      detect: async () => ({ ...fakeStatus(), installed: true, running: true, portOpen: true, supported: true, ownership: { verified: true } }),
      invalidate() {}
    },
    appRoot: dataDir,
    paths,
    profile: { ...ZCODE_PROFILE, exe: videoPath },
    restartHost: async () => ({ ok: true, alreadyOpen: false, pid: 43 }),
    playStartupAnimation: async () => { throw new Error('decode failed'); }
  });
  const recovered = await failed.restart({ reapply: false });
  assert.equal(recovered.restart.ok, true);
  assert.equal(recovered.startupAnimation.started, false);
  assert.match(recovered.startupAnimation.reason, /decode failed/);
});
