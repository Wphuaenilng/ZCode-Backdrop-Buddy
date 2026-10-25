import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateProfile, saveUserProfile, loadUserProfiles, PROFILE_SCHEMA } from '../../kernel/host/user-profiles.mjs';
import { createGenericProfile, cssSelectorsFor } from '../../kernel/host/generic.mjs';
import { createRegistry } from '../../kernel/host/registry.mjs';

const GOOD = {
  id: 'my-host',
  name: 'My Host',
  exe: 'C:\\Apps\\MyApp\\MyApp.exe',
  port: 9444,
  rendererPattern: '^app://my-app/',
  readySelector: '.app',
  rootSelector: '.app',
  darkClass: 'theme-dark',
  darkTarget: 'body',
  backgroundVar: '--bg',
  foregroundVar: '--fg',
  surfaceSelectors: ['.app', '.workspace'],
  glassSelectors: ['.status'],
  varMap: { '--bg': 'panel', '--fg': 'foreground' }
};

test('host profile: 校验通过并补齐默认值', () => {
  const result = validateProfile(GOOD);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.profile.schema, PROFILE_SCHEMA);
  assert.equal(result.profile.tokenTarget, 'body');
  assert.equal(result.profile.themedTarget, 'body');
  assert.deepEqual(result.profile.surfaceSelectors, ['.app', '.workspace']);
});

test('host profile: 拒绝越界输入', () => {
  const cases = [
    [{ ...GOOD, id: 'Bad Id' }, /id/],
    [{ ...GOOD, port: 80 }, /port/],
    [{ ...GOOD, exe: 'relative.exe' }, /exe/],
    [{ ...GOOD, rendererPattern: '(' }, /rendererPattern/],
    [{ ...GOOD, surfaceSelectors: [] }, /surfaceSelectors/],
    [{ ...GOOD, surfaceSelectors: ['.a{background:red}'] }, /surfaceSelectors/],
    [{ ...GOOD, backgroundVar: 'background' }, /backgroundVar/],
    [{ ...GOOD, varMap: { '--bg': '__proto__' } }, /varMap/]
  ];
  for (const [input, pattern] of cases) {
    const result = validateProfile(input);
    assert.equal(result.ok, false);
    assert.match(result.errors.join('；'), pattern);
  }
});

test('host profile: 保存与读取往返', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-hosts-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const saved = saveUserProfile(dir, GOOD);
  assert.equal(saved.ok, true, JSON.stringify(saved.errors));
  assert.equal(path.basename(saved.path), 'my-host.json');

  const loaded = loadUserProfiles(dir);
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].id, 'my-host');
  assert.equal(loaded[0].port, 9444);

  // 坏文件不应该拖垮整批
  fs.writeFileSync(path.join(dir, 'broken.json'), '{ not json', 'utf8');
  assert.equal(loadUserProfiles(dir).length, 1);
});

test('generic profile: 选择器白名单与 CSS 映射', () => {
  const { profile } = validateProfile(GOOD);
  const list = cssSelectorsFor(profile);
  assert.ok(list.includes('body.theme-dark'));
  assert.ok(list.includes('body.theme-dark .status'), '暗色下的玻璃条也要在白名单里');
  assert.ok(list.includes('.app'));
  assert.ok(list.includes('html'));

  const generic = createGenericProfile(profile);
  const tokens = {
    panel: 'rgba(255,255,255,0.30)',
    sidebar: 'rgba(250,250,250,0.22)',
    header: 'rgba(255,255,255,0.16)',
    border: 'rgba(0,0,0,0.10)',
    foreground: '#16202b',
    foregroundSubtle: '#5d626b',
    foregroundSubtlest: '#8a8f98',
    accentSoft: 'rgba(46,127,203,0.20)',
    surfaceHover: 'rgba(0,0,0,0.05)',
    selected: 'rgba(0,0,0,0.08)',
    input: 'rgba(255,255,255,0.5)',
    card: 'rgba(255,255,255,0.45)',
    popover: 'rgba(255,255,255,0.9)',
    dim: 'transparent',
    contrast: '#ffffff',
    scrim: 'rgba(0,0,0,0.2)'
  };
  const css = generic.buildThemeCss({ params: {}, media: null, tokens, tokensByMode: { light: tokens, dark: tokens }, mode: 'light' });
  assert.match(css, /--bg: rgba\(255,255,255,0\.30\) !important;/);
  assert.match(css, /--fg: #16202b !important;/);
  assert.match(css, /\.app,\n\.workspace \{\n  background: transparent !important;/);
  assert.match(css, /body\.theme-dark \{/);
  assert.match(css, /#backdropbuddy-backdrop/);
  assert.equal(generic.verifyExpression().includes('--bg'), true);
  assert.equal(generic.port, 9444);
});

test('registry: 用户宿主会合并进列表并能解析', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-registry-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(saveUserProfile(dir, GOOD).ok, true);

  const registry = createRegistry({ hostsDir: dir });
  const ids = registry.list().map((host) => host.id);
  assert.ok(ids.includes('zcode'));
  assert.ok(ids.includes('obsidian'));
  assert.ok(ids.includes('my-host'));

  const resolved = registry.resolve({ BACKDROPBUDDY_HOST: 'my-host' });
  assert.equal(resolved.id, 'my-host');
  assert.equal(resolved.name, 'My Host');
  assert.equal(resolved.port, 9444);
  assert.equal(typeof resolved.buildThemeCss, 'function');

  assert.throws(() => registry.resolve({ BACKDROPBUDDY_HOST: 'nope' }), /unknown host/);

  // 默认仍然落到 ZCode
  assert.equal(registry.resolve({}).id, 'zcode');
  // 配置里的 hostId 作为兜底
  assert.equal(registry.resolve({}, 'my-host').id, 'my-host');
});
