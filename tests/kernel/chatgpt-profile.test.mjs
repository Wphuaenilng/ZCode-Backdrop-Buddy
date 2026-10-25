import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHATGPT_PROFILE, resolveProfile, buildThemeCss } from '../../kernel/host/chatgpt.mjs';
import { buildGenericThemeCss } from '../../kernel/host/generic.mjs';
import { createRegistry } from '../../kernel/host/registry.mjs';

// color.ps1 输出的 token 形状（两个模式各一份）
const TOKENS = {
  light: {
    panel: 'rgba(255,255,255,0.30)', sidebar: 'rgba(255,255,255,0.40)', header: 'rgba(255,255,255,0.35)',
    card: 'rgba(255,255,255,0.55)', popover: 'rgba(255,255,255,0.98)', input: 'rgba(255,255,255,0.90)',
    surface: 'rgba(255,255,255,0.20)', surfaceHover: 'rgba(255,255,255,0.30)', selected: 'rgba(46,127,203,0.22)',
    accentSoft: 'rgba(46,127,203,0.16)', terminal: 'rgba(255,255,255,1)', scrim: 'rgba(255,255,255,0.35)',
    dim: 'rgba(255,255,255,0.12)', foreground: '#1c1c1e', foregroundSubtle: 'rgba(28,28,30,0.72)',
    foregroundSubtlest: 'rgba(28,28,30,0.68)', border: 'rgba(0,0,0,0.12)', tooltipForeground: '#1c1c1e',
    contrast: '#ffffff'
  },
  dark: {
    panel: 'rgba(18,18,20,0.36)', sidebar: 'rgba(18,18,20,0.52)', header: 'rgba(18,18,20,0.45)',
    card: 'rgba(18,18,20,0.55)', popover: 'rgba(18,18,20,0.97)', input: 'rgba(18,18,20,0.90)',
    surface: 'rgba(18,18,20,0.15)', surfaceHover: 'rgba(18,18,20,0.25)', selected: 'rgba(46,127,203,0.22)',
    accentSoft: 'rgba(46,127,203,0.16)', terminal: 'rgba(18,18,20,1)', scrim: 'rgba(18,18,20,0.38)',
    dim: 'rgba(18,18,20,0.18)', foreground: '#e8e8ea', foregroundSubtle: 'rgba(232,232,234,0.78)',
    foregroundSubtlest: 'rgba(232,232,234,0.70)', border: 'rgba(255,255,255,0.18)', tooltipForeground: '#f0f0f2',
    contrast: '#000000'
  }
};

const CSS_ARGS = { params: { accent: '#2E7FCB' }, media: null, tokens: TOKENS.dark, tokensByMode: TOKENS, mode: 'dark' };

test('chatgpt profile: interface 与解析', () => {
  assert.equal(CHATGPT_PROFILE.id, 'chatgpt');
  assert.equal(CHATGPT_PROFILE.mediaDelivery, 'blob', 'CSP 只放行 blob:，媒体必须走 blob 交付');
  assert.equal(CHATGPT_PROFILE.hashHostFiles, false, 'MSIX 目录不可哈希');
  assert.ok(CHATGPT_PROFILE.appxPackage, 'exe 走 Appx 解析，不能依赖写死路径');
  assert.match(CHATGPT_PROFILE.cssSelectors.join('|'), /html\[data-theme="dark"\]/);

  const resolved = resolveProfile({ CHATGPT_PORT: '9999' });
  assert.equal(resolved.port, 9999);
  assert.equal(resolveProfile({}).port, 9232);
  assert.match(resolveProfile({ CHATGPT_PATH: 'C:\\x\\ChatGPT.exe' }).exe, /ChatGPT\.exe$/);
});

