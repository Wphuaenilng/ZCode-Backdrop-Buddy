import fs from 'node:fs';
import path from 'node:path';
import { BUILTIN_CATALOG } from './catalog.mjs';
import { createRecord } from './record.mjs';
import { themeFile, writeTheme } from './writer.mjs';

export function seedBuiltins({ paths, logger }) {
  fs.mkdirSync(paths.builtin, { recursive: true });
  let created = 0;

  for (const item of BUILTIN_CATALOG) {
    const dir = path.join(paths.builtin, item.id);
    if (fs.existsSync(themeFile(dir))) continue;

    const now = Date.now();
    writeTheme(dir, createRecord({
      id: item.id,
      name: item.name,
      tags: item.tags,
      params: { accent: item.accent },
      media: null,
      source: 'builtin',
      createdAt: now,
      updatedAt: now
    }));
    created += 1;
  }

  if (created) logger?.info('seeded builtin themes', { created, total: BUILTIN_CATALOG.length });
  return created;
}
