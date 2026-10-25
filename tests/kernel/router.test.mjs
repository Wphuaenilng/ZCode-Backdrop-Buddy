import test from 'node:test';
import assert from 'node:assert/strict';
import { Router } from '../../kernel/protocol/router.mjs';
import { AppError } from '../../kernel/protocol/errors.mjs';
import { PROTOCOL_VERSION, METHODS, ERRORS } from '../../shared/protocol/constants.mjs';

function req(id, method, params = {}) {
  return { v: PROTOCOL_VERSION, id, type: 'request', method, params };
}

function makeRouter() {
  const router = new Router();
  router.register(METHODS.SYSTEM_HELLO, async () => ({ protocol: PROTOCOL_VERSION }));
  router.register(METHODS.SYSTEM_PING, async () => ({ pong: true }));
  router.register(METHODS.STATUS_GET, async () => ({ running: false }));
  return router;
}

test('router: rejects unsupported protocol version', async () => {
  const router = makeRouter();
  const response = await router.handle({ ...req('a', METHODS.SYSTEM_HELLO), v: 'dreamskin.manager/2' });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, ERRORS.BAD_ENVELOPE);
});

test('router: handshake is required before business methods', async () => {
  const router = makeRouter();
  const response = await router.handle(req('a', METHODS.SYSTEM_PING));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, ERRORS.HANDSHAKE_REQUIRED);
  const hello = await router.handle(req('b', METHODS.SYSTEM_HELLO));
  assert.equal(hello.ok, true);
  const ping = await router.handle(req('c', METHODS.SYSTEM_PING));
  assert.equal(ping.ok, true);
});

test('router: duplicate requestId executes once and returns the cached response', async () => {
  let calls = 0;
  const router = makeRouter();
  router.register('theme.list', async () => { calls += 1; return { calls }; });
  await router.handle(req('hello', METHODS.SYSTEM_HELLO));
  const first = await router.handle(req('dup', 'theme.list'));
  const second = await router.handle(req('dup', 'theme.list'));
  assert.equal(calls, 1);
  assert.deepEqual(first, second);
});

test('router: status.get returns BUSY while another status request is in flight', async () => {
  let release;
  const router = new Router();
  router.register(METHODS.SYSTEM_HELLO, async () => ({}));
  router.register(METHODS.STATUS_GET, () => new Promise((resolve) => { release = () => resolve({ ok: true }); }));
  await router.handle(req('hello', METHODS.SYSTEM_HELLO));
  const firstPromise = router.handle(req('s1', METHODS.STATUS_GET));
  await Promise.resolve();
  const second = await router.handle(req('s2', METHODS.STATUS_GET));
  assert.equal(second.ok, false);
  assert.equal(second.error.code, ERRORS.BUSY);
  assert.equal(second.error.retryable, true);
  release();
  const first = await firstPromise;
  assert.equal(first.ok, true);
});

test('router: ids older than the dedupe window can execute again', async () => {
  let calls = 0;
  const router = new Router({ dedupeWindow: 2 });
  router.register(METHODS.SYSTEM_HELLO, async () => ({}));
  router.register('theme.list', async () => { calls += 1; return { calls }; });
  await router.handle(req('hello', METHODS.SYSTEM_HELLO));
  await router.handle(req('a', 'theme.list'));
  await router.handle(req('b', 'theme.list'));
  await router.handle(req('c', 'theme.list'));
  const again = await router.handle(req('a', 'theme.list'));
  assert.equal(calls, 4);
  assert.equal(again.data.calls, 4);
});

test('router: the same id on a different method is executed, not replayed', async () => {
  let helloCalls = 0;
  let pingCalls = 0;
  const router = new Router();
  router.register(METHODS.SYSTEM_HELLO, async () => { helloCalls += 1; return { protocol: PROTOCOL_VERSION }; });
  router.register(METHODS.SYSTEM_PING, async () => { pingCalls += 1; return { pong: true }; });

  const hello = await router.handle(req('ui-1', METHODS.SYSTEM_HELLO));
  assert.equal(hello.ok, true);
  const ping = await router.handle(req('ui-1', METHODS.SYSTEM_PING));

  assert.equal(ping.ok, true);
  assert.deepEqual(ping.data, { pong: true });
  assert.equal(helloCalls, 1);
  assert.equal(pingCalls, 1);
});

test('router: retryable failures are not cached for the same id', async () => {
  let calls = 0;
  const router = new Router();
  router.register(METHODS.SYSTEM_HELLO, async () => ({}));
  router.register('theme.apply', async () => {
    calls += 1;
    throw new AppError('HOST_NOT_READY', 'page not ready', { retryable: true });
  });

  await router.handle(req('hello', METHODS.SYSTEM_HELLO));
  const first = await router.handle(req('retry-1', 'theme.apply'));
  const second = await router.handle(req('retry-1', 'theme.apply'));

  assert.equal(first.ok, false);
  assert.equal(first.error.code, 'HOST_NOT_READY');
  assert.equal(second.ok, false);
  assert.equal(calls, 2);
});

test('router: non-retryable failures are cached for the same id', async () => {
  let calls = 0;
  const router = new Router();
  router.register(METHODS.SYSTEM_HELLO, async () => ({}));
  router.register('theme.apply', async () => {
    calls += 1;
    throw new AppError('THEME_NOT_FOUND', 'missing');
  });

  await router.handle(req('hello', METHODS.SYSTEM_HELLO));
  await router.handle(req('same-1', 'theme.apply'));
  await router.handle(req('same-1', 'theme.apply'));
  assert.equal(calls, 1);
});

test('router: unknown method is METHOD_NOT_FOUND', async () => {
  const router = makeRouter();
  await router.handle(req('hello', METHODS.SYSTEM_HELLO));
  const response = await router.handle(req('x', 'theme.nope'));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, ERRORS.METHOD_NOT_FOUND);
});
