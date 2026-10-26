import { useCallback, useEffect, useRef, useState } from 'react';

const STEPS = [
  { id: 'connect', label: '连接', hint: '自动发现，或手动填写程序位置与调试端口' },
  { id: 'root', label: '根容器', hint: '点选铺满窗口的那层容器' },
  { id: 'faces', label: '面板', hint: '点选要变透明的区域' },
  { id: 'vars', label: '变量', hint: '挑背景与文字变量' },
  { id: 'smoke', label: '试穿', hint: '应用一次再恢复' }
];

const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function patternFor(url) {
  const text = String(url);
  try {
    const parsed = new URL(text);
    if (parsed.protocol === 'file:') {
      const base = parsed.pathname.replace(/[^/]*$/, '');
      return '^' + escapeRegex(text.slice(0, text.indexOf(parsed.pathname)) + base);
    }
    // 非特殊协议（app:// 这类）的 origin 是 "null"，按 URL 前缀截
    const match = text.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\//i);
    if (match) return '^' + escapeRegex(match[0]);
    return '^' + escapeRegex(text);
  } catch {
    return '^' + escapeRegex(text);
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
  const [darkAttr, setDarkAttr] = useState('');
  const [darkAttrValue, setDarkAttrValue] = useState('dark');
  const [darkTarget, setDarkTarget] = useState('body');
  const [mediaBlob, setMediaBlob] = useState(false);
  const [name, setName] = useState('');
  const [hostId, setHostId] = useState('');
  const [test, setTest] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanResults, setScanResults] = useState(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [importing, setImporting] = useState('');
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
    if (/(?:^|[\\/])kimi\.exe$/i.test(exe.trim())) {
      setError('Kimi 桌面版已禁用远程调试，暂时无法接入。');
      return;
    }
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
      // 属性式暗色标记（html[data-theme="dark"]）：没有暗色类但有属性候选时自动选上
      const darkAttr = (data.darkAttrCandidates || []).find((c) => /dark/i.test(c.value));
      if (!dark && darkAttr) {
        setDarkAttr(darkAttr.attr);
        setDarkAttrValue(darkAttr.value);
        setDarkTarget(darkAttr.target);
      }
      // CSP 不给 file: 媒体、但给 blob: 的宿主要默认走页面内建 blob 交付
      const csp = data.csp;
      if (csp && csp.present && !csp.fileImage && csp.blobImage) setMediaBlob(true);
      const ready = (data.readyCandidates || [])[0];
      if (ready && !rootSelector) setRootSelector(ready.selector);
      setStep(1);
    } catch (failure) {
      if (/连不上|fetch failed|ECONNREFUSED/i.test(failure.message)) {
        setError(`连不上端口 ${port}。请带 --remote-debugging-port=${port} 重启目标程序后再试。`);
      } else {
        setError(failure.message);
      }
    } finally {
      setBusy('');
    }
  }, [call, port, rootSelector, exe]);

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

  // 一键发现：扫本机调试端口 + 只读指纹，直接给出可保存的接入建议
  const runScan = useCallback(async () => {
    setError('');
    setScanBusy(true);
    try {
      const data = await call('host.autoscan', null, 60000);
      setScanResults(Array.isArray(data?.found) ? data.found : []);
    } catch (failure) {
      setError(failure.message);
    } finally {
      setScanBusy(false);
    }
  }, [call]);

  // 一键接入：内核先试穿（应用→暂停→继续→恢复），过了才落盘
  const autoImport = useCallback(async (item) => {
    const id = item.suggestion?.id || 'found-host';
    setError('');
    setImporting(id);
    try {
      const data = await call('host.autoimport', { profile: item.suggestion }, 90000);
      if (!data?.ok) {
        const stage = data?.stage === 'tryon' ? '试穿未通过' : data?.stage === 'save' ? '保存失败' : '配置不完整';
        const detail = data?.test?.error?.message || (data?.errors || [])[0] || '';
        setError(`${stage}：${detail || '换一个程序再试，或走下面的手动步骤'}`);
        if (data?.stage === 'validate' && /exe/.test((data?.errors || []).join(''))) {
          // 没定位到程序路径：把已知信息填进手动表单，让用户只补一个 exe
          setPort(String(item.port || ''));
          setName(item.suggestion?.name || '');
          setHostId(item.suggestion?.id || '');
          setManualOpen(true);
        }
        return;
      }
      setHosts(Array.isArray(data?.hosts) ? data.hosts : []);
      setScanResults((list) => (list || []).map((entry) => (
        entry.suggestion?.id === data.profile.id ? { ...entry, imported: true } : entry
      )));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setImporting('');
    }
  }, [call]);

  const profile = useCallback(() => ({
    id: hostId.trim(),
    name: name.trim(),
    exe: exe.trim(),
    port: Number(port),
    rendererPattern: patternFor(info?.url || ''),
    readySelector: rootSelector,
    rootSelector,
    darkClass: darkCls || null,
    darkAttr: darkAttr.trim() || null,
    darkAttrValue: darkAttr.trim() ? (darkAttrValue.trim() || 'dark') : null,
    darkTarget,
    tokenTarget: (info?.vars || []).find((v) => v.name === bgVar)?.target || 'body',
    themedTarget: darkTarget,
    backgroundVar: noVars ? '' : bgVar,
    foregroundVar: noVars ? '' : fgVar,
    surfaceSelectors: surfaces,
    glassSelectors: glass,
    textSelectors: splitSelectors(textSelectorInput),
    skipSelector: skipSelectorInput.trim() || null,
    varMap: noVars ? {} : autoVarMap(bgVar, fgVar, info?.vars),
    mediaDelivery: mediaBlob ? 'blob' : 'file'
  }), [hostId, name, exe, port, info, rootSelector, darkCls, darkAttr, darkAttrValue, darkTarget, bgVar, fgVar, surfaces, glass, noVars, textSelectorInput, skipSelectorInput, mediaBlob]);

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
  const kimiSelected = /(?:^|[\\/])kimi\.exe$/i.test(exe.trim());
  const canNext = step === 1 ? !!rootSelector : step === 2 ? surfaces.length > 0 : step === 3 ? (noVars || (!!bgVar && !!fgVar)) : true;

  return (
    <section className="view" data-testid="view-host">
      <div className="wizard">
        <div className="wizard-head">
          <div>
            <div className="section-title">接入新宿主</div>
            <div className="wizard-sub">通过只读连接完成配置，试穿验证后再保存，不修改宿主文件。</div>
          </div>
          <span className="wizard-safe">安全接入 · 随时可恢复</span>
        </div>

        <div className="wizard-steps" aria-label="接入进度">
          {STEPS.map((item, index) => (
            <div key={item.id} className={`wstep${index === step ? ' active' : ''}${index < step || step === 5 ? ' done' : ''}`}>
              <span className="wstep-number">{index < step || step === 5 ? '✓' : index + 1}</span>
              <span>{item.label}</span>
            </div>
          ))}
        </div>

        {error ? <div className="wizard-error" data-testid="wizard-error">{error}</div> : null}

        <div className="wizard-content">
          <div className="wizard-step-intro">
            <span className="wizard-step-kicker">{step === 5 ? '接入完成' : `步骤 ${step + 1} / ${STEPS.length}`}</span>
            <h2>{step === 5 ? '宿主已可以使用' : STEPS[step].label}</h2>
            <p>{step === 5 ? '配置已保存，可以回到控制台切换宿主并应用主题。' : STEPS[step].hint}</p>
          </div>

          {step === 0 ? (
            <div className="wizard-body connect-body">
              <section className="discover-panel">
                <div className="discover-heading">
                  <div>
                    <span className="recommend-badge">推荐</span>
                    <h3>自动查找可接入的程序</h3>
                    <p>扫描本机调试端口，识别后自动完成变量映射与试穿验证。</p>
                  </div>
                  <button type="button" className="btn gold" disabled={scanBusy} onClick={runScan} data-testid="wizard-autoscan">
                    {scanBusy ? '正在扫描…' : '自动查找宿主'}
                  </button>
                </div>
                <div className="launch-hint">
                  <span>启动参数</span>
                  <code>--remote-debugging-port=9222</code>
                  <span>先带此参数启动目标程序，再回到这里扫描。</span>
                </div>
                {scanResults ? (
                  scanResults.length ? (
                    <div className="scan-results">
                      {scanResults.map((item) => (
                        <div className="scan-card" key={`${item.port}-${item.suggestion?.id || item.hostId}`}>
                          <div>
                            <div className="scan-title">{item.imported ? (item.hostName || '已接入') : (item.suggestion?.name || item.title)}</div>
                            <div className="scan-meta">
                              端口 {item.port} · {item.imported ? '已接入，可直接在控制台顶部切换' : `${item.vars || 0} 个变量${item.suggestion?.mediaDelivery === 'blob' ? ' · blob 媒体' : ''}`}
                              {!item.imported && !item.suggestion?.exe ? ' · 未定位到程序路径' : ''}
                            </div>
                          </div>
                          {item.imported ? (
                            <span className="wchip on">已接入</span>
                          ) : (
                            <button
                              type="button"
                              className="btn dark"
                              disabled={importing === (item.suggestion?.id || '')}
                              onClick={() => autoImport(item)}
                              data-testid={`wizard-import-${item.suggestion?.id}`}
                            >
                              {importing === (item.suggestion?.id || '') ? '试穿中…' : '一键接入'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="scan-empty">
                      未发现已开启 CDP 调试的宿主。请带调试端口重启程序；Kimi 暂不支持。
                    </div>
                  )
                ) : null}
              </section>

              <section className={`manual-panel${manualOpen ? ' open' : ''}`}>
                <button type="button" className="manual-toggle" aria-expanded={manualOpen} onClick={() => setManualOpen((open) => !open)}>
                  <span>
                    <strong>手动接入</strong>
                    <small>自动发现不可用时，手动填写程序位置和调试端口</small>
                  </span>
                  <span className="manual-toggle-meta">高级 {manualOpen ? '−' : '+'}</span>
                </button>
                {manualOpen ? (
                  <div className="manual-fields">
                    <div className="wfield">
                      <label>目标程序位置（可选）</label>
                      <div className="wrow">
                        <input value={exe} onChange={(event) => setExe(event.target.value)} placeholder="C:\Program Files\YourApp\YourApp.exe" data-testid="wizard-exe" />
                        <button type="button" className="btn dark" onClick={browse}>选择…</button>
                      </div>
                    </div>
                    <div className="wfield">
                      <label>调试端口</label>
                      <div className="wrow">
                        <input value={port} onChange={(event) => setPort(event.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" data-testid="wizard-port" />
                        <button type="button" className="btn gold" disabled={kimiSelected || busy === 'inspect'} onClick={inspect} data-testid="wizard-inspect">
                          {kimiSelected ? '暂不支持' : busy === 'inspect' ? '连接中…' : '只读检测'}
                        </button>
                      </div>
                      <div className="whint">检测只读取页面信息，不会向宿主注入内容。</div>
                    </div>
                    {kimiSelected ? (
                      <div className="wresult bad manual-support">
                        Kimi 已禁用远程调试，并非端口错误。请选择其他支持 CDP 的程序。
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </section>
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
              <div className="wfield">
                <label>暗色属性名（class 以外的标记，如 data-theme）</label>
                <div className="wrow">
                  <input
                    value={darkAttr}
                    onChange={(event) => setDarkAttr(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                    placeholder="data-theme"
                    data-testid="wizard-dark-attr"
                  />
                  <input
                    className="input"
                    style={{ maxWidth: 110 }}
                    value={darkAttrValue}
                    onChange={(event) => setDarkAttrValue(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))}
                    placeholder="dark"
                    data-testid="wizard-dark-attr-value"
                  />
                </div>
                {info?.darkAttrCandidates?.length ? (
                  <div className="wchips">
                    {info.darkAttrCandidates.map((item) => (
                      <button
                        key={item.target + item.attr}
                        type="button"
                        className={`wchip${darkAttr === item.attr && darkAttrValue === item.value ? ' on' : ''}`}
                        onClick={() => { setDarkAttr(item.attr); setDarkAttrValue(item.value); setDarkTarget(item.target); }}
                      >
                        {item.attr}={item.value}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <label className="check" style={{ margin: '10px 0' }}>
              <input
                type="checkbox"
                checked={mediaBlob}
                onChange={(event) => setMediaBlob(event.target.checked)}
                data-testid="wizard-media-blob"
              />
              宿主 CSP 不允许 file: 媒体（图片/视频改走页面内建 blob 交付）
            </label>
            {info?.csp?.present ? (
              <div className="whint">
                检测到 CSP：file: 图片 {String(info.csp.fileImage ? '允许' : '不允许')} · blob: 图片 {String(info.csp.blobImage ? '允许' : '不允许')} ·
                blob: 视频 {String(info.csp.blobVideo ? '允许' : '不允许')} · 内联 style {String(info.csp.inlineStyle ? '允许' : '不允许')}
              </div>
            ) : null}

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

        </div>

        {step < 5 ? (
          <div className="wizard-foot">
            <span className="whint">
              {step === 0 ? '自动发现可一步完成接入；手动模式将依次完成以下五步。' : `当前：${STEPS[step].label} · 后续步骤可随时返回修改`}
            </span>
            <div className="wizard-actions">
              {step > 0 ? (
                <button type="button" className="btn light" onClick={() => setStep((s) => Math.max(0, s - 1))}>上一步</button>
              ) : null}
              {step > 0 && step < 4 ? (
                <button type="button" className="btn gold" disabled={!canNext} onClick={() => setStep((s) => Math.min(4, s + 1))} data-testid="wizard-next">
                  下一步
                </button>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>

      {hosts.length ? (
        <aside className="wizard-hosts" aria-label="当前可用宿主">
          <div className="wlabel">已接入宿主 <span>{hosts.length}</span></div>
          <div className="wchips">
            {hosts.map((host) => (
              <span key={host.id} className={`wchip${host.source === 'user' ? ' on' : ''}`}>
                {host.name}{host.port ? ` · ${host.port}` : ''}{host.source === 'user' ? ' · 自建' : ''}
              </span>
            ))}
          </div>
          <span className="wizard-hosts-hint">在控制台顶部切换</span>
        </aside>
      ) : null}
    </section>
  );
}
