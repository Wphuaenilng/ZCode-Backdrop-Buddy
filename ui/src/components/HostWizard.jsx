import { useCallback, useEffect, useRef, useState } from 'react';

const STEPS = [
  { id: 'connect', label: '连接', hint: '填目标程序的控制台地址' },
  { id: 'root', label: '根容器', hint: '点选铺满窗口的那层容器' },
  { id: 'faces', label: '面板', hint: '点选要变透明的区域' },
  { id: 'vars', label: '变量', hint: '挑背景与文字变量' },
  { id: 'smoke', label: '试穿', hint: '应用一次再恢复' }
];

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function patternFor(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'file:') {
      const base = parsed.pathname.replace(/[^/]*$/, '');
      return '^' + escapeRegex(base);
    }
    return '^' + escapeRegex(parsed.origin + '/');
  } catch {
    return escapeRegex(url);
  }
}

function slugFor(title) {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  return base || 'my-host';
}

function autoVarMap(bgVar, fgVar, vars) {
  const map = {};
  if (bgVar) map[bgVar] = 'panel';
  if (fgVar) map[fgVar] = 'foreground';
  for (const item of vars || []) {
    if (item.name === bgVar || item.name === fgVar) continue;
    const name = item.name.toLowerCase();
    if (Object.keys(map).length >= 8) break;
    if (/secondary|sidebar|panel/.test(name)) map[item.name] = 'sidebar';
    else if (/border/.test(name)) map[item.name] = 'border';
    else if (/accent|primary/.test(name)) map[item.name] = 'accentSoft';
    else if (/muted|faint|subtle/.test(name)) map[item.name] = 'foregroundSubtle';
  }
  return map;
}

