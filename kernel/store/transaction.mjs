import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../protocol/errors.mjs';
import { moveDirAtomic, removeDir } from './atomic.mjs';
import { readJson } from './json-file.mjs';
import { themeFile } from './writer.mjs';

function txId() {
  return `tx-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class ThemeTransaction {
  constructor({ dir, logger }) {
    this.dir = dir;
    this.logger = logger;
    this.committed = false;
    this.aborted = false;
  }

  static begin({ stagingRoot, logger }) {
    const dir = path.join(stagingRoot, txId());
    fs.mkdirSync(dir, { recursive: true });
    logger?.debug('transaction begin', { dir });
    return new ThemeTransaction({ dir, logger });
  }

  commit(destination) {
    if (this.committed || this.aborted) throw new AppError('TRANSACTION_FAILED', 'transaction is already closed');

    const record = readJson(themeFile(this.dir), null);
    if (!record || !record.id) {
      throw new AppError('TRANSACTION_FAILED', 'staged theme.json is missing or invalid');
    }
    if (record.media?.file) {
      const mediaPath = path.join(this.dir, record.media.file);
      if (!fs.existsSync(mediaPath)) {
        throw new AppError('TRANSACTION_FAILED', 'staged media file is missing', { details: { file: record.media.file } });
      }
    }

    try {
      moveDirAtomic(this.dir, destination);
      this.committed = true;
      this.logger?.info('transaction committed', { destination, themeId: record.id });
      return record;
    } catch (error) {
      this.logger?.error('transaction commit failed', { destination, message: error.message });
      throw new AppError('TRANSACTION_FAILED', 'could not commit staged theme', { details: { cause: error.message } });
    }
  }

  abort() {
    if (this.committed || this.aborted) return;
    this.aborted = true;
    try { removeDir(this.dir); } catch { /* best effort */ }
    this.logger?.debug('transaction aborted', { dir: this.dir });
  }
}

export function cleanupStaging(stagingRoot, maxAgeMs = 60 * 60 * 1000, logger) {
  if (!fs.existsSync(stagingRoot)) return 0;
  let removed = 0;
  const now = Date.now();

  for (const entry of fs.readdirSync(stagingRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(stagingRoot, entry.name);
    try {
      if (now - fs.statSync(dir).mtimeMs > maxAgeMs) {
        removeDir(dir);
        removed += 1;
      }
    } catch { /* ignore */ }
  }

  if (removed) logger?.info('cleaned stale staging directories', { removed });
  return removed;
}
