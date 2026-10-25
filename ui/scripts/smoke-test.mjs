// UI 挂载冒烟测试（构建门禁）：把 dist/index.html 的内联脚本在 jsdom 里跑起来，
// #root 必须被 React 填充且无挂载期异常。防的是 vite 构建 + 内核测试都拦不住的
// 运行时崩溃（TDZ、渲染抛错、坏导入）——产物级验证，测的就是要发布的那份文件。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const distFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.html');
const html = fs.readFileSync(distFile, 'utf8');
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)]
  .map((match) => match[1])
  .join('\n;\n');

if (!scripts.trim()) {
  console.error('smoke: dist/index.html 里没有内联脚本');
  process.exit(1);
}

// 不带 CSP meta 的干净文档执行提取出的脚本：jsdom 不保证执行 CSP 语义，
// 这里要验证的是脚本自身的挂载行为，与分发文件的 CSP 注入无关（后者有专门校验）。
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  url: 'https://manager.backdropbuddy.invalid/',
  runScripts: 'dangerously',
  pretendToBeVisual: true
});
const { window } = dom;

// jsdom 没实现的 DOM API 打桩：应用真实运行在 WebView2 里都有
window.Element.prototype.scrollIntoView = function scrollIntoView() {};
window.scrollTo = function scrollTo() {};
window.scrollBy = function scrollBy() {};

const errors = [];
window.addEventListener('error', (event) => errors.push(String(event.message || event.error || 'unknown error')));
window.addEventListener('unhandledrejection', (event) => errors.push('rejection: ' + String((event.reason && event.reason.message) || event.reason)));

const scriptEl = window.document.createElement('script');
scriptEl.textContent = scripts;
window.document.body.appendChild(scriptEl);

await new Promise((resolve) => setTimeout(resolve, 1500));

const root = window.document.getElementById('root');
const filled = !!root && root.innerHTML.length > 100;

if (errors.length) {
  console.error('smoke: UI 挂载期抛错：\n  ' + errors.join('\n  '));
  process.exit(1);
}
if (!filled) {
  console.error('smoke: #root 未被渲染（挂载期崩溃？），root bytes=' + (root ? root.innerHTML.length : -1));
  process.exit(1);
}

console.log('smoke: UI mounted ok, root bytes=' + root.innerHTML.length);
