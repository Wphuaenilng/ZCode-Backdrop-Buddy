import fs from 'node:fs';
import { writeFileAtomic } from './atomic.mjs';

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJsonAtomic(file, value) {
  return writeFileAtomic(file, JSON.stringify(value, null, 2) + '\n');
}

export function exists(file) {
  return fs.existsSync(file);
}
