import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { startupScript } from '../../kernel/host/startup-template.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'ui', 'package.json'));
const { JSDOM } = require('jsdom');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function fixture(t, launchId, { reducedMotion = false } = {}) {
  const reports = [];
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'file:///F:/shop/ZCode/resources/app.asar/out/renderer/index.html',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    beforeParse(window) {
      window.matchMedia = (query) => ({ matches: reducedMotion && query === '(prefers-reduced-motion: reduce)' });
      const values = new Map();
      Object.defineProperty(window, 'sessionStorage', {
        configurable: true,
        value: {
          getItem: (key) => values.has(key) ? values.get(key) : null,
          setItem: (key, value) => values.set(key, String(value)),
          removeItem: (key) => values.delete(key)
        }
      });
      window.__backdropBuddyStartupReport = (payload) => reports.push(JSON.parse(payload));
    }
  });
  t.after(() => dom.window.close());
  const result = dom.window.eval(startupScript({ launchId, themeName: '生命周期', holdMs: 3000 }));
  assert.equal(result.installed, true);
  const installed = reports.find((item) => item.stage === 'installed');
  assert.ok(installed);
  return { dom, reports, installed };
}

async function waitFor(check, timeoutMs = 4500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = check();
    if (value) return value;
    await delay(20);
  }
  throw new Error('timed out waiting for startup lifecycle');
}

test('startup lifecycle (JSDOM): skip guard and hard deadline both hand off and clean up', { timeout: 10000 }, async (t) => {
  const skipped = fixture(t, '12345678-abcd-4ef0-aaaa-1234567890ab');
  await delay(100);
  skipped.dom.window.dispatchEvent(new skipped.dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  assert.equal(skipped.dom.window.__backdropBuddyStartupLayer.status().finished, false);
  await waitFor(() => skipped.dom.window.performance.now() - skipped.installed.at >= 920);
  skipped.dom.window.dispatchEvent(new skipped.dom.window.KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
  const skipRemoved = await waitFor(() => skipped.reports.find((item) => item.stage === 'removed'), 2000);
  assert.equal(skipRemoved.reason, 'skipped');
  assert.ok(skipRemoved.at - skipped.installed.at >= 900);
  assert.ok(skipRemoved.at - skipped.installed.at < 1800);
  assert.equal(skipped.dom.window.document.querySelector('#backdropbuddy-startup-layer'), null);
  assert.equal(skipped.dom.window.document.querySelector('#backdropbuddy-startup-style'), null);

  const timeout = fixture(t, 'abcdef12-3456-4abc-aaaa-1234567890ab');
  const removed = await waitFor(() => timeout.reports.find((item) => item.stage === 'removed'), 4500);
  const finishing = timeout.reports.find((item) => item.stage === 'finishing');
  assert.equal(finishing.reason, 'timeout');
  assert.equal(removed.reason, 'timeout');
  assert.ok(removed.at - timeout.installed.at >= 3300);
  assert.ok(removed.at - timeout.installed.at <= 3600, JSON.stringify({ installed: timeout.installed.at, removed: removed.at }));
  assert.equal(timeout.dom.window.document.querySelector('#backdropbuddy-startup-layer'), null);
  assert.equal(timeout.dom.window.document.querySelector('#backdropbuddy-startup-style'), null);
  assert.equal(timeout.dom.window.document.documentElement.classList.contains('bb-startup-cover'), false);
  assert.equal(timeout.dom.window.__backdropBuddyStartupLayer, undefined);
});

test('startup lifecycle (JSDOM): real button respects the 900 ms guard and skips', { timeout: 5000 }, async (t) => {
  const scene = fixture(t, '90abcdef-3456-4abc-aaaa-1234567890ab');
  const button = scene.dom.window.document.querySelector('.bb-startup-skip');
  assert.equal(button.type, 'button');
  await delay(100);
  button.click();
  assert.equal(scene.dom.window.__backdropBuddyStartupLayer.status().finished, false);
  await waitFor(() => scene.dom.window.performance.now() - scene.installed.at >= 920);
  button.click();
  const removed = await waitFor(() => scene.reports.find((item) => item.stage === 'removed'), 2000);
  assert.equal(removed.reason, 'skipped');
  assert.ok(removed.at - scene.installed.at >= 900);
  assert.ok(removed.at - scene.installed.at < 1800);
  assert.equal(scene.dom.window.document.querySelector('#backdropbuddy-startup-layer'), null);
  assert.equal(scene.dom.window.document.querySelector('#backdropbuddy-startup-style'), null);
});

test('startup lifecycle (JSDOM): reduced-motion CSS also disables pseudo-element animations', (t) => {
  const scene = fixture(t, 'reduced-pseudo-element-regression', { reducedMotion: true });
  assert.equal(scene.installed.reducedMotion, true);
  const layer = scene.dom.window.document.querySelector('#backdropbuddy-startup-layer');
  assert.equal(layer.classList.contains('reduced'), true);
  const rules = Array.from(scene.dom.window.document.querySelector('#backdropbuddy-startup-style').sheet.cssRules);
  const reducedRule = rules.find((rule) => rule.selectorText?.startsWith('.bb-startup.reduced *'));
  assert.ok(reducedRule);
  const selectors = reducedRule.selectorText.split(',').map((selector) => selector.trim());
  assert.ok(selectors.includes('.bb-startup.reduced *::after'));
  assert.equal(reducedRule.style.getPropertyValue('animation'), 'none');
  assert.equal(reducedRule.style.getPropertyPriority('animation'), 'important');
});
