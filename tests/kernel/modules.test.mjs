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

test('kernel: module count is 104', () => {
  // 2026-10-27 早期启动模板、独立注入器与受控预览接口（+3）；2026-11-07 WorkBuddy 原生皮肤契约映射（+1）
  // 与皮肤契约收割/重映射（+1）；2026-11-08 Wallpaper Engine 导入：发现/扫描、协议 schema、handler（+3）。
  assert.equal(countModules(path.join(ROOT, 'kernel')), 104);
});
