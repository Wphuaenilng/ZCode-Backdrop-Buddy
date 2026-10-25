import { useEffect, useRef } from 'react';
import ThemeCard from './ThemeCard.jsx';
import HostPreview from './HostPreview.jsx';
import { TAG_LIST } from '../data/params.js';

const SOURCES = [
  { value: 'all', label: '全部' },
  { value: 'builtin', label: '内置' },
  { value: 'my', label: '我的' }
];

const RECOVERY_COPY = (hostName) => ({
  'orphan-layer': { title: `${hostName} 上还留着上次的皮肤`, action: '恢复原貌' },
  'stale-pointer': { title: `上次的主题已不在 ${hostName} 上`, action: '重新应用' },
  'mismatch-layer': { title: `${hostName} 上的主题与本机记录不一致`, action: '重新应用' },
  'port-conflict': { title: '调试端口被占用', action: '重新检测' }
});

export default function ConsoleView({
  themes,
  selectedTheme,
  selectedId,
  runningTheme,
  paused,
  params,
  filters,
  deleteConfirm,
  onFilter,
  onSelect,
  onApply,
  onPause,
  onReset,
  onRestore,
  native,
  applyBusy,
  hosts,
  activeHost,
  hostSwitching,
  hostName,
  onSwitchHost,
  onOpenHostWizard,
  onAddImage,
  onImportPack,
  onPickPack,
  onExportTheme,
  onExportAssets,
  onDelete,
  onEditParams,
  onRefresh,
  recovery,
  onRecoveryAction,
  onDismissRecovery
}) {
  const packInput = useRef(null);
  const runningId = runningTheme ? runningTheme.id : null;
  const recoveryCopy = recovery ? (RECOVERY_COPY(hostName || '宿主')[recovery.verdict] || null) : null;

  useEffect(() => {
    if (!selectedId) return;
    const card = document.querySelector(`[data-testid="theme-card-${selectedId}"]`);
    if (card) card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId, themes]);

  const applyLabel = runningId === selectedId ? '重新应用' : '应用皮肤';
  const deleteLabel = deleteConfirm
    ? (selectedTheme?.builtin ? '确认删除内置主题' : '确认删除我的主题')
    : (selectedTheme?.builtin ? '删除内置主题' : '删除我的主题');

  return (
    <section className="view" data-testid="view-console">
      {native && Array.isArray(hosts) && hosts.length ? (
        <div className="host-switcher" data-testid="host-switcher">
          <span className="host-switcher-label">{hostSwitching ? '切换中…' : '宿主'}</span>
          <div className="wchips">
            {hosts.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`wchip${item.id === activeHost ? ' on' : ''}`}
                disabled={hostSwitching || item.id === activeHost}
                onClick={() => onSwitchHost && onSwitchHost(item.id)}
                data-testid={`host-chip-${item.id}`}
                title={item.source === 'user' ? '向导接入的宿主，每个宿主各记各的壁纸' : '内置宿主'}
              >
                {item.name}
              </button>
            ))}
            <button type="button" className="wchip add" onClick={onOpenHostWizard} data-testid="host-chip-add">＋ 接入</button>
          </div>
        </div>
      ) : null}
      {recoveryCopy ? (
        <div
          className={`notice${recovery.verdict === 'port-conflict' ? ' conflict' : ''}`}
          role="status"
          data-testid="recovery-notice"
        >
          <div className="notice-main">
            <span className="notice-dot" />
            <div>
              <div className="notice-title">{recoveryCopy.title}</div>
              <div className="notice-text">{recovery.reason}</div>
            </div>
          </div>
          <div className="notice-actions">
            <button type="button" className="btn gold" onClick={onRecoveryAction} data-testid="recovery-action">
              {recoveryCopy.action}
            </button>
            <button type="button" className="btn dark" onClick={onDismissRecovery} data-testid="recovery-dismiss">
              忽略
            </button>
          </div>
        </div>
      ) : null}

      <div className="console-layout">
        <div className="library">
          <div className="section-title">主题库</div>

          <div className="filters">
            <input
              className="search"
              type="search"
              placeholder="主题名称或标签"
              autoComplete="off"
              value={filters.search}
              onChange={(event) => onFilter({ search: event.target.value })}
              data-testid="theme-search"
            />

            <select
              className="select wide"
              aria-label="分类"
              value={filters.category}
              onChange={(event) => onFilter({ category: event.target.value })}
              data-testid="category-filter"
            >
              <option value="all">全部分类</option>
              {TAG_LIST.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
            </select>

            <div className="seg" role="group" aria-label="主题来源">
              {SOURCES.map((source) => (
                <button
                  key={source.value}
                  type="button"
                  className={filters.source === source.value ? 'active' : ''}
                  onClick={() => onFilter({ source: source.value })}
                  data-testid={`source-${source.value}`}
                >
                  {source.label}
                </button>
              ))}
            </div>

            <select
              className="select short"
              aria-label="排序"
              value={filters.sort}
              onChange={(event) => onFilter({ sort: event.target.value })}
              data-testid="sort-filter"
            >
              <option value="catalog">目录顺序</option>
              <option value="name">名称</option>
              <option value="recent">最近</option>
            </select>
          </div>

          <div className="actions">
            <button type="button" className="btn dark" onClick={onAddImage} data-testid="add-image">添加图片</button>
            <button type="button" className="btn dark" onClick={() => (native ? onPickPack() : packInput.current?.click())} data-testid="import-pack">导入主题包</button>
            <button type="button" className="btn dark" onClick={onExportTheme} data-testid="export-theme">导出主题</button>
            <button type="button" className="btn dark" onClick={onDelete} data-testid="delete-theme">{deleteLabel}</button>
          </div>

          <div className="theme-grid" data-testid="theme-grid">
            {themes.length ? themes.map((theme) => (
              <ThemeCard
                key={theme.id}
                theme={theme}
                selected={theme.id === selectedId}
                running={theme.id === runningId}
                onSelect={onSelect}
              />
            )) : (
              <div className="empty">
                {filters.source === 'my'
                  ? '还没有我的主题。在「导入图片」里保存一个。'
                  : '没有匹配的主题，换个关键词或分类。'}
              </div>
            )}
          </div>

          <input
            ref={packInput}
            type="file"
            accept="application/json,.json"
            hidden
            data-testid="pack-input"
            onChange={(event) => {
              const file = event.target.files && event.target.files[0];
              if (file) onImportPack(file);
              event.target.value = '';
            }}
          />
        </div>

        <aside className="side">
          <div className="preview-card">
            <HostPreview
              theme={selectedTheme}
              params={params}
              paused={!!runningId && runningId === selectedId && paused}
            />

            <div className="current-label">当前主题</div>
            <div className={`current-name${runningTheme ? '' : ' none'}`} data-testid="current-name">
              {runningTheme ? runningTheme.name : '未运行'}
            </div>

            <button
              type="button"
              className="btn gold full"
              disabled={applyBusy}
              onClick={onApply}
              data-testid="apply"
            >
              {applyBusy ? '正在处理…' : applyLabel}
            </button>

            <div className="dual">
              <button type="button" className="btn dark" onClick={onExportAssets} data-testid="download-assets">下载素材</button>
              <button type="button" className="btn dark" onClick={onEditParams} data-testid="edit-params">编辑参数</button>
            </div>

            <div className="quad">
              <button
                type="button"
                className={`btn ${runningTheme ? 'dark' : 'gray'}`}
                disabled={!runningTheme}
                onClick={onPause}
                data-testid="pause"
              >
                {paused ? '继续' : '暂停'}
              </button>
              <button
                type="button"
                className={`btn ${runningTheme ? 'dark' : 'gray'}`}
                disabled={!runningTheme}
                onClick={onReset}
                data-testid="reset"
              >
                重置
              </button>
              <button type="button" className="btn dark" onClick={onRefresh} data-testid="refresh">刷新</button>
              <button
                type="button"
                className={`btn ${runningTheme ? 'dark' : 'gray'}`}
                disabled={!runningTheme}
                onClick={onRestore}
                data-testid="restore"
              >
                恢复原貌
              </button>
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
