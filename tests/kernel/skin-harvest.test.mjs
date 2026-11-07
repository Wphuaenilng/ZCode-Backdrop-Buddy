import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { remapSkinValue, buildSkinContract, parseSkinVariables, skinContractCachePath, readSkinContractCache, writeSkinContractCache } from '../../kernel/host/skin-harvest.mjs';

// accent #2E7FCB 的色相约 208°（蓝）；重映射应把其他彩色的色相拉到 208°，保持明度/透明度
const ACCENT = '#2E7FCB';

test('skin-harvest: 彩色字面量重定到 accent 色相，明度与透明度保持', () => {
  const remapped = remapSkinValue('linear-gradient(90deg, #ff8a00, rgba(156, 39, 176, 0.40))', ACCENT);
  // 橙色（h≈32）与紫色（h≈291）都不在语义窗口里 → 色相改为 accent 的 ~208°
  assert.ok(!remapped.includes('#ff8a00'), 'orange literal should be re-hued');
  assert.ok(!remapped.includes('156, 39, 176'), 'purple literal should be re-hued');
  assert.ok(/0\.4\)/.test(remapped), 'alpha preserved');
  assert.match(remapped, /linear-gradient\(90deg, #[0-9a-f]{6}, rgba?\([0-9, .]+\)\)/);
});

test('skin-harvest: 语义色与中性色保持原样', () => {
  const css = 'box-shadow: rgba(0, 0, 0, 0.05) 0 2px 4px; color: #FF5A52; border: #E6C029; accent: #22c55e;';
  assert.equal(remapSkinValue(css, ACCENT), css, 'shadow black / error red / warning amber / success green stay');
});

test('skin-harvest: 8 位 hex 的 alpha 通道保留', () => {
  const remapped = remapSkinValue('#7c4dff08', ACCENT);
  assert.match(remapped, /^#[0-9a-f]{6}08$/);
  assert.notEqual(remapped, '#7c4dff08');
});

test('skin-harvest: accent 缺失或非法时原样返回', () => {
  const value = 'rgb(79, 134, 255)';
  assert.equal(remapSkinValue(value, ''), value);
  assert.equal(remapSkinValue(value, 'nope'), value);
});

test('skin-harvest: buildSkinContract 去空并按作用域分组', () => {
  const contract = buildSkinContract({
    light: { '--wb-sidebar-bg': ' #f5f5f5 ', '--cb-empty': '', '--cr-bg-primary': 'rgb(79, 134, 255)' },
    dark: {}
  }, ACCENT);
  assert.deepEqual(Object.keys(contract), ['light']);
  assert.equal(contract.light['--wb-sidebar-bg'], '#f5f5f5');
  assert.equal(contract.light['--cr-bg-primary'], remapSkinValue('rgb(79, 134, 255)', ACCENT));
  assert.ok(!('--cb-empty' in contract.light));
});

test('skin-harvest: 文本解析按选择器父链分桶，后声明覆盖', () => {
  const parsed = parseSkinVariables([
    '.foo { --wb-sidebar-bg: #111; --cb-bg-primary: #fff; }',
    '.vscode-dark .foo { --wb-sidebar-bg: #222; }',
    '@media (prefers-color-scheme: dark) { .foo { --cr-bg-primary: #333; } }'
  ]);
  assert.equal(parsed.light['--wb-sidebar-bg'], '#111');
  assert.equal(parsed.dark['--wb-sidebar-bg'], '#222');
  assert.equal(parsed.light['--cb-bg-primary'], '#fff');
  assert.equal(parsed.dark['--cr-bg-primary'], '#333');
});

test('skin-harvest: 嵌套块与非族变量跳过', () => {
  const parsed = parseSkinVariables([
    '@layer base { .x { --bb-mine: 1; --wb-ok: #abc; } }',
    '.y { color: red; --other: 2; }'
  ]);
  assert.equal(parsed.light['--wb-ok'], '#abc');
  assert.ok(!parsed.light['--bb-mine'], 'backdropbuddy own vars excluded');
  assert.ok(!parsed.light['--other'], 'non-skin families excluded');
});

function hueOf(hex) {
  const value = hex.replace('#', '');
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return h * 360;
}

test('skin-harvest: changedOnly 只保留重映射改写过的变量', () => {
  const harvest = {
    light: {
      '--cb-neutral': 'rgba(18, 18, 20, 0.46)',
      '--cb-accent-link': 'rgb(79, 134, 255)'
    }
  };
  const all = buildSkinContract(harvest, '#2E7FCB');
  assert.ok(all.light['--cb-neutral'], 'default keeps everything');
  const filtered = buildSkinContract(harvest, '#2E7FCB', { changedOnly: true });
  assert.ok(!filtered.light['--cb-neutral'], 'unchanged neutral dropped');
  assert.ok(filtered.light['--cb-accent-link'], 'remapped chromatic kept');
});

test('skin-harvest: 契约缓存按版本键存原始解析结果，往返读写', () => {
  const paths = { cache: fs.mkdtempSync(path.join(os.tmpdir(), 'bb-cache-')) };
  const file = skinContractCachePath(paths, 'workbuddy', '5.9.3');
  assert.ok(file.includes('skin-contract') && file.includes('workbuddy-5.9.3'));
  assert.equal(readSkinContractCache(file), null, 'missing cache reads null');
  const parsed = { light: { '--cb-a': '#123456' }, dark: {} };
  writeSkinContractCache(file, parsed);
  const hit = readSkinContractCache(file);
  assert.deepEqual(hit.parsed.light['--cb-a'], '#123456');
  assert.ok(hit.savedAt);
  // accent 无关：同一个缓存条目重映射出不同 accent 的契约
  const forBlue = buildSkinContract(hit.parsed, '#2E7FCB', { changedOnly: true });
  const forGold = buildSkinContract(hit.parsed, '#B8A67D', { changedOnly: true });
  assert.ok(forBlue.light['--cb-a'] !== forGold.light['--cb-a'], 'same parsed, different accents differ');
  // 空解析不落盘：不会把半途失败的结果当缓存盖回去
  const emptyFile = skinContractCachePath(paths, 'workbuddy', '5.9.4');
  writeSkinContractCache(emptyFile, { light: {}, dark: {} });
  assert.equal(readSkinContractCache(emptyFile), null, 'empty parsed is not cached');
  fs.rmSync(paths.cache, { recursive: true, force: true });
});

test('skin-harvest: 解析时剥离声明自带的 !important（避免双重 important 非法）', () => {
  const parsed = parseSkinVariables([
    ':root { --cb-bg-primary: #f7fcff !important; --cr-bg-elevated: rgba(255,255,255,0.16) !IMPORTANT; }'
  ]);
  assert.equal(parsed.light['--cb-bg-primary'], '#f7fcff');
  assert.equal(parsed.light['--cr-bg-elevated'], 'rgba(255,255,255,0.16)');
});