test('chatgpt profile: 专用映射命中关键 token（输入框 opaque 根因 / surface 层 / 文字 / 边框）', () => {
  const css = buildThemeCss(CSS_ARGS);
  // 输入框不透明的根因是 app 级 opaque 变量族，通用 varMap 覆盖不到
  assert.match(css, /--app-color-background-elevated-primary-opaque: rgba\(18,18,20,0\.55\)/);
  assert.match(css, /--app-color-background-elevated-secondary-opaque: rgba\(18,18,20,0\.97\)/);
  assert.match(css, /--app-color-background-surface: rgba\(18,18,20,0\.36\)/);
  // surface 语义层 + 侧栏 + tooltip
  assert.match(css, /--color-surface-elevated: rgba\(18,18,20,0\.55\)/);
  assert.match(css, /--color-background-page-search: rgba\(18,18,20,0\.52\)/);
  assert.match(css, /--color-background-tooltip-classic: rgba\(18,18,20,0\.97\)/);
  // 文字与边框
  assert.match(css, /--color-text-primary: #e8e8ea/);
  assert.match(css, /--color-text-tertiary: rgba\(232,232,234,0\.70\)/);
  assert.match(css, /--color-border-strong: rgba\(255,255,255,0\.18\)/);
  // 深浅两套：暗色挂 data-theme，浅色挂 :root（默认）
  assert.match(css, /html\[data-theme="dark"\]\s*\{/);
  assert.match(css, /:root\s*\{/);
  // 可读性护栏：#root 提到内容层之上并带文字投影
  assert.match(css, /#root\s*\{\s*position: relative; z-index: 1; text-shadow: var\(--bb-text-shadow\);/);
  assert.match(css, /--bb-safe:/, '侧栏护栏 scrim');
});

test('chatgpt profile: 视频主题时遮罩层必须全透明（视频在层之下）', () => {
  const css = buildThemeCss({ ...CSS_ARGS, media: { kind: 'video', url: 'blob:video' } });
  const layerRule = css.match(/#backdropbuddy-backdrop\s*\{[^}]*\}/)[0];
  assert.ok(layerRule, '遮罩层规则存在');
  assert.equal(/background(-color)?:\s*(#000|rgb)/.test(layerRule), false,
    '视频主题下遮罩层不能有任何底色——层在视频之后、同 z-index，会整面盖住视频');
  assert.match(css, /#backdropbuddy-video\s*\{/);

  // 通用引擎同样不能带底色（回归保护）
  const genericCss = buildGenericThemeCss(
    { varMap: { '--bg': 'panel' }, darkAttr: 'data-theme', darkAttrValue: 'dark', rootSelector: '#root' },
    { ...CSS_ARGS, media: { kind: 'video', url: 'blob:video' } }
  );
  const genericLayer = genericCss.match(/#backdropbuddy-backdrop\s*\{[^}]*\}/)[0];
  assert.equal(/background(-color)?:\s*(#000|rgb)/.test(genericLayer), false);
});

test('registry: 同 id 的用户 profile 让位给内置专用映射', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-reg-'));
  // 模拟旧向导保存的 chatgpt.json + 一个自定义宿主
  fs.writeFileSync(path.join(dir, 'chatgpt.json'), JSON.stringify({
    schema: 'backdropbuddy.hostprofile/1',
    id: 'chatgpt', name: 'ChatGPT', exe: 'C:\\old\\ChatGPT.exe', port: 9232,
    rendererPattern: '^app://-/index\\.html', readySelector: '#root', rootSelector: '#root',
    darkAttr: 'data-theme', darkAttrValue: 'dark', darkTarget: 'html', tokenTarget: 'html', themedTarget: 'body',
    backgroundVar: '--color-surface', foregroundVar: '--color-text-primary',
    surfaceSelectors: ['#app-shell-sidebar'], glassSelectors: [], textSelectors: [], skipSelector: null,
    varMap: { '--color-surface': 'panel' }, mediaDelivery: 'blob'
  }), 'utf8');
  fs.writeFileSync(path.join(dir, 'other.json'), JSON.stringify({
    schema: 'backdropbuddy.hostprofile/1',
    id: 'other', name: 'Other', exe: 'C:\\other.exe', port: 9334,
    rendererPattern: '^app://other', readySelector: 'body', rootSelector: 'body',
    backgroundVar: '', foregroundVar: '', surfaceSelectors: ['.app-root'], glassSelectors: [], textSelectors: [],
    skipSelector: null, varMap: {}, mediaDelivery: 'file'
  }), 'utf8');

  const registry = createRegistry({ hostsDir: dir });
  const ids = registry.list().map((host) => host.id);
  assert.deepEqual(ids, ['zcode', 'chatgpt', 'other'], '内置 chatgpt 顶掉同 id 用户 profile，不出现两个芯片');
  assert.equal(registry.list().find((host) => host.id === 'chatgpt').source, 'builtin');
  // 解析出的必须是专用映射（能认出 opaque 变量覆盖），不是旧数据 profile
  const resolved = registry.resolve({ BACKDROPBUDDY_HOST: 'chatgpt' });
  assert.equal(resolved.appxPackage, 'OpenAI.Codex');
  assert.match(resolved.cssSelectors.join('|'), /data-theme/);

  fs.rmSync(dir, { recursive: true, force: true });
});
