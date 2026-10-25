import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function countModules(dir) {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) count += countModules(full);
    else if (entry.name.endsWith('.mjs')) count += 1;
  }
  return count;
}

test('kernel: module count is 91', () => {
  assert.equal(countModules(path.join(ROOT, 'kernel')), 91);
});
