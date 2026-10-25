export class LineWriter {
  constructor({ stream = process.stdout, highWater = 256 * 1024, onBackpressure = null } = {}) {
    this.stream = stream;
    this.highWater = highWater;
    this.onBackpressure = onBackpressure;
    this.queue = [];
    this.pendingBytes = 0;
    this.writing = false;
    this.pressured = false;
    this.waiters = [];
  }

  writeLine(line) {
    const payload = String(line) + '\n';
    this.queue.push(payload);
    this.pendingBytes += Buffer.byteLength(payload);

    if (!this.pressured && this.pendingBytes > this.highWater) {
      this.pressured = true;
      try { this.onBackpressure?.(true); } catch { /* ignore */ }
    }

    this.flush();
    return this;
  }

  flush() {
    if (this.writing) return;

    const payload = this.queue.shift();
    if (payload === undefined) {
      this.maybeIdle();
      return;
    }

    this.writing = true;
    try {
      this.stream.write(payload, () => {
        this.pendingBytes = Math.max(0, this.pendingBytes - Buffer.byteLength(payload));
        this.writing = false;
        this.flush();
      });
    } catch {
      this.pendingBytes = Math.max(0, this.pendingBytes - Buffer.byteLength(payload));
      this.writing = false;
      this.flush();
    }
  }

  reset() {
    this.queue.length = 0;
    this.pendingBytes = 0;
    this.writing = false;
    this.maybeIdle();
  }

  maybeIdle() {
    if (this.writing || this.queue.length) return;

    if (this.pressured) {
      this.pressured = false;
      try { this.onBackpressure?.(false); } catch { /* ignore */ }
    }

    const waiters = this.waiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  drain() {
    if (!this.writing && !this.queue.length) return Promise.resolve();
    return new Promise((resolve) => this.waiters.push(resolve));
  }
}
