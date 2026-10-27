import test from 'node:test';
import assert from 'node:assert/strict';
import { CdpSession, openBrowserCdp } from '../../kernel/host/detect.mjs';

class FakeSocket extends EventTarget {
  constructor() {
    super();
    this.sent = [];
    this.closed = false;
  }

  send(text) {
    this.sent.push(JSON.parse(text));
  }

  close() {
    this.closed = true;
    this.dispatchEvent(new Event('close'));
  }

  receive(message) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
  }
}

test('cdp: flattened sessions preserve command responses and dispatch events', async () => {
  const socket = new FakeSocket();
  const session = new CdpSession(socket);
  const events = [];
  const unsubscribe = session.on('Target.attachedToTarget', (params, message) => {
    events.push({ params, sessionId: message.sessionId });
  });

  const pending = session.send('Runtime.runIfWaitingForDebugger', {}, 1000, 'page-session');
  assert.deepEqual(socket.sent[0], {
    id: 1,
    method: 'Runtime.runIfWaitingForDebugger',
    params: {},
    sessionId: 'page-session'
  });
  socket.receive({ id: 1, sessionId: 'page-session', result: { resumed: true } });
  assert.deepEqual(await pending, { resumed: true });

  const payload = { sessionId: 'page-session', targetInfo: { targetId: 'main' }, waitingForDebugger: true };
  socket.receive({ method: 'Target.attachedToTarget', sessionId: 'browser-session', params: payload });
  unsubscribe();
  socket.receive({ method: 'Target.attachedToTarget', params: payload });
  assert.equal(events.length, 1);
  assert.equal(events[0].sessionId, 'browser-session');
  assert.equal(events[0].params.targetInfo.targetId, 'main');
});

test('cdp: malformed events do not break commands and close rejects pending work', async () => {
  const socket = new FakeSocket();
  const session = new CdpSession(socket);
  session.on('Runtime.bindingCalled', () => { throw new Error('observer failed'); });
  const pending = session.send('Runtime.evaluate', { expression: '1' }, 1000);
  socket.receive(new MessageEvent('message', { data: '{broken' }));
  socket.receive({ method: 'Runtime.bindingCalled', params: { name: 'test' } });
  socket.receive({ id: 1, result: { result: { value: 1 } } });
  assert.deepEqual(await pending, { result: { value: 1 } });

  const abandoned = session.send('Page.enable');
  session.close();
  await assert.rejects(abandoned, /socket closed/);
  assert.equal(session.closed, true);
});

test('cdp: browser connector accepts loopback and rejects remote endpoints', async (t) => {
  const OriginalWebSocket = globalThis.WebSocket;
  t.after(() => { globalThis.WebSocket = OriginalWebSocket; });

  class BrowserSocket extends FakeSocket {
    constructor(url) {
      super();
      this.url = url;
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
  }
  globalThis.WebSocket = BrowserSocket;

  const session = await openBrowserCdp({ webSocketDebuggerUrl: 'ws://127.0.0.1:9229/devtools/browser/abc' });
  assert.ok(session instanceof CdpSession);
  assert.equal(session.socket.url, 'ws://127.0.0.1:9229/devtools/browser/abc');
  session.close();

  await assert.rejects(
    openBrowserCdp('ws://192.0.2.10:9229/devtools/browser/abc'),
    (error) => error.code === 'HOST_UNREACHABLE' && /非回环/.test(error.message)
  );
});
