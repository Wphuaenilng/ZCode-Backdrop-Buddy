import {
  PROTOCOL_VERSION, DEDUPE_WINDOW, METHODS, ERRORS, REQUEST
} from '../../shared/protocol/constants.mjs';
import { failure, response } from './envelope.mjs';
import { publicError } from './errors.mjs';
import { HandshakeState } from './handshake.mjs';
import { RequestIdCache } from './request-id.mjs';

function bad(id, code, message, retryable = false) {
  return failure(id, { code, message, retryable });
}

export class Router {
  constructor({ version = PROTOCOL_VERSION, dedupeWindow = DEDUPE_WINDOW } = {}) {
    this.version = version;
    this.handlers = new Map();
    this.handshake = new HandshakeState();
    this.cache = new RequestIdCache(dedupeWindow);
    this.statusBusy = false;
  }

  register(method, handler) {
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');
    this.handlers.set(method, handler);
    return this;
  }

  get methods() {
    return [...this.handlers.keys()];
  }

  async handle(message) {
    if (!message || typeof message !== 'object') {
      return bad(null, ERRORS.BAD_ENVELOPE, 'message must be an object');
    }
    if (message.v !== this.version) {
      return bad(message.id, ERRORS.BAD_ENVELOPE, `unsupported protocol version: ${message.v}`);
    }
    if (message.type !== REQUEST) {
      return bad(message.id, ERRORS.BAD_ENVELOPE, 'only request messages are accepted on this channel');
    }
    if (typeof message.id !== 'string' || !message.id) {
      return bad(message.id, ERRORS.BAD_ENVELOPE, 'id must be a non-empty string');
    }
    if (typeof message.method !== 'string' || !message.method) {
      return bad(message.id, ERRORS.BAD_ENVELOPE, 'method must be a non-empty string');
    }

    const method = message.method;
    const cacheKey = RequestIdCache.keyFor(method, message.id);
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);

    if (!this.handshake.allows(method)) {
      return bad(message.id, ERRORS.HANDSHAKE_REQUIRED, 'send system.hello first');
    }

    const handler = this.handlers.get(method);
    if (!handler) {
      return this.cache.remember(cacheKey, bad(message.id, ERRORS.METHOD_NOT_FOUND, `unknown method: ${method}`));
    }

    if (method === METHODS.STATUS_GET) {
      if (this.statusBusy) {
        return bad(message.id, ERRORS.BUSY, 'status.get is already in flight', true);
      }
      this.statusBusy = true;
    }

    try {
      const data = await handler(message.params ?? {}, message);
      const result = response(message.id, data);
      this.handshake.markComplete(method);
      return this.cache.remember(cacheKey, result);
    } catch (error) {
      return this.cache.remember(cacheKey, failure(message.id, publicError(error)));
    } finally {
      if (method === METHODS.STATUS_GET) this.statusBusy = false;
    }
  }
}
