import { DEDUPE_WINDOW } from '../../shared/protocol/constants.mjs';

export class RequestIdCache {
  constructor(limit = DEDUPE_WINDOW) {
    this.limit = limit;
    this.values = new Map();
    this.order = [];
  }

  // The UI restarts its sequence on every page load, so ids are only unique per method.
  static keyFor(method, id) {
    return `${method}\u0000${id}`;
  }

  has(key) {
    return this.values.has(key);
  }

  get(key) {
    return this.values.get(key);
  }

  remember(key, response) {
    // A retryable failure must stay retryable: caching it would replay the failure for the same id.
    if (response && response.ok === false && response.error && response.error.retryable) return response;

    if (this.values.has(key)) {
      this.values.set(key, response);
      return response;
    }

    this.values.set(key, response);
    this.order.push(key);

    while (this.order.length > this.limit) {
      this.values.delete(this.order.shift());
    }

    return response;
  }

  get size() {
    return this.values.size;
  }
}
