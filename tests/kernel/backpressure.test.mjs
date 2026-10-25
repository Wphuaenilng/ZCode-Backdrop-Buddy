import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { LineWriter } from '../../kernel/transport/line-writer.mjs';
import { attachStdio } from '../../kernel/transport/stdio.mjs';
import { PROTOCOL_VERSION, METHODS } from '../../shared/protocol/constants.mjs';

test('line writer: slow stdout raises and clears backpressure, then drains', async () => {
  const events = [];
  const stream = {
    write(payload, callback) {
      setTimeout(callback, 2);
      return true;
    }
  };

  const writer = new LineWriter({
    stream,
    highWater: 64,
    onBackpressure: (value) => events.push(value)
  });

  for (let index = 0; index < 12; index += 1) {
    writer.writeLine('x'.repeat(40) + index);
  }

  assert.equal(events[0], true, 'pressure should be raised once the queue exceeds highWater');
  assert.equal(writer.pressured, true);
  assert.ok(writer.pendingBytes > 64);

  await writer.drain();
  assert.equal(events[events.length - 1], false, 'pressure should clear after the queue drains');
  assert.equal(writer.pressured, false);
  assert.equal(writer.pendingBytes, 0);
  assert.equal(writer.queue.length, 0);
});

test('line writer: exceptions from the stream do not wedge the queue', async () => {
  let calls = 0;
  const stream = {
    write(payload, callback) {
      calls += 1;
      if (calls === 1) throw new Error('broken pipe');
      setTimeout(callback, 1);
      return true;
    }
  };

  const writer = new LineWriter({ stream, highWater: 16 });
  writer.writeLine('first');
  writer.writeLine('second');
  await writer.drain();
  assert.equal(calls, 2);
  assert.equal(writer.pendingBytes, 0);
});

function fakeKernel({ delayMs = 0 } = {}) {
  const listeners = new Set();
  const logger = { info() {}, warn() {}, error() {}, debug() {} };

  const reply = (message, data) => ({
    v: PROTOCOL_VERSION, id: message.id, type: 'response', ok: true, data
  });

  return {
    logger,
    lifecycle: { closing: false },
    bus: {
      onAny(handler) {
        listeners.add(handler);
        return () => listeners.delete(handler);
      }
    },
    async handle(message) {
      if (message.method === METHODS.SYSTEM_HELLO) return reply(message, { protocol: PROTOCOL_VERSION });
      if (message.method === 'theme.apply') {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return reply(message, { applied: true });
      }
      if (message.method === METHODS.STATUS_GET) return reply(message, { running: true });
      return reply(message, { ok: true });
    }
  };
}

function fakeInput() {
  const handlers = new Map();
  return {
    paused: false,
    on(event, handler) { handlers.set(event, handler); },
    removeAllListeners(event) { handlers.delete(event); },
    pause() { this.paused = true; },
    resume() { this.paused = false; },
    push(text) { handlers.get('data')?.(text); }
  };
}

function fakeStdout({ delayMs = 0 } = {}) {
  const stream = new EventEmitter();
  stream.written = [];
  stream.write = (payload, callback) => {
    stream.written.push(payload);
    setTimeout(callback, delayMs);
    return true;
  };
  return stream;
}

function line(id, method, params = {}) {
  return JSON.stringify({ v: PROTOCOL_VERSION, id, type: 'request', method, params }) + '\n';
}

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('timed out waiting for condition');
}

test('stdio: status.get is answered while a slow theme.apply is still running', async (t) => {
  const stream = fakeStdout();
  const input = fakeInput();
  const kernel = fakeKernel({ delayMs: 150 });
  const io = attachStdio({ kernel, writer: new LineWriter({ stream }), input });
  t.after(() => io.detach());

  input.push(line('h1', METHODS.SYSTEM_HELLO));
  await waitFor(() => stream.written.some((entry) => entry.includes('"h1"')));

  input.push(line('apply-1', 'theme.apply'));
  input.push(line('status-1', METHODS.STATUS_GET));

  await waitFor(() => stream.written.some((entry) => entry.includes('"status-1"')));
  assert.equal(stream.written.some((entry) => entry.includes('"apply-1"')), false, 'apply should still be in flight');

  await waitFor(() => stream.written.some((entry) => entry.includes('"apply-1"')));
});

test('stdio: backpressure pauses and resumes stdin through the attached writer', async (t) => {
  const stream = fakeStdout({ delayMs: 25 });
  const input = fakeInput();
  const kernel = fakeKernel();
  const io = attachStdio({ kernel, writer: new LineWriter({ stream, highWater: 32 }), input });
  t.after(() => io.detach());

  input.push(line('h1', METHODS.SYSTEM_HELLO));
  input.push(line('p1', METHODS.SYSTEM_PING));

  await waitFor(() => input.paused === true);
  await io.writer.drain();
  assert.equal(input.paused, false);
  assert.equal(io.writer.pressured, false);
});

test('stdio: a dead stdout releases stdin instead of leaving it paused', async (t) => {
  const stream = new EventEmitter();
  stream.write = () => true;
  const input = fakeInput();
  const kernel = fakeKernel();
  const io = attachStdio({ kernel, writer: new LineWriter({ stream, highWater: 8 }), input });
  t.after(() => io.detach());

  input.push(line('h1', METHODS.SYSTEM_HELLO));
  await waitFor(() => input.paused === true);

  stream.emit('error', new Error('EPIPE'));
  await waitFor(() => input.paused === false);
});
