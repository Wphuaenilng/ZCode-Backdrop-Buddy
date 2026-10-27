import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openBrowserCdp } from './detect.mjs';
import { normalizeStartupTemplate, startupScript } from './startup-template.mjs';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function waitForVersion(port, timeoutMs, fetchVersion) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const version = await fetchVersion(port, 250);
      if (version && version.webSocketDebuggerUrl) return version;
    } catch { /* the host may still be starting */ }
    await delay(10);
  }
  throw new Error(`debug port ${port} did not expose CDP within ${timeoutMs}ms`);
}

export function isStartupRendererUrl(value, { allowBlank = false } = {}) {
  const url = String(value || '');
  // A paused Electron renderer may have no URL before its first navigation.
  // It is only a provisional target: installStartupLayer rechecks the final file URL.
  if (allowBlank && (!url || url === 'about:blank')) return true;
  if (!/^file:/i.test(url) || !/out[\/]renderer[\/]index\.html(?:$|[?#])/i.test(url)) return false;
  return !(/update-status|plugin-sandbox|embedded-browser/i.test(url) || /[?&]windowKind=/i.test(url));
}

function cleanReason(error, fallback = 'injection-failed') {
  const text = String(error && error.message ? error.message : error || fallback);
  return text.replace(/[\r\n]+/g, ' ').slice(0, 180) || fallback;
}

function writeResult(file, result) {
  if (!file) return;
  try {
    const destination = path.resolve(file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    const temp = `${destination}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(result, null, 2), 'utf8');
    fs.renameSync(temp, destination);
  } catch { /* result reporting must not change host startup */ }
}

export async function runStartupInjector({
  port,
  template = {},
  resultPath = null,
  waitPortMs = 45000,
  settleMs = 4000,
  watchdogMs = 800,
  openSession = openBrowserCdp,
  fetchVersion = (value, timeoutMs) => fetchJson(`http://127.0.0.1:${value}/json/version`, timeoutMs),
  emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`)
} = {}) {
  const startedAt = Date.now();
  const launchId = normalizeStartupTemplate(template).launchId;
  const targets = new Map();
  const watchdogs = new Map();
  let browser = null;
  let attached = false;
  let injected = false;
  let reason = 'no-main-renderer';
  let attachAfterPortMs = null;
  let portOpenedAt = null;
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  let settleTimer = null;

  function report(finalReason) {
    if (finalReason) reason = finalReason;
    finish({ attached, injected, elapsedMs: Date.now() - startedAt, reason });
  }

  async function release(sessionId, why) {
    const target = targets.get(sessionId);
    if (!target || target.releaseRequested) return;
    target.releaseRequested = true;
    try {
      await browser.send('Runtime.runIfWaitingForDebugger', {}, Math.max(100, watchdogMs - 100), sessionId);
      target.resumed = true;
      emit({ event: 'startup.resume', sessionId, reason: why });
    } catch (error) {
      target.resumeError = cleanReason(error);
      // Closing the browser socket is the second fail-open path: Chromium resumes
      // paused targets when their controlling debugger disconnects.
      if (why === 'watchdog' || why === 'inject-error') browser.close();
    }
  }

  function armWatchdog(sessionId) {
    clearTimeout(watchdogs.get(sessionId));
    watchdogs.set(sessionId, setTimeout(() => {
      void release(sessionId, 'watchdog');
    }, watchdogMs));
  }

  function clearWatchdog(sessionId) {
    clearTimeout(watchdogs.get(sessionId));
    watchdogs.delete(sessionId);
  }

  function onBinding(params, message) {
    if (params.name !== '__backdropBuddyStartupReport') return;
    let payload;
    try { payload = JSON.parse(params.payload); } catch { return; }
    if (payload.launchId !== launchId) return;
    emit({ event: 'startup.page', ...payload });
    if (payload.stage !== 'installed' || injected) return;
    const target = targets.get(message.sessionId) || null;
    // A direct current-document installation is only the first half of the
    // verified handoff. Confirm the reloaded document before reporting success.
    if (target && target.expectReload && (!target.reloadConfirmed || payload.timeOrigin === target.currentTimeOrigin)) return;
    injected = true;
    report('injected');
  }

  async function attachTarget(params) {
    const { sessionId, targetInfo, waitingForDebugger } = params;
    emit({ event: 'startup.target', sessionId, targetId: targetInfo.targetId, type: targetInfo.type, url: targetInfo.url, waitingForDebugger, at: Date.now() - startedAt });
    // setAutoAttach can report a target that attachExisting is also attaching.
    // Never register scripts or force a reload through two sessions for one page.
    const duplicate = Array.from(targets.values()).some((target) => target.targetInfo.targetId === targetInfo.targetId);
    if (duplicate) {
      targets.set(sessionId, { targetInfo, releaseRequested: false });
      armWatchdog(sessionId);
      await release(sessionId, 'duplicate-target');
      clearWatchdog(sessionId);
      targets.delete(sessionId);
      return;
    }
    const candidate = targetInfo.type === 'page'
      && isStartupRendererUrl(targetInfo.url, { allowBlank: true });
    if (!candidate) {
      targets.set(sessionId, { targetInfo, releaseRequested: false });
      armWatchdog(sessionId);
      await release(sessionId, 'non-main-target');
      clearWatchdog(sessionId);
      targets.delete(sessionId);
      return;
    }

    const direct = isStartupRendererUrl(targetInfo.url);
    const target = {
      targetInfo,
      direct,
      expectReload: direct,
      reloadConfirmed: false,
      releaseRequested: false,
      resumed: !waitingForDebugger
    };
    targets.set(sessionId, target);
    attached = true;
    if (portOpenedAt && attachAfterPortMs === null) attachAfterPortMs = Date.now() - portOpenedAt;
    armWatchdog(sessionId);
    emit({
      event: 'startup.attach',
      sessionId,
      targetId: targetInfo.targetId,
      url: targetInfo.url,
      waitingForDebugger
    });

    try {
      // These commands are deliberately queued before resume. Awaiting the
      // script-registration response first would deadlock a paused target.
      const registration = browser.send('Page.addScriptToEvaluateOnNewDocument', {
        source: startupScript(template)
      }, watchdogMs, sessionId);
      const binding = browser.send('Runtime.addBinding', {
        name: '__backdropBuddyStartupReport'
      }, watchdogMs, sessionId);
      const pageEnabled = browser.send('Page.enable', {}, watchdogMs, sessionId);
      const runtimeEnabled = browser.send('Runtime.enable', {}, watchdogMs, sessionId);
      if (waitingForDebugger) await release(sessionId, 'commands-queued');
      await Promise.all([registration, binding, pageEnabled, runtimeEnabled]);
      target.registered = true;
      clearWatchdog(sessionId);

      if (!direct) return; // the future main navigation is covered by document_start

      const current = await browser.send('Runtime.evaluate', {
        expression: startupScript(template, { currentDocument: true }),
        returnByValue: true
      }, watchdogMs, sessionId);
      const value = current && current.result && current.result.value;
      if (current.exceptionDetails) throw new Error(current.exceptionDetails.text || 'current document injection failed');
      if (!value || value.installed !== true) {
        reason = cleanReason(value && value.reason, 'current-document-skipped');
        report(reason);
        return;
      }
      if (value.alreadyActive) {
        injected = true;
        report('already-active');
        return;
      }

      target.currentTimeOrigin = value.timeOrigin;
      await browser.send('Page.reload', { ignoreCache: false }, watchdogMs, sessionId);
      target.reloadConfirmed = true;
      emit({ event: 'startup.reload', sessionId, elapsedMs: Date.now() - startedAt });
      // The Runtime.bindingCalled event from the new timeOrigin completes the
      // result. A conservative timeout below still lets the host proceed.
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        injected = true;
        report('current-document-covered-reload-unconfirmed');
      }, Math.min(settleMs, 1500));
    } catch (error) {
      reason = cleanReason(error);
      await release(sessionId, 'inject-error');
      clearWatchdog(sessionId);
      if (direct) report(reason);
    }
  }

  try {
    const numericPort = Number(port);
    if (!Number.isInteger(numericPort) || numericPort < 1 || numericPort > 65535) {
      throw new Error('invalid loopback CDP port');
    }
    const version = await waitForVersion(numericPort, waitPortMs, fetchVersion);
    portOpenedAt = Date.now();
    browser = await openSession(version, { timeoutMs: 3000 });

    browser.on('Target.attachedToTarget', (params) => {
      void attachTarget(params).catch(async (error) => {
        reason = cleanReason(error);
        if (params.sessionId) await release(params.sessionId, 'inject-error');
      });
    });
    browser.on('Target.detachedFromTarget', (params) => {
      clearWatchdog(params.sessionId);
      targets.delete(params.sessionId);
    });
    browser.on('Runtime.bindingCalled', onBinding);
    browser.on('Page.frameNavigated', (params, message) => {
      const target = targets.get(message.sessionId);
      if (!target || !params.frame || params.frame.parentId) return;
      if (isStartupRendererUrl(params.frame.url)) target.direct = true;
    });

    const attaching = new Set();
    const attachExisting = (targetInfo) => {
      if (!targetInfo || targetInfo.type !== 'page' || attaching.has(targetInfo.targetId)) return;
      if (!isStartupRendererUrl(targetInfo.url, { allowBlank: true })) return;
      attaching.add(targetInfo.targetId);
      // autoAttach only covers targets created after it is enabled. The debug
      // port can expose an already-created blank/main renderer, so explicitly
      // attach to that snapshot too. The template still checks the final URL.
      void browser.send('Target.attachToTarget', { targetId: targetInfo.targetId, flatten: true }, watchdogMs)
        .catch((error) => {
          attaching.delete(targetInfo.targetId);
          emit({ event: 'startup.existing-target-skipped', targetId: targetInfo.targetId, reason: cleanReason(error) });
        });
    };
    browser.on('Target.targetCreated', (params) => attachExisting(params.targetInfo));

    await browser.send('Target.setAutoAttach', {
      autoAttach: true,
      waitForDebuggerOnStart: true,
      flatten: true
    }, 1500);
    emit({ event: 'startup.armed', port: numericPort, watchdogMs });
    settleTimer = setTimeout(() => report(reason), settleMs);
    await browser.send('Target.setDiscoverTargets', { discover: true }, watchdogMs);
    const discovered = await browser.send('Target.getTargets', {}, watchdogMs);
    emit({ event: 'startup.targets', at: Date.now() - startedAt, targets: (discovered.targetInfos || []).map(({ targetId, type, url }) => ({ targetId, type, url })) });
    for (const targetInfo of discovered.targetInfos || []) attachExisting(targetInfo);
    await completed;
  } catch (error) {
    reason = cleanReason(error);
    report(reason);
    await completed;
  }

  clearTimeout(settleTimer);
  for (const sessionId of targets.keys()) {
    clearWatchdog(sessionId);
    await release(sessionId, 'injector-finish');
  }
  if (browser) browser.close();
  const result = {
    attached,
    injected,
    elapsedMs: Date.now() - startedAt,
    reason,
    attachAfterPortMs
  };
  writeResult(resultPath, result);
  emit({ event: 'startup.inject', ...result });
  return result;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const match = argv[index].match(/^--([^=]+)(?:=(.*))?$/);
    if (!match) continue;
    result[match[1]] = match[2] === undefined ? argv[++index] : match[2];
  }
  return result;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let config = {};
  try {
    config = args.config ? JSON.parse(fs.readFileSync(path.resolve(args.config), 'utf8')) : {};
  } catch (error) {
    const result = { attached: false, injected: false, elapsedMs: 0, reason: cleanReason(error) };
    emitConfigError(result);
    return;
  }
  // Production timing is fixed by the plan. Tests call runStartupInjector
  // directly with shorter timers instead of weakening the CLI watchdog.
  await runStartupInjector({
    port: config.port,
    template: config.template,
    resultPath: config.resultPath,
    waitPortMs: Number(config.waitPortMs) || 45000,
    settleMs: Number(config.settleMs) || 4000,
    watchdogMs: 800
  });
}

function emitConfigError(result) {
  process.stdout.write(`${JSON.stringify({ event: 'startup.inject', ...result })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch((error) => emitConfigError({ attached: false, injected: false, elapsedMs: 0, reason: cleanReason(error) }));
}