export default function HostWizard({ bridge, native, onSaved }) {
  const [step, setStep] = useState(0);
  const [exe, setExe] = useState('');
  const [port, setPort] = useState('9222');
  const [info, setInfo] = useState(null);
  const [rootSelector, setRootSelector] = useState('');
  const [surfaces, setSurfaces] = useState([]);
  const [glass, setGlass] = useState([]);
  const [noVars, setNoVars] = useState(false);
  const [textSelectorInput, setTextSelectorInput] = useState('');
  const [skipSelectorInput, setSkipSelectorInput] = useState('');
  const [bgVar, setBgVar] = useState('');
  const [fgVar, setFgVar] = useState('');
  const [darkCls, setDarkCls] = useState('');
  const [darkTarget, setDarkTarget] = useState('body');
  const [name, setName] = useState('');
  const [hostId, setHostId] = useState('');
  const [test, setTest] = useState(null);
  const [picking, setPicking] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [hosts, setHosts] = useState([]);
  const poller = useRef(0);

  const call = useCallback(async (method, params, timeout) => {
    const result = await bridge.request(method, params || {}, timeout);
    if (!result.ok) throw new Error(result.error?.message || result.error?.code || '请求失败');
    return result.data;
  }, [bridge]);

  const stopPoll = useCallback(() => {
    if (poller.current) clearInterval(poller.current);
    poller.current = 0;
    setPicking(null);
  }, []);

  useEffect(() => () => { if (poller.current) clearInterval(poller.current); }, []);

  const refreshHosts = useCallback(async () => {
    try {
      const data = await call('host.profile.list');
      setHosts(Array.isArray(data?.hosts) ? data.hosts : []);
    } catch { /* 列表失败不影响向导 */ }
  }, [call]);

  useEffect(() => { if (native) refreshHosts(); }, [native, refreshHosts]);

  const browse = useCallback(async () => {
    try {
      const data = await call('file.pick', { mode: 'open', kind: 'any' });
      if (data?.canceled) return;
      if (data?.path) setExe(data.path);
    } catch (failure) {
      setError(failure.message);
    }
  }, [call]);

  const inspect = useCallback(async () => {
    setError('');
    setBusy('inspect');
    try {
      const data = await call('host.inspect', { port: Number(port) });
      setInfo(data);
      setName((current) => current || String(data.title || '').split(' - ')[0].slice(0, 24));
      setHostId((current) => current || slugFor(data.title));
      const bg = (data.vars || []).find((v) => /background|surface|bg/i.test(v.name) && !/secondary|modifier|hover|active|alt|accent/i.test(v.name));
      const fg = (data.vars || []).find((v) => /text|foreground|fg/i.test(v.name) && !/muted|faint|subtle|accent|inverse/i.test(v.name));
      setBgVar(bg ? bg.name : (data.vars && data.vars[0] ? data.vars[0].name : ''));
      setFgVar(fg ? fg.name : '');
      // 只自动选真正的暗色类；theme-light 这类不能当成暗色
      const dark = (data.darkCandidates || []).find((c) => /dark/i.test(c.cls));
      setDarkCls(dark ? dark.cls : '');
      if (dark) setDarkTarget(dark.target);
      const ready = (data.readyCandidates || [])[0];
      if (ready && !rootSelector) setRootSelector(ready.selector);
      setStep(1);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy('');
    }
  }, [call, port, rootSelector]);

  const startPick = useCallback(async (target) => {
    setError('');
    setPicking(target);
    try {
      await call('host.pick.start', { port: Number(port) });
    } catch (failure) {
      setPicking(null);
      setError(failure.message);
      return;
    }

    const value = Number(port);
    if (poller.current) clearInterval(poller.current);
    poller.current = setInterval(async () => {
      try {
        const data = await call('host.pick.poll', { port: value });
        const result = data?.result;
        if (!result) return;
        if (result.cancelled) { stopPoll(); return; }
        if (!result.picked) { stopPoll(); setError(result.error || '没取到元素'); return; }
        const selector = result.picked.selector;
        stopPoll();
        if (!selector) { setError('这个元素没有唯一选择器，换一个更"有名字"的区域再试。'); return; }
        if (target === 'root') setRootSelector(selector);
        else if (target === 'surface') setSurfaces((list) => (list.includes(selector) ? list : [...list, selector]));
        else if (target === 'glass') setGlass((list) => (list.includes(selector) ? list : [...list, selector]));
      } catch (failure) {
        stopPoll();
        setError(failure.message);
      }
    }, 600);
  }, [call, port, stopPoll]);

  const cancelPick = useCallback(async () => {
    stopPoll();
    try { await call('host.pick.cancel', { port: Number(port) }); } catch { /* 页面可能已关 */ }
  }, [call, port, stopPoll]);

  const splitSelectors = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);

  const profile = useCallback(() => ({
    id: hostId.trim(),
    name: name.trim(),
    exe: exe.trim(),
    port: Number(port),
    rendererPattern: patternFor(info?.url || ''),
    readySelector: rootSelector,
    rootSelector,
    darkClass: darkCls || null,
    darkTarget,
    tokenTarget: (info?.vars || []).find((v) => v.name === bgVar)?.target || 'body',
    themedTarget: darkTarget,
    backgroundVar: noVars ? '' : bgVar,
    foregroundVar: noVars ? '' : fgVar,
    surfaceSelectors: surfaces,
    glassSelectors: glass,
    textSelectors: splitSelectors(textSelectorInput),
    skipSelector: skipSelectorInput.trim() || null,
    varMap: noVars ? {} : autoVarMap(bgVar, fgVar, info?.vars)
  }), [hostId, name, exe, port, info, rootSelector, darkCls, darkTarget, bgVar, fgVar, surfaces, glass, noVars, textSelectorInput, skipSelectorInput]);

  const runTest = useCallback(async () => {
    setError('');
    setTest(null);
    setBusy('test');
    try {
      const data = await call('host.profile.test', { profile: profile() }, 90000);
      setTest(data);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy('');
    }
  }, [call, profile]);

  const save = useCallback(async () => {
    setError('');
    setBusy('save');
    try {
      const data = await call('host.profile.save', { profile: profile() });
      setHosts(Array.isArray(data?.hosts) ? data.hosts : []);
      if (onSaved) onSaved(data?.profile);
      setStep(5);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy('');
    }
  }, [call, profile, onSaved]);

  if (!native) {
    return (
      <section className="view" data-testid="view-host">
        <div className="host-empty">接入向导只在桌面版可用（需要读取本机调试端口）。</div>
      </section>
    );
  }

  const vars = info?.vars || [];
  const canNext = step === 1 ? !!rootSelector : step === 2 ? surfaces.length > 0 : step === 3 ? (noVars || (!!bgVar && !!fgVar)) : true;

  return (
    <section className="view" data-testid="view-host">
      <div className="wizard">
        <div className="wizard-head">
          <div>
            <div className="section-title">接入新宿主</div>
            <div className="wizard-sub">只读连接 → 点选锚点 → 试穿一次 → 保存为宿主配置。不写宿主文件。</div>
          </div>
          <div className="wizard-steps">
            {STEPS.map((item, index) => (
              <span key={item.id} className={`wstep${index === step ? ' active' : ''}${index < step ? ' done' : ''}`}>
                {index + 1}. {item.label}
              </span>
            ))}
          </div>
        </div>

        {error ? <div className="wizard-error" data-testid="wizard-error">{error}</div> : null}

        {step === 0 ? (
          <div className="wizard-body">
            <div className="wfield">
              <label>目标程序</label>
              <div className="wrow">
                <input value={exe} onChange={(event) => setExe(event.target.value)} placeholder="C:\Program Files\YourApp\YourApp.exe" data-testid="wizard-exe" />
                <button type="button" className="btn dark" onClick={browse}>选择…</button>
              </div>
            </div>
            <div className="wfield">
              <label>调试端口</label>
              <div className="wrow">
                <input value={port} onChange={(event) => setPort(event.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" data-testid="wizard-port" />
                <button type="button" className="btn gold" disabled={busy === 'inspect'} onClick={inspect} data-testid="wizard-inspect">
                  {busy === 'inspect' ? '连接中…' : '只读检测'}
                </button>
              </div>
              <div className="whint">
                先用 <code>--remote-debugging-port={port || '9222'}</code> 启动目标程序，再点检测。检测只读，不注入。
              </div>
            </div>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="wizard-body">
            <div className="winfo">
              <span>{info?.title || '未知页面'}</span>
              <span className="wtag">{info?.version ? 'v' + info.version : '版本未知'}</span>
              <span className="wtag">{vars.length} 个变量</span>
            </div>
            <div className="wfield">
              <label>根容器</label>
              <div className="wrow">
                <input value={rootSelector} onChange={(event) => setRootSelector(event.target.value)} placeholder=".app-container" data-testid="wizard-root" />
                <button type="button" className="btn gold" onClick={() => (picking === 'root' ? cancelPick() : startPick('root'))} data-testid="wizard-pick-root">
                  {picking === 'root' ? '停止点选' : '去窗口里点选'}
                </button>
              </div>
              <div className="whint">点选时请切到目标程序窗口：鼠标悬停会高亮，单击确认，Esc 取消。</div>
              {info?.readyCandidates?.length ? (
                <div className="wchips">
                  {info.readyCandidates.map((item) => (
                    <button key={item.selector} type="button" className={`wchip${rootSelector === item.selector ? ' on' : ''}`} onClick={() => setRootSelector(item.selector)}>
                      {item.selector}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="wizard-body">
            <div className="wfield">
              <label>要变透明的面板（{surfaces.length}）</label>
              <div className="wrow">
                <button type="button" className="btn gold" onClick={() => (picking === 'surface' ? cancelPick() : startPick('surface'))} data-testid="wizard-pick-surface">
                  {picking === 'surface' ? '停止点选' : '点选一个面板'}
                </button>
                <button type="button" className="btn dark" onClick={() => (picking === 'glass' ? cancelPick() : startPick('glass'))} data-testid="wizard-pick-glass">
                  {picking === 'glass' ? '停止点选' : '点选一条工具栏（玻璃）'}
                </button>
              </div>
              <div className="whint">面板会透出底图；工具栏保留磨砂底，文字才看得清。</div>
              {surfaces.length ? (
                <div className="wchips">
                  {surfaces.map((sel) => (
                    <button key={sel} type="button" className="wchip on" onClick={() => setSurfaces(surfaces.filter((item) => item !== sel))}>{sel} ×</button>
                  ))}
                </div>
              ) : null}
              {glass.length ? (
                <div className="wchips">
                  {glass.map((sel) => (
                    <button key={sel} type="button" className="wchip on glass" onClick={() => setGlass(glass.filter((item) => item !== sel))}>玻璃 {sel} ×</button>
                  ))}
                </div>
              ) : null}
              {info?.surfaces?.length ? (
                <div className="wchips">
                  {info.surfaces.slice(0, 8).map((item) => (
                    <button key={item.selector} type="button" className="wchip" onClick={() => setSurfaces((list) => (list.includes(item.selector) ? list : [...list, item.selector]))}>
                      + {item.selector}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {step === 3 ? (
          <div className="wizard-body">
            <label className="check" style={{ marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={noVars}
                onChange={(event) => setNoVars(event.target.checked)}
                data-testid="wizard-no-vars"
              />
              这个宿主没有 CSS 变量（靠选择器上色）
            </label>

            {!noVars ? (
              <div className="wgrid">
                <div className="wfield">
                  <label>背景变量</label>
                  <select value={bgVar} onChange={(event) => setBgVar(event.target.value)} data-testid="wizard-bgvar">
                    {vars.map((item) => <option key={item.target + item.name} value={item.name}>{item.name} = {item.value}</option>)}
                  </select>
                </div>
                <div className="wfield">
                  <label>文字变量</label>
                  <select value={fgVar} onChange={(event) => setFgVar(event.target.value)} data-testid="wizard-fgvar">
                    {vars.map((item) => <option key={item.target + item.name} value={item.name}>{item.name} = {item.value}</option>)}
                  </select>
                </div>
              </div>
            ) : (
              <p className="note" style={{ marginTop: 0 }}>
                没有变量时，皮肤只做背景层 + 面板透明 / 磨砂；文字颜色靠下面的「文字元素」逐条压上去。
              </p>
            )}

            <div className="wgrid">
              <div className="wfield">
                <label>暗色类名</label>
                <select value={darkCls} onChange={(event) => {
                  const next = (info?.darkCandidates || []).find((c) => c.cls === event.target.value);
                  setDarkCls(event.target.value);
                  if (next) setDarkTarget(next.target);
                }}>
                  <option value="">（不使用）</option>
                  {(info?.darkCandidates || []).map((item) => (
                    <option key={item.target + item.cls} value={item.cls}>{item.cls}@{item.target}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="wfield" style={{ marginTop: 10 }}>
              <label>文字元素（逗号分隔，可留空）</label>
              <input
                className="input"
                value={textSelectorInput}
                onChange={(event) => setTextSelectorInput(event.target.value)}
                placeholder="body, .settings-page, section.card"
                data-testid="wizard-text-selectors"
              />
            </div>
            <div className="wfield">
              <label>不要换肤的窗口（选择器，可留空）</label>
              <input
                className="input"
                value={skipSelectorInput}
                onChange={(event) => setSkipSelectorInput(event.target.value)}
                placeholder=".pet-root"
                data-testid="wizard-skip-selector"
              />
            </div>

            <div className="whint">
              {noVars
                ? '无变量模式：不映射任何 CSS 变量，只注入背景层与选择器规则。'
                : `自动映射：${Object.entries(autoVarMap(bgVar, fgVar, vars)).map(([key, value]) => `${key}→${value}`).join('，') || '无'}`}
            </div>
          </div>
        ) : null}

        {step === 4 ? (
          <div className="wizard-body">
            <div className="wgrid">
              <div className="wfield">
                <label>宿主名称</label>
                <input value={name} onChange={(event) => setName(event.target.value)} maxLength={40} data-testid="wizard-name" />
              </div>
              <div className="wfield">
                <label>宿主 ID</label>
                <input value={hostId} onChange={(event) => setHostId(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))} maxLength={32} data-testid="wizard-id" />
              </div>
            </div>
            <div className="wrow">
              <button type="button" className="btn gold" disabled={busy === 'test'} onClick={runTest} data-testid="wizard-test">
                {busy === 'test' ? '试穿中…' : '试穿（应用→暂停→继续→恢复）'}
              </button>
              <button type="button" className="btn dark" disabled={!test?.ok || busy === 'save'} onClick={save} data-testid="wizard-save">
                {busy === 'save' ? '保存中…' : '保存为宿主'}
              </button>
            </div>
            {test ? (
              <div className={`wresult${test.ok ? ' ok' : ' bad'}`}>
                <div>{test.ok ? '试穿通过，已恢复原貌' : '试穿未通过'}</div>
                <div className="whint">
                  CSS {test.cssBytes || 0} B · 注入 {String(test.injected)} · 校验 {String(test.verification?.style)} ·
                  暂停 {String(test.paused)} · 继续 {String(test.resumed)} · 恢复 {String(test.restored?.verified)}
                </div>
                {test.error ? <div className="whint">错误：{test.error.code} {test.error.message}</div> : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 5 ? (
          <div className="wizard-body">
            <div className="wresult ok">
              <div>已保存宿主「{name}」</div>
              <div className="whint">
                用 <code>BACKDROPBUDDY_HOST={hostId}</code> 启动 BackdropBuddy 即可切到它；
                默认仍然是 ZCode。
              </div>
            </div>
          </div>
        ) : null}

        <div className="wizard-foot">
          <button type="button" className="btn dark" disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}>上一步</button>
          {step > 0 && step < 4 ? (
            <button type="button" className="btn gold" disabled={!canNext} onClick={() => setStep((s) => Math.min(4, s + 1))} data-testid="wizard-next">
              下一步
            </button>
          ) : null}
          {step === 0 ? <span className="whint">{STEPS[step].hint}</span> : null}
        </div>

        {hosts.length ? (
          <div className="wizard-hosts">
            <div className="wlabel">当前可用宿主</div>
            <div className="wchips">
              {hosts.map((host) => (
                <span key={host.id} className={`wchip${host.source === 'user' ? ' on' : ''}`}>
                  {host.name}{host.port ? ` · ${host.port}` : ''}{host.source === 'user' ? ' · 自建' : ''}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
