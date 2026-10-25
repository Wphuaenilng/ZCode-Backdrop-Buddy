// 在宿主页面里做「点选」用的脚本：选择器生成 + 元素描述 + 拾取层。
// 全部以字符串形式交给 CDP Runtime.evaluate 注入宿主渲染进程。
export const PICK_KEY = '__bbPick';
export const PICK_OVERLAY_ID = '__bb-pick-layer';

// 被注入到页面里的公共辅助函数（选择器生成、元素描述）。
export function selectorHelpers() {
  return `
    const __bbStable = (v) => /^[A-Za-z][A-Za-z0-9_-]*$/.test(v || '');
    const __bbUnique = (sel) => {
      try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
    };
    const __bbSelectorFor = (el) => {
      if (!el || el.nodeType !== 1) return null;
      if (__bbStable(el.id)) {
        const sel = '#' + el.id;
        if (__bbUnique(sel)) return sel;
      }
      const classes = Array.from(el.classList || []).filter(__bbStable);
      for (const c of classes) {
        const sel = '.' + c;
        if (__bbUnique(sel)) return sel;
      }
      for (let i = 0; i < classes.length; i++) {
        for (let j = i + 1; j < classes.length; j++) {
          const sel = '.' + classes[i] + '.' + classes[j];
          if (__bbUnique(sel)) return sel;
        }
      }
      let node = el;
      const parts = [];
      for (let depth = 0; node && node.nodeType === 1 && depth < 3; depth++) {
        const tag = node.tagName.toLowerCase();
        const cls = Array.from(node.classList || []).filter(__bbStable).slice(0, 2);
        parts.unshift(tag + (cls.length ? '.' + cls.join('.') : ''));
        const sel = parts.join(' > ');
        if (__bbUnique(sel)) return sel;
        node = node.parentElement;
      }
      return parts.length ? parts.join(' > ') : null;
    };
    const __bbDescribe = (el) => {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        selector: __bbSelectorFor(el),
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: Array.from(el.classList || []).slice(0, 8),
        background: cs.backgroundColor,
        color: cs.color,
        area: Math.round(rect.width * rect.height),
        text: (el.textContent || '').trim().slice(0, 40)
      };
    };
  `;
}

export function pickerExpression() {
  return `(() => {
    ${selectorHelpers()}
    const KEY = '${PICK_KEY}';
    const LAYER_ID = '${PICK_OVERLAY_ID}';

    if (window[KEY] && window[KEY].active) return { started: true, reused: true };

    let current = null;
    let layer = null;

    const onMove = (event) => {
      if (!layer) return;
      const el = document.elementFromPoint(event.clientX, event.clientY);
      if (!el || el === layer) return;
      current = el;
      const rect = el.getBoundingClientRect();
      const box = layer.firstChild;
      const tag = layer.lastChild;
      box.style.left = rect.left + 'px';
      box.style.top = rect.top + 'px';
      box.style.width = Math.max(0, rect.width) + 'px';
      box.style.height = Math.max(0, rect.height) + 'px';
      const info = __bbDescribe(el);
      tag.textContent = info.selector || (info.tag + '（无唯一选择器）');
      tag.style.left = rect.left + 'px';
      tag.style.top = Math.max(0, rect.top - 22) + 'px';
    };

    const teardown = () => {
      if (layer) layer.remove();
      layer = null;
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKey, true);
      if (window[KEY]) window[KEY].active = false;
    };

    const finish = (result) => {
      if (window[KEY]) window[KEY].result = result;
      teardown();
    };

    const onDown = (event) => { event.preventDefault(); event.stopPropagation(); };
    const onClick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      const el = current || document.elementFromPoint(event.clientX, event.clientY);
      const info = __bbDescribe(el);
      finish(info ? { picked: info } : { error: 'no-element' });
    };
    const onKey = (event) => {
      if (event.key === 'Escape') { event.preventDefault(); finish({ cancelled: true }); }
    };

    window[KEY] = { active: true, result: null, teardown };

    layer = document.createElement('div');
    layer.id = LAYER_ID;
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:fixed;inset:0;z-index:2147483646;pointer-events:none;';
    const box = document.createElement('div');
    box.style.cssText = 'position:absolute;border:2px solid #2E7FCB;background:rgba(46,127,203,0.16);border-radius:3px;pointer-events:none;';
    const tag = document.createElement('div');
    tag.style.cssText = 'position:absolute;padding:2px 6px;background:#0F2C45;color:#fff;font:12px/1.5 Consolas,monospace;border-radius:3px;white-space:nowrap;pointer-events:none;';
    layer.appendChild(box);
    layer.appendChild(tag);
    document.documentElement.appendChild(layer);

    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('click', onClick, true);
    document.addEventListener('keydown', onKey, true);
    return { started: true };
  })()`;
}

export function pickPollExpression() {
  return `(() => {
    const state = window['${PICK_KEY}'];
    if (!state) return { known: false };
    return { known: true, active: !!state.active, result: state.result || null };
  })()`;
}

export function pickCancelExpression() {
  return `(() => {
    const state = window['${PICK_KEY}'];
    if (state && typeof state.teardown === 'function') state.teardown();
    const layer = document.getElementById('${PICK_OVERLAY_ID}');
    if (layer) layer.remove();
    window['${PICK_KEY}'] = undefined;
    return { cancelled: true };
  })()`;
}
