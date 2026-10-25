import fs from 'node:fs';
import path from 'node:path';
import { readTheme } from './writer.mjs';

export function listThemeDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name))
    .sort();
}

export function loadThemes(root, source, logger) {
  const themes = [];

  for (const dir of listThemeDirs(root)) {
    const record = readTheme(dir, source);
    if (record) themes.push(record);
    else logger?.warn('skipping invalid theme directory', { dir });
  }

  return themes;
}

export function loadTheme(root, id, source, logger) {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) return null;
  const dir = path.join(root, id);
  if (!fs.existsSync(dir)) return null;
  const record = readTheme(dir, source);
  if (!record) logger?.warn('invalid theme record', { dir });
  return record;
}
