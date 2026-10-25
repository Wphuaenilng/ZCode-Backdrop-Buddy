const TABS = [
  { id: 'console', label: '控制台' },
  { id: 'import', label: '导入图片' },
  { id: 'settings', label: '主题设置' },
  { id: 'host', label: '接入宿主' }
];

export default function TopBar({ view, onChange, runState, onCheckUpdate }) {
  return (
    <header className="topbar">
      <nav className="tabs" role="tablist" aria-label="页面">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className={`tab${view === tab.id ? ' active' : ''}`}
            aria-selected={view === tab.id}
            data-testid={`tab-${tab.id}`}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className="top-right">
        <div className="run-state">
          <span className={`dot ${runState.cls}`} />
          <span data-testid="run-text">{runState.text}</span>
        </div>
        <button type="button" className="btn dark" onClick={onCheckUpdate}>检查更新</button>
      </div>
    </header>
  );
}
