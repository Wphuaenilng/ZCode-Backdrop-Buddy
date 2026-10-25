import fs from 'node:fs';
import path from 'node:path';

export function ensureCache(cacheDir) {
  fs.mkdirSync(cacheDir, { recursive: true });
  return cacheDir;
}

export function thumbPath(cacheDir, sha256) {
  return path.join(cacheDir, `${sha256}.jpg`);
}

function walkFiles(dir, visit) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(full, visit);
    else visit(full);
  }
}

export function cleanCache(cacheDir, maxAgeMs = 30 * 24 * 60 * 60 * 1000) {
  if (!fs.existsSync(cacheDir)) return 0;
  let removed = 0;
  const now = Date.now();

  try {
    walkFiles(cacheDir, (file) => {
      try {
        if (now - fs.statSync(file).mtimeMs > maxAgeMs) {
          fs.rmSync(file, { force: true });
          removed += 1;
        }
      } catch { /* ignore */ }
    });
  } catch { /* an unreadable cache is not fatal */ }

  return removed;
}
