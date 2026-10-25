import { CdpSession } from './detect.mjs';
import { createDetector } from './detect.mjs';
import { createHostAdapter } from './adapter.mjs';
import { createGenericProfile } from './generic.mjs';
import { validateProfile } from './user-profiles.mjs';
import { inspectExpression } from './inspect.mjs';
import { pickerExpression, pickPollExpression, pickCancelExpression } from './selector.mjs';
import { AppError } from '../protocol/errors.mjs';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function assertPort(port) {
  const value = Number(port);
  if (!Number.isInteger(value) || value < 1024 || value > 65535) {
    throw new AppError('BAD_PARAMS', '调试端口必须是 1024–65535 的整数');
  }
  return value;
}

async function listTargets(port, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const targets = await response.json();
    return Array.isArray(targets) ? targets : [];
  } catch (error) {
    throw new AppError('HOST_UNREACHABLE', `连不上 127.0.0.1:${port}：${error.message}`, { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

// 只允许回环地址，和配置宿主时同一条约束。
async function connect(port) {
  const targets = await listTargets(assertPort(port));
  const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl);
  if (!page) throw new AppError('HOST_NOT_READY', '该端口没有可调试的页面目标', { retryable: true });

  let parsed;
  try { parsed = new URL(page.webSocketDebuggerUrl); } catch { throw new AppError('HOST_UNREACHABLE', '调试地址格式无效'); }
  if (!LOOPBACK.has(parsed.hostname)) throw new AppError('HOST_UNREACHABLE', `拒绝连接非回环调试地址：${parsed.hostname}`);

  const session = await CdpSession.open(page.webSocketDebuggerUrl, { timeoutMs: 5000 });
  return { session, target: page, targets };
}

async function withSession(port, fn) {
  const { session } = await connect(port);
  try { return await fn(session); } finally { session.close(); }
}

export async function inspectHost({ port }) {
  return withSession(port, async (session) => {
    const result = await session.evaluate(inspectExpression(), { timeoutMs: 12000 });
    if (!result || typeof result !== 'object') throw new AppError('HOST_NOT_READY', '页面没有返回可用的 DOM 信息');
    return result;
  });
}

export async function pickStart({ port }) {
  return withSession(port, async (session) => {
    const result = await session.evaluate(pickerExpression(), { timeoutMs: 8000 });
    return result || { started: false };
  });
}

export async function pickPoll({ port }) {
  return withSession(port, async (session) => {
    const result = await session.evaluate(pickPollExpression(), { timeoutMs: 8000 });
    return result || { known: false };
  });
}

export async function pickCancel({ port }) {
  return withSession(port, async (session) => {
    const result = await session.evaluate(pickCancelExpression(), { timeoutMs: 8000 });
    return result || { cancelled: true };
  });
}

// 试穿：用候选 profile 建一个不进 runtime 的临时适配器，应用→暂停→继续→恢复。
// 不写 pointer/runtime，不影响当前正在使用的宿主。
export async function testProfile({ profile, appRoot, paths, logger }) {
  const validated = validateProfile(profile);
  if (!validated.ok) {
    throw new AppError('BAD_PARAMS', '宿主配置不合法：' + validated.errors.join('；'), { details: validated.errors });
  }

  const testProfile = createGenericProfile(validated.profile);
  const detector = createDetector({ profile: testProfile, appRoot, logger });
  const adapter = createHostAdapter({
    detector,
    logger,
    appRoot,
    paths,
    profile: testProfile,
    runtime: null
  });

  const theme = { id: 'profile-smoke', name: '接入试穿', params: {}, media: null, ephemeral: true };
  const params = { x: 40, y: 35, zoom: 118, accent: '#2E7FCB' };

  let applied = null;
  let paused = null;
  let resumed = null;
  let restored = null;
  let error = null;
  try {
    applied = await adapter.apply({ theme, params });
    paused = await adapter.pause();
    resumed = await adapter.resume();
  } catch (failure) {
    error = { code: failure.code || 'PROFILE_TEST_FAILED', message: failure.message, details: failure.details || null };
  } finally {
    try { restored = await adapter.restore(); } catch (failure) {
      if (!error) error = { code: 'PROFILE_RESTORE_FAILED', message: failure.message };
    }
  }

  return {
    ok: !error && !!applied && !!restored && restored.verified !== false,
    cssBytes: applied && applied.css ? applied.css.bytes : null,
    injected: applied ? !!applied.injected : false,
    verification: applied ? applied.verification : null,
    paused: paused ? paused.verified : null,
    resumed: resumed ? resumed.verified : null,
    restored: restored ? { verified: restored.verified, clean: !restored.verification || restored.verification.themed === null } : null,
    error
  };
}
