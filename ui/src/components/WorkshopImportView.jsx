import { useCallback, useEffect, useMemo, useState } from 'react';

const TYPE_LABELS = { video: '视频', scene: '场景', web: '网页', application: '应用' };
const IMPORT_TIMEOUT = 120000;
const SCAN_TIMEOUT = 60000;

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

// 从 Wallpaper Engine 创意工坊挑视频壁纸，复制进"我的主题"。
// 扫描结果与导入状态都在本组件内消化；每导入一条就回调 onImported，
// 让 App 刷新主题列表并把筛选切到"我的"，本页保持打开（对齐自动查找宿主的节奏）。
export default function WorkshopImportView({ bridge, native, onImported, showToast }) {
  const call = useCallback(async (method, params, timeout) => {
    const result = await bridge.request(method, params || {}, timeout);
    if (!result.ok) throw new Error(result.error?.message || result.error?.code || '请求失败');
    return result.data;
  }, [bridge]);

  const [scan, setScan] = useState(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(() => new Set());
  const [importing, setImporting] = useState('');
  const [batchBusy, setBatchBusy] = useState(false);
  const [results, setResults] = useState({});

  const runScan = useCallback(async () => {
    setError('');
    setScanBusy(true);
    setSelected(new Set());
    setResults({});
    try {
      setScan(await call('workshop.scan', null, SCAN_TIMEOUT));
    } catch (failure) {
      setError(failure.message);
    } finally {
      setScanBusy(false);
    }
  }, [call]);

  // 扫描是磁盘只读操作，进页面自动跑一次；没有 Steam 的机器上会直接落到引导文案。
  useEffect(() => {
    if (native) runScan();
  }, [native, runScan]);

  const importOne = useCallback(async (item) => {
    const data = await call('workshop.import', { id: item.id }, IMPORT_TIMEOUT);
    if (data?.duplicate) {
      setResults((map) => ({ ...map, [item.id]: { status: 'duplicate' } }));
      if (onImported) onImported(data.theme, { duplicate: true });
      return 'duplicate';
    }
    if (data?.imported) {
      setResults((map) => ({ ...map, [item.id]: { status: 'imported' } }));
      if (onImported) onImported(data.theme, {});
      return 'imported';
    }
    setResults((map) => ({ ...map, [item.id]: { status: 'failed', message: `${data?.code || 'FAILED'}：${data?.message || '导入失败'}` } }));
    return 'failed';
  }, [call, onImported]);

  const importItem = useCallback(async (item) => {
    setError('');
    setImporting(item.id);
    try {
      const outcome = await importOne(item);
      if (outcome === 'failed') setError('这条壁纸没能导入，卡片上有原因');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setImporting('');
    }
  }, [importOne]);

  const importSelected = useCallback(async () => {
    if (batchBusy) return;
    const items = (scan?.items || []).filter((item) => selected.has(item.id) && !results[item.id]);
    if (!items.length) return;
    setBatchBusy(true);
    setError('');
    let imported = 0;
    let duplicate = 0;
    let failed = 0;
    try {
      for (const item of items) {
        setImporting(item.id);
        try {
          const outcome = await importOne(item);
          if (outcome === 'imported') imported += 1;
          else if (outcome === 'duplicate') duplicate += 1;
          else failed += 1;
        } catch (failure) {
          setResults((map) => ({ ...map, [item.id]: { status: 'failed', message: failure.message } }));
          failed += 1;
        }
      }
    } finally {
      setImporting('');
      setBatchBusy(false);
      setSelected(new Set());
    }
    const parts = [`成功 ${imported}`, duplicate ? `已在库中 ${duplicate}` : '', failed ? `失败 ${failed}` : ''].filter(Boolean);
    showToast(`Wallpaper Engine 导入完成：${parts.join(' · ')}`);
    if (failed) setError('有失败项，卡片上标了原因（常见为超出 200 MB 视频上限）');
  }, [batchBusy, importOne, results, scan, selected, showToast]);

  const toggleSelect = useCallback((id, checked) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const items = scan?.items || [];
  // 批量按钮只统计还没导入成功的选中项
  const selectedCount = useMemo(
    () => (scan?.items || []).filter((item) => selected.has(item.id) && !results[item.id] && item.supported).length,
    [results, scan, selected]
  );

  return (
    <section className="view" data-testid="view-workshop">
      <section className="discover-panel">
        <div className="discover-heading">
          <div>
            <h3>从 Wallpaper Engine 导入</h3>
            <p>扫描本机 Steam 创意工坊与 Wallpaper Engine 本地项目，视频壁纸复制进「我的主题」。场景 / 网页型只能在 Wallpaper Engine 里渲染，这里仅展示。</p>
          </div>
          <button type="button" className="btn gold" disabled={scanBusy} onClick={runScan} data-testid="workshop-scan">
            {scanBusy ? '正在扫描…' : '重新扫描'}
          </button>
        </div>
        <div className="launch-hint">
          <span>扫描范围</span>
          <code>steamapps\workshop\content\431960</code>
          <span>与 Wallpaper Engine 本地项目目录，全程只读本机磁盘。</span>
        </div>

        {error ? <div className="wizard-error" data-testid="workshop-error">{error}</div> : null}

        {scan && !scan.found ? (
          <div className="scan-empty" data-testid="workshop-empty">
            未检测到 Steam 安装。安装 Steam 版 Wallpaper Engine 并订阅创意工坊后，回到这里点「重新扫描」。
          </div>
        ) : null}

        {scan && scan.found && !items.length ? (
          <div className="scan-empty" data-testid="workshop-empty">
            找到了 Steam（{scan.steamPath}），但没有发现 Wallpaper Engine 壁纸项目。
          </div>
        ) : null}

        {items.length ? (
          <>
            {scan.truncated ? <div className="workshop-note">条目较多，仅显示前 {scan.cap} 个。</div> : null}
            {scan.skipped ? <div className="workshop-note">已跳过 {scan.skipped} 个无法识别的项目目录。</div> : null}
            <div className="workshop-grid" data-testid="workshop-grid">
              {items.map((item) => {
                const state = results[item.id];
                return (
                  <article
                    className={`workshop-card${item.supported ? '' : ' disabled'}`}
                    key={item.id}
                    data-testid={`workshop-card-${item.id}`}
                  >
                    <div
                      className="workshop-thumb"
                      style={item.previewUrl ? { backgroundImage: `url("${item.previewUrl}")` } : undefined}
                    >
                      {!item.previewUrl ? <span className="workshop-thumb-fallback">{(item.title || '?').slice(0, 1)}</span> : null}
                      <span className={`workshop-type${item.supported ? '' : ' off'}`}>{TYPE_LABELS[item.type] || item.type}</span>
                      {item.supported ? (
                        <label className="workshop-check">
                          <input
                            type="checkbox"
                            checked={selected.has(item.id)}
                            // 失败项保持可勾选，让"导入所选"能批量重试；只有已入库的才锁
                            disabled={state?.status === 'imported' || state?.status === 'duplicate' || batchBusy}
                            onChange={(event) => toggleSelect(item.id, event.target.checked)}
                            data-testid={`workshop-select-${item.id}`}
                          />
                          选择
                        </label>
                      ) : null}
                    </div>
                    <div className="workshop-meta">
                      <div className="workshop-title">{item.title}</div>
                      <div className="workshop-sub">
                        {item.supported ? formatBytes(item.bytes) : '仅 Wallpaper Engine 可用'}
                      </div>
                      {state?.status === 'failed' ? <div className="workshop-error">{state.message}</div> : null}
                    </div>
                    <div className="workshop-action">
                      {state?.status === 'imported' || state?.status === 'duplicate' ? (
                        <span className="wchip on">{state.status === 'duplicate' ? '已在库中' : '已导入'}</span>
                      ) : item.supported ? (
                        <button
                          type="button"
                          className="btn dark"
                          disabled={importing === item.id || batchBusy}
                          onClick={() => importItem(item)}
                          data-testid={`workshop-import-${item.id}`}
                        >
                          {importing === item.id ? '导入中…' : '导入'}
                        </button>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
            {selectedCount ? (
              <div className="workshop-batch" data-testid="workshop-batch">
                <span>已选 {selectedCount} 项，将逐条导入。</span>
                <button
                  type="button"
                  className="btn gold"
                  disabled={batchBusy}
                  onClick={importSelected}
                  data-testid="workshop-import-selected"
                >
                  {batchBusy ? '正在导入…' : `导入所选（${selectedCount}）`}
                </button>
              </div>
            ) : null}
          </>
        ) : null}
      </section>
    </section>
  );
}
