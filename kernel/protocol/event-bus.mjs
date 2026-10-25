import { event as makeEvent } from './envelope.mjs';

export class EventBus {
  constructor() {
    this.listeners = new Map();
    this.anyListeners = new Set();
  }

  on(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
    return () => this.off(name, handler);
  }

  off(name, handler) {
    const set = this.listeners.get(name);
    if (!set) return;
    set.delete(handler);
    if (!set.size) this.listeners.delete(name);
  }

  onAny(handler) {
    this.anyListeners.add(handler);
    return () => this.anyListeners.delete(handler);
  }

  emit(name, data) {
    const envelope = makeEvent(name, data);

    for (const handler of this.listeners.get(name) || []) {
      try { handler(data, envelope); } catch { /* listener errors must not break events */ }
    }
    for (const handler of this.anyListeners) {
      try { handler(envelope, name, data); } catch { /* same */ }
    }

    return envelope;
  }
}
