import { selectorHelpers } from './selector.mjs';

export const MAX_VARS = 160;
export const MAX_SURFACES = 24;

// 只读检查：抓页面指纹、CSS 变量清单、带背景的候选面板、明暗类名候选。
export function inspectExpression() {
  return `(() => {
    ${selectorHelpers()}
    const vars = [];
    const seen = new Set();
    for (const pair of [['html', document.documentElement], ['body', document.body]]) {
      const targetName = pair[0];
      const target = pair[1];
      if (!target) continue;
      const cs = getComputedStyle(target);
      for (const name of cs) {
        if (vars.length >= ${MAX_VARS}) break;
        if (!name.startsWith('--')) continue;
        const id = targetName + ':' + name;
        if (seen.has(id)) continue;
        const value = cs.getPropertyValue(name).trim();
        if (!value || value.length > 80) continue;
        seen.add(id);
        vars.push({ name, value, target: targetName });
      }
    }

    const surfaces = [];
    const candidates = document.querySelectorAll('div,section,aside,main,header,footer,nav,article');
    for (const el of candidates) {
      if (surfaces.length >= 80) break;
      const cs = getComputedStyle(el);
      const bg = cs.backgroundColor;
      if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') continue;
      const rect = el.getBoundingClientRect();
      const area = Math.round(rect.width * rect.height);
      if (area < 2000) continue;
      const info = __bbDescribe(el);
      if (!info || !info.selector) continue;
      surfaces.push({ selector: info.selector, tag: info.tag, background: bg, area });
    }
    surfaces.sort((a, b) => b.area - a.area);

    const htmlClasses = Array.from(document.documentElement.classList);
    const bodyClasses = document.body ? Array.from(document.body.classList) : [];
    const darkCandidates = [];
    for (const cls of htmlClasses) if (/dark|light|theme/i.test(cls)) darkCandidates.push({ target: 'html', cls });
    for (const cls of bodyClasses) if (/dark|light|theme/i.test(cls)) darkCandidates.push({ target: 'body', cls });

    const readyCandidates = [];
    for (const sel of ['#root', '#app', '.app-container', '.App', 'main', '[role="application"]', 'body > div']) {
      try {
        const el = document.querySelector(sel);
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        readyCandidates.push({ selector: sel, area: Math.round(rect.width * rect.height) });
      } catch (e) { /* ignore bad selector */ }
    }

    return {
      url: location.href,
      title: document.title,
      version: (document.title.match(/([0-9]+\\.[0-9]+\\.[0-9]+)/) || [])[1] || null,
      darkCandidates,
      readyCandidates,
      vars: vars.slice(0, ${MAX_VARS}),
      surfaces: surfaces.slice(0, ${MAX_SURFACES})
    };
  })()`;
}
