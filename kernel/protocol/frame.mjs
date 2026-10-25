import { MAX_MESSAGE_BYTES } from '../../shared/protocol/constants.mjs';

/**
 * NDJSON framing. The limit applies to a complete line, without the trailing \n.
 * An oversized line is rejected as a whole and the buffer is discarded; no
 * half-frame alignment is attempted.
 */
export class LineFramer {
  constructor(maxBytes = MAX_MESSAGE_BYTES) {
    this.maxBytes = maxBytes;
    this.buffer = Buffer.alloc(0);
    this.discarding = false;
  }

  push(chunk) {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(String(chunk), 'utf8');
    if (!chunk.length) return { lines: [], errors: [] };

    this.buffer = Buffer.concat([this.buffer, chunk]);
    const lines = [];
    const errors = [];
    let newline;

    while ((newline = this.buffer.indexOf(10)) !== -1) {
      const line = this.buffer.subarray(0, newline);
      this.buffer = this.buffer.subarray(newline + 1);

      if (this.discarding) {
        this.discarding = false;
        continue;
      }
      if (line.length > this.maxBytes) {
        errors.push({ code: 'MESSAGE_TOO_LARGE', bytes: line.length });
        continue;
      }
      if (line.length) lines.push(line.toString('utf8'));
    }

    if (this.buffer.length > this.maxBytes) {
      errors.push({ code: 'MESSAGE_TOO_LARGE', bytes: this.buffer.length });
      this.buffer = Buffer.alloc(0);
      this.discarding = true;
    }
    return { lines, errors };
  }
}
