import fs from 'node:fs';
import path from 'node:path';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

export class Logger {
  constructor({ dir, level = 'info', echo = false, ringSize = 500, maxBytes = 8 * 1024 * 1024 } = {}) {
    this.dir = dir;
    this.level = LEVELS[level] ? level : 'info';
    this.echo = echo;
    this.ringSize = ringSize;
    this.maxBytes = maxBytes;
    this.ring = [];
    this.file = dir ? path.join(dir, 'kernel.log') : null;
    this.size = 0;
    if (this.file) {
      fs.mkdirSync(dir, { recursive: true });
      try { this.size = fs.statSync(this.file).size; } catch { this.size = 0; }
    }
  }

  rotate() {
    try {
      // Copy + truncate keeps the shell's append handle valid (it holds kernel.log open).
      fs.copyFileSync(this.file, this.file + '.1');
      fs.truncateSync(this.file, 0);
    } catch { /* rotation must never break logging */ }
    this.size = 0;
  }

  write(level, message, data) {
    if (LEVELS[level] < LEVELS[this.level]) return null;

    const entry = {
      ts: new Date().toISOString(),
      level,
      message: String(message),
      ...(data === undefined ? {} : { data })
    };
    const line = JSON.stringify(entry);

    this.ring.push(entry);
    while (this.ring.length > this.ringSize) this.ring.shift();

    if (this.file) {
      const bytes = Buffer.byteLength(line) + 1;
      if (this.size > 0 && this.size + bytes > this.maxBytes) this.rotate();
      try {
        fs.appendFileSync(this.file, line + '\n', 'utf8');
        this.size += bytes;
      } catch { /* logging must not break the kernel */ }
    }
    if (this.echo) {
      const output = level === 'error' ? process.stderr : process.stderr;
      try { output.write(line + '\n'); } catch { /* ignore */ }
    }

    return entry;
  }

  debug(message, data) { return this.write('debug', message, data); }
  info(message, data) { return this.write('info', message, data); }
  warn(message, data) { return this.write('warn', message, data); }
  error(message, data) { return this.write('error', message, data); }

  tail(limit = 100) {
    return this.ring.slice(-Math.max(1, limit));
  }

  child(scope) {
    return {
      debug: (message, data) => this.debug(`[${scope}] ${message}`, data),
      info: (message, data) => this.info(`[${scope}] ${message}`, data),
      warn: (message, data) => this.warn(`[${scope}] ${message}`, data),
      error: (message, data) => this.error(`[${scope}] ${message}`, data)
    };
  }
}

export function createLogger(options) {
  return new Logger(options);
}
