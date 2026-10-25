import path from 'node:path';
import { ensureDir } from './atomic.mjs';
import { readJson, writeJsonAtomic } from './json-file.mjs';
import { normalizeRecord } from './record.mjs';

export function themeFile(dir) {
  return path.join(dir, 'theme.json');
}

export function writeTheme(dir, record) {
  ensureDir(dir);
  writeJsonAtomic(themeFile(dir), record);
  return record;
}

export function readTheme(dir, source = 'user') {
  return normalizeRecord(readJson(themeFile(dir), null), { source });
}
