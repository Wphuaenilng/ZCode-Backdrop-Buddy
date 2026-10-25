import { LineFramer } from '../protocol/frame.mjs';

export class LineReader {
  constructor({ onLine, onError, maxBytes } = {}) {
    this.framer = new LineFramer(maxBytes);
    this.onLine = onLine;
    this.onError = onError;
  }

  push(chunk) {
    const { lines, errors } = this.framer.push(chunk);
    for (const error of errors) this.onError?.(error);
    for (const line of lines) this.onLine?.(line);
    return { lines: lines.length, errors: errors.length };
  }
}
