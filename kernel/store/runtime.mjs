import fs from 'node:fs';
import { readJson, writeJsonAtomic } from './json-file.mjs';

const SCHEMA = 'backdropbuddy.runtime/1';

function isValidState(value) {
  if (!value || typeof value !== 'object') return false;
  if (!value.theme || typeof value.theme !== 'object') return false;
  if (typeof value.theme.id !== 'string' || !value.theme.id) return false;
  return true;
}

export class RuntimeStore {
  constructor(file) {
    this.file = file;
  }

  read() {
    const value = readJson(this.file, null);
    if (!value || typeof value !== 'object' || value.schema !== SCHEMA) return null;
    if (!isValidState(value.state)) return null;
    return value.state;
  }

  write(state) {
    if (!isValidState(state)) return false;
    writeJsonAtomic(this.file, {
      schema: SCHEMA,
      savedAt: new Date().toISOString(),
      state
    });
    return true;
  }

  clear() {
    try { fs.rmSync(this.file, { force: true }); } catch { /* a missing runtime file is already the target state */ }
  }
}
