import { PROTOCOL_VERSION } from '../../shared/protocol/constants.mjs';

export function response(id, data) {
  return { v: PROTOCOL_VERSION, id, type: 'response', ok: true, data: data ?? null };
}

export function failure(id, error) {
  return {
    v: PROTOCOL_VERSION,
    id: id ?? null,
    type: 'response',
    ok: false,
    error: {
      code: error?.code || 'INTERNAL',
      message: error?.message || 'internal error',
      retryable: !!error?.retryable,
      ...(error?.details ? { details: error.details } : {})
    }
  };
}

export function event(name, data) {
  return { v: PROTOCOL_VERSION, type: 'event', event: name, data: data ?? null };
}

export function isRequest(message) {
  return !!message && typeof message === 'object' && message.type === 'request';
}
