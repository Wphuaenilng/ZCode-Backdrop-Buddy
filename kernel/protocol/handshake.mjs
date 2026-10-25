import { METHODS } from '../../shared/protocol/constants.mjs';

export const PRE_HANDSHAKE_METHODS = new Set([METHODS.SYSTEM_HELLO, METHODS.STATUS_GET]);

export class HandshakeState {
  constructor() {
    this.complete = false;
  }

  allows(method) {
    return this.complete || PRE_HANDSHAKE_METHODS.has(method);
  }

  markComplete(method) {
    if (method === METHODS.SYSTEM_HELLO) this.complete = true;
  }
}
