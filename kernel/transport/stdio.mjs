import { METHODS } from '../../shared/protocol/constants.mjs';
import { failure } from '../protocol/envelope.mjs';
import { LineReader } from './line-reader.mjs';
import { LineWriter } from './line-writer.mjs';
import { createShutdown } from './shutdown.mjs';

// Read-only methods never block behind a slow write (theme.apply can take seconds).
const READ_ONLY_METHODS = new Set([
  METHODS.STATUS_GET,
  METHODS.SYSTEM_PING,
  METHODS.LOG_TAIL,
  METHODS.HOST_STATUS,
  METHODS.MEDIA_URL
]);

function errorEnvelope(code, message, id = null) {
  return JSON.stringify(failure(id, { code, message, retryable: false }));
}

export function attachStdio({ kernel, writer = new LineWriter(), input = process.stdin } = {}) {
  const shutdown = createShutdown({ kernel, writer, logger: kernel?.logger });
  let chain = Promise.resolve();
  let handshakeDone = false;

  function writeEnvelope(envelope) {
    let line;
    try {
      line = JSON.stringify(envelope);
    } catch (error) {
      kernel.logger?.error('response serialization failed', { message: error?.message });
      const id = envelope && typeof envelope.id === 'string' ? envelope.id : null;
      line = errorEnvelope('INTERNAL', 'response serialization failed', id);
    }
    writer.writeLine(line);
  }

  function releaseInput() {
    try { input.resume?.(); } catch { /* input may already be gone */ }
  }

  if (kernel) {
    writer.onBackpressure = (pressed) => {
      try {
        if (pressed) input.pause?.();
        else input.resume?.();
      } catch { /* the pipe may be closing */ }
    };
  }

  // A dead stdout must not leave stdin paused forever.
  const stream = writer.stream;
  const onStreamGone = () => {
    writer.reset?.();
    releaseInput();
  };
  if (stream && typeof stream.on === 'function') {
    stream.on('error', onStreamGone);
    stream.on('close', onStreamGone);
  }

  async function dispatch(message) {
    let response;
    try {
      response = await kernel.handle(message);
    } catch (error) {
      kernel.logger?.error('request handling failed', { message: error?.message });
      response = failure(
        message && typeof message.id === 'string' ? message.id : null,
        { code: 'INTERNAL', message: 'request handling failed', retryable: false }
      );
    }

    if (response && response.ok === true && message && message.method === METHODS.SYSTEM_HELLO) {
      handshakeDone = true;
    }

    writeEnvelope(response);

    if (kernel.lifecycle?.closing) await shutdown('system.shutdown');
  }

  const reader = new LineReader({
    onLine(line) {
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        writer.writeLine(errorEnvelope('BAD_ENVELOPE', 'invalid JSON'));
        return;
      }

      if (handshakeDone && message && READ_ONLY_METHODS.has(message.method)) {
        dispatch(message).catch((error) => kernel.logger?.error('read-only request failed', { message: error?.message }));
        return;
      }

      chain = chain
        .then(() => dispatch(message))
        .catch((error) => kernel.logger?.error('request handling failed', { message: error?.message }));
    },
    onError(error) {
      writer.writeLine(errorEnvelope(error.code || 'MESSAGE_TOO_LARGE', `message exceeds ${error.bytes} bytes`));
    }
  });

  const offEvents = kernel.bus.onAny((envelope) => {
    let line;
    try {
      line = JSON.stringify(envelope);
    } catch (error) {
      kernel.logger?.warn('event serialization failed', { message: error?.message });
      return;
    }
    writer.writeLine(line);
  });

  input.on('data', (chunk) => reader.push(chunk));
  input.on('end', () => { shutdown('stdin-end'); });
  input.on('error', () => { shutdown('stdin-error'); });

  const onSignal = () => { shutdown('signal'); };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  return {
    reader,
    writer,
    detach() {
      offEvents();
      input.removeAllListeners('data');
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      writer.onBackpressure = null;
      if (stream && typeof stream.removeListener === 'function') {
        stream.removeListener('error', onStreamGone);
        stream.removeListener('close', onStreamGone);
      }
    }
  };
}
