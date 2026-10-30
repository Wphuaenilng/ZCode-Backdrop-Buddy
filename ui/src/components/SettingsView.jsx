import { useEffect, useState } from 'react';
import { ColorField, RangeField, SelectField } from './Fields.jsx';
import { normalizeParams } from '../data/params.js';

const MODES = [
  { value: 'auto', label: '自动' },
  { value: 'cover', label: '铺满' },
  { value: 'contain', label: '适应' },
  { value: 'stretch', label: '拉伸' }
];

const SAFES = [
  { value: 'auto', label: '自动' },
  { value: 'left', label: '左侧' },
  { value: 'right', label: '右侧' },
  { value: 'center', label: '居中' },
  { value: 'off', label: '关闭' }
];

const TASKS = [
  { value: 'auto', label: '自动' },
  { value: 'ambient', label: '氛围' },
  { value: 'focus', label: '聚焦' }
];

const DEFAULT_STARTUP = { enabled: false, preset: 'zcode-pop', holdMs: 900, media: null };
const PRESETS = [
  { value: 'zcode-pop', label: 'ZCode 弹入' },
  { value: 'theme-reveal', label: '主题揭幕' }
];

export default function SettingsView({ themes, themeId, params, native, bridge, minimizeToTray, onMinimizeToTray, prefs, onPreference, onHostStartup, activeHostName, onSaveHostPath, schedule, onSaveRule, onRemoveRule, onSelect, onSave, onCancel }) {
  const theme = themes.find((item) => item.id === themeId) || null;
  const [form, setForm] = useState(() => normalizeParams(params));
  const [startup, setStartup] = useState(() => ({ ...DEFAULT_STARTUP, ...theme?.startup }));
  const [activeTab, setActiveTab] = useState('theme');
  const [previewing, setPreviewing] = useState(false);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewError, setPreviewError] = useState('');
  const [name, setName] = useState(() => theme?.name || '');
  const editable = !!theme && !theme.builtin;
  const [draft, setDraft] = useState({ id: null, kind: 'time', at: '22:30', dark: true, themeId: themeId });
  const [hostPath, setHostPath] = useState(() => prefs?.zcodePath || '');

  useEffect(() => {
    setHostPath(prefs?.zcodePath || '');
  }, [prefs?.zcodePath]);

  useEffect(() => {
    setForm(normalizeParams(params));
    setName(theme?.name || '');
    setStartup({ ...DEFAULT_STARTUP, ...theme?.startup });
    setPreviewing(false);
    // Reset the form only when the edited theme changes.
    // （不装 eslint-plugin-react-hooks，故无 disable 注释；有意只依赖 themeId）
  }, [themeId]);

  useEffect(() => {
    if (!previewing || !native) return undefined;
    let alive = true;
    setPreviewUrl(null);
    setPreviewError('');
    bridge.request('theme.startup.preview', { themeId }).then((result) => {
      if (!alive) return;
      if (result.ok) setPreviewUrl(result.data?.url || null);
      else setPreviewError(result.error?.message || result.error?.code || '预览生成失败');
    });
    return () => { alive = false; };
  }, [previewing, previewKey, themeId, native, bridge]);

  const patch = (value) => setForm((current) => ({ ...current, ...value }));
  const patchStartup = (value) => setStartup((current) => ({ ...current, ...value }));
  const patchDraft = (value) => setDraft((current) => ({ ...current, ...value }));

  const rules = (schedule && schedule.rules) || [];
  const ruleKindLabel = { time: '每天定时', hostTheme: '宿主明暗', systemTheme: '系统明暗' };
  const describeRule = (rule) => {
    const target = themes.find((item) => item.id === rule.themeId);
    const nameText = target ? target.name : (rule.themeId || '已删除的主题');
    if (rule.when.kind === 'time') return `每天 ${rule.when.at} · ${nameText}`;
    const mode = rule.when.dark ? '深色' : '浅色';
    return `${rule.when.kind === 'hostTheme' ? '宿主切到' : '系统切到'}${mode} · ${nameText}`;
  };
  const nextLabel = schedule && schedule.nextTriggerAt
    ? new Date(schedule.nextTriggerAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : null;

  const submitRule = async () => {
    const target = themes.find((item) => item.id === draft.themeId) || null;
    if (!target) return;
    const label = draft.kind === 'time' ? `每天 ${draft.at}` : `${draft.kind === 'hostTheme' ? '宿主' : '系统'}${draft.dark ? '深色' : '浅色'}`;
    const ok = await onSaveRule({
      id: draft.id || undefined,
      name: `${label} · ${target.name}`.slice(0, 40),
      enabled: true,
      themeId: target.id,
      when: draft.kind === 'time' ? { kind: 'time', at: draft.at } : { kind: draft.kind, dark: draft.dark }
    });
    if (ok) setDraft({ id: null, kind: 'time', at: '22:30', dark: true, themeId: target.id });
  };

  return (
    <section className="view" data-testid="view-settings">
      {previewing ? (
        <div className="startup-preview-backdrop" role="presentation" onClick={() => setPreviewing(false)}>
          <div className="startup-preview" role="dialog" aria-modal="true" aria-label="宿主启动动画预览" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === 'Escape') setPreviewing(false); }}>
            {previewUrl ? <iframe key={previewKey} title="启动动画沙盒预览" sandbox="allow-scripts" src={previewUrl} /> : <div className="startup-preview-loading">{previewError || '正在生成安全预览…'}</div>}
            <button type="button" className="startup-preview-skip" autoFocus onClick={() => setPreviewing(false)}>关闭预览 · Esc</button>
          </div>
        </div>
      ) : null}
      <div className="settings-layout">
        <header className="settings-header">
          <div>
            <div className="section-title">主题设置</div>
            <p>调整当前主题，或管理应用行为与自动切换规则。</p>
          </div>
          {activeTab === 'theme' ? <span className="settings-context">正在编辑：{theme?.name}</span> : null}
        </header>

        <nav className="settings-tabs" role="tablist" aria-label="设置分类">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'theme'}
            aria-controls="settings-panel-theme"
            className={activeTab === 'theme' ? 'active' : ''}
            onClick={() => setActiveTab('theme')}
            data-testid="settings-tab-theme"
          >
            主题参数
          </button>
          {native ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'preferences'}
              aria-controls="settings-panel-preferences"
              className={activeTab === 'preferences' ? 'active' : ''}
              onClick={() => setActiveTab('preferences')}
              data-testid="settings-tab-preferences"
            >
              应用偏好
            </button>
          ) : null}
          {native ? (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'schedule'}
              aria-controls="settings-panel-schedule"
              className={activeTab === 'schedule' ? 'active' : ''}
              onClick={() => setActiveTab('schedule')}
              data-testid="settings-tab-schedule"
            >
              自动切换
              {rules.length ? <span className="tab-count">{rules.length}</span> : null}
            </button>
          ) : null}
        </nav>

        {activeTab === 'theme' ? (
          <div className="settings-card theme-settings" id="settings-panel-theme" role="tabpanel">
            <div className="theme-editor-head">
              <div className="field theme-selector">
                <label htmlFor="settingsTheme">选择要编辑的主题</label>
                <select
                  id="settingsTheme"
                  className="select2"
                  value={themeId}
                  onChange={(event) => onSelect(event.target.value)}
                  data-testid="settings-theme"
                >
                  {themes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {item.builtin ? '内置' : '我的'}
                    </option>
                  ))}
                </select>
              </div>
              {editable ? (
                <div className="field theme-name-field">
                  <label htmlFor="settingsName">主题名称</label>
                  <input
                    id="settingsName"
                    className="input"
                    maxLength={24}
                    autoComplete="off"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    data-testid="settings-name"
                  />
                </div>
              ) : null}
              <span className="theme-type">{theme?.builtin ? '内置主题' : '我的主题'}</span>
            </div>

            <div className="form-scroll settings-form-scroll">
              <section className="settings-group">
                <div className="settings-group-head">
                  <h3>画面与布局</h3>
                  <p>控制底图铺放方式，以及宿主界面的整体呈现。</p>
                </div>
                <div className="settings-fields three">
                  <SelectField id="set-mode" label="外观模式" value={form.mode} options={MODES} onChange={(value) => patch({ mode: value })} testId="set-mode" />
                  <SelectField id="set-safe" label="文字安全区" value={form.safe} options={SAFES} onChange={(value) => patch({ safe: value })} testId="set-safe" />
                  <SelectField id="set-task" label="任务页模式" value={form.task} options={TASKS} onChange={(value) => patch({ task: value })} testId="set-task" />
                </div>
              </section>

              <section className="settings-group">
                <div className="settings-group-head">
                  <h3>取景位置</h3>
                  <p>调整视觉焦点；需要更精细的位置时再启用自定义取景。</p>
                </div>
                <div className="settings-fields">
                  <RangeField id="set-x" label="焦点水平位置" value={form.x} onChange={(value) => patch({ x: value })} testId="set-x" />
                  <RangeField id="set-y" label="焦点垂直位置" value={form.y} onChange={(value) => patch({ y: value })} testId="set-y" />
                  <label className="check custom-framing">
                    <input
                      type="checkbox"
                      checked={!!form.custom}
                      onChange={(event) => patch({ custom: event.target.checked })}
                      data-testid="set-custom"
                    />
                    启用自定义取景
                  </label>
                  <RangeField id="set-h" label="水平位置" value={form.hpos} onChange={(value) => patch({ hpos: value })} testId="set-h" />
                </div>
              </section>

              <section className="settings-group startup-config-group">
                <div className="settings-group-head">
                  <h3>宿主启动动画</h3>
                  <p>下次由 BackdropBuddy 启动 ZCode 时生效，不改变 BackdropBuddy 自己的启动画面。</p>
                </div>
                <label className="check startup-enabled">
                  <input type="checkbox" checked={startup.enabled} disabled={!native || !editable} onChange={(event) => patchStartup({ enabled: event.target.checked })} data-testid="set-theme-startup-enabled" />
                  为此主题启用启动动画
                </label>
                <div className="settings-fields startup-config-fields">
                  <SelectField id="set-startup-preset" label="固定预设" value={startup.preset} options={PRESETS} disabled={!native || !editable} onChange={(value) => patchStartup({ preset: value })} testId="set-startup-preset" />
                  <div className="field">
                    <label htmlFor="set-startup-hold">最短停留（900–3000 毫秒）</label>
                    <input id="set-startup-hold" className="input" type="number" min="900" max="3000" step="100" value={startup.holdMs} disabled={!native || !editable} onChange={(event) => patchStartup({ holdMs: Number(event.target.value) })} data-testid="set-startup-hold" />
                  </div>
                </div>
                <div className="startup-actions">
                  <button type="button" className="btn light" disabled={!native} onClick={() => { setPreviewKey((value) => value + 1); setPreviewing(true); }} data-testid="preview-theme-startup">预览已保存效果</button>
                </div>
                <p className="note">主题缩略图会用作背景；没有合适静图时使用深色渐变。预览与宿主使用同一模板，修改后先保存再预览。900ms 后可跳过；宿主未就绪或正文未挂载时最长约 20 秒交还。</p>
                {theme?.builtin ? <p className="note">内置主题的启动配置为只读；可在自己的主题上启用。</p> : null}
              </section>

              <section className="settings-group last">
                <div className="settings-group-head">
                  <h3>界面可读性</h3>
                  <p>平衡背景可见度与文字、面板的清晰程度。</p>
                </div>
                <div className="settings-fields three readability-fields">
                  <RangeField
                    id="set-bubble"
                    label="消息气泡不透明度"
                    value={form.bubble}
                    onChange={(value) => patch({ bubble: value })}
                    testId="set-bubble"
                  />
                  <RangeField
                    id="set-panel"
                    label="面板不透明度"
                    value={form.panel}
                    onChange={(value) => patch({ panel: value })}
                    testId="set-panel"
                  />
                  <ColorField id="set-accent" value={form.accent} onChange={(value) => patch({ accent: value })} />
                </div>
              </section>
            </div>

            <div className="settings-savebar">
              <span>保存后刷新正在使用的主题；已暂停的皮肤保持暂停。</span>
              <div>
                <button
                  type="button"
                  className="btn light"
                  onClick={() => {
                    setForm(normalizeParams(params));
                    onCancel();
                  }}
                  data-testid="cancel-settings"
                >
                  取消
                </button>
                <button type="button" className="btn gold" onClick={() => onSave({ ...form, name, startup })} data-testid="save-settings">保存主题参数</button>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === 'preferences' && native ? (
          <div className="settings-card preferences-card" id="settings-panel-preferences" role="tabpanel">
            <div className="settings-panel-head">
              <div>
                <h2>应用偏好</h2>
                <p>这些选项会立即保存，不影响主题本身的显示参数。</p>
              </div>
              <span className="autosave-badge">更改即保存</span>
            </div>
            <div className="form-scroll preferences-scroll">
              <div className="preference-list">
                <label className="preference-item">
                  <span>
                    <strong>关闭窗口时最小化到托盘</strong>
                    <small>皮肤继续运行；需要退出时，使用托盘菜单中的“退出”。</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={!!minimizeToTray}
                    onChange={(event) => onMinimizeToTray(event.target.checked)}
                    data-testid="set-minimize-to-tray"
                  />
                </label>
                <label className="preference-item">
                  <span>
                    <strong>启动时自动应用上次的主题</strong>
                    <small>仅在皮肤未运行时补应用；宿主未开或已有主题时不做改动。</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={!!(prefs && prefs.applyOnStart)}
                    onChange={(event) => onPreference && onPreference('applyOnStart', event.target.checked)}
                    data-testid="set-apply-on-start"
                  />
                </label>
                <label className="preference-item">
                  <span>
                    <strong>减弱动效</strong>
                    <small>视频主题改用首帧静图；图片与纯渐变主题不受影响。</small>
                  </span>
                  <input
                    type="checkbox"
                    checked={!!(prefs && prefs.reducedMotion)}
                    onChange={(event) => onPreference && onPreference('reducedMotion', event.target.checked)}
                    data-testid="set-reduced-motion"
                  />
                </label>
              </div>

              <section className="settings-group startup-anim-group">
                <div className="settings-group-head">
                  <h3>启动宿主</h3>
                  <p>通过 BackdropBuddy 启动 / 重启 {activeHostName || '宿主'}，并应用当前主题的启动配置。</p>
                </div>
                <div className="startup-actions">
                  <button type="button" className="btn dark" disabled={!native} onClick={onHostStartup} data-testid="launch-host-startup">启动 / 重启宿主</button>
                </div>
                <p className="note">请先在“主题参数”中保存启动配置。直接双击宿主图标不会触发；注入失败会静默回退，不影响宿主和皮肤。</p>
              </section>

              <section className="settings-group host-path-group">
                <div className="settings-group-head">
                  <h3>ZCode 位置（可选）</h3>
                  <p>仅在自动搜索失败时填写 ZCode.exe 的完整路径；留空会恢复自动搜索。</p>
                </div>
                <div className="host-path-row">
                  <input
                    id="setZcodePath"
                    className="input"
                    aria-label="ZCode 位置"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="留空 = 自动搜索（运行进程 / 注册表 / 开始菜单）"
                    value={hostPath}
                    onChange={(event) => setHostPath(event.target.value)}
                    data-testid="set-zcode-path"
                  />
                  <button
                    type="button"
                    className="btn dark"
                    onClick={() => onSaveHostPath && onSaveHostPath(hostPath)}
                    data-testid="save-zcode-path"
                  >
                    保存位置
                  </button>
                </div>
                <p className="note">修改后重启 BackdropBuddy 生效；环境变量 ZCODE_PATH 优先于此设置。</p>
              </section>
            </div>
          </div>
        ) : null}

        {activeTab === 'schedule' && native ? (
          <div className="settings-card schedule-card" id="settings-panel-schedule" role="tabpanel">
            <div className="settings-panel-head">
              <div>
                <h2>自动切换</h2>
                <p>在指定时间或明暗模式变化时，自动应用目标主题。</p>
              </div>
              {nextLabel ? <span className="next-trigger">下次触发：{nextLabel}</span> : <span className="autosave-badge">{rules.length} 条规则</span>}
            </div>
            <div className="schedule-layout form-scroll">
              <section className="schedule-rules">
                <div className="schedule-section-title">
                  <h3>规则列表</h3>
                  <span>{rules.length} 条</span>
                </div>
                {rules.length ? (
                  <ul className="rule-list" data-testid="rule-list">
                    {rules.map((rule) => (
                      <li key={rule.id} className={`rule ${rule.enabled === false ? 'off' : ''}`}>
                        <div className="rule-main">
                          <span className="rule-text">{describeRule(rule)}</span>
                          <span className="rule-kind">{ruleKindLabel[rule.when.kind]}</span>
                        </div>
                        <div className="rule-actions">
                          <button
                            type="button"
                            className="link"
                            onClick={() => setDraft({ id: rule.id, kind: rule.when.kind, at: rule.when.at || '22:30', dark: rule.when.dark !== false, themeId: rule.themeId })}
                            data-testid={`rule-edit-${rule.id}`}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="link"
                            onClick={() => onSaveRule({ ...rule, enabled: rule.enabled === false })}
                            data-testid={`rule-toggle-${rule.id}`}
                          >
                            {rule.enabled === false ? '启用' : '停用'}
                          </button>
                          <button
                            type="button"
                            className="link danger"
                            onClick={() => onRemoveRule(rule.id)}
                            data-testid={`rule-remove-${rule.id}`}
                          >
                            删除
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="schedule-empty">
                    <strong>还没有自动切换规则</strong>
                    <span>在右侧添加一条规则，就能按时或随明暗变化换主题。</span>
                  </div>
                )}
              </section>

              <section className="rule-form">
                <div className="schedule-section-title">
                  <h3>{draft.id ? '编辑规则' : '添加规则'}</h3>
                  {draft.id ? <span>修改现有规则</span> : null}
                </div>
                <div className="schedule-form-grid">
                  <div className="field">
                    <label htmlFor="ruleKind">触发条件</label>
                    <select id="ruleKind" className="select2" value={draft.kind} onChange={(event) => patchDraft({ kind: event.target.value })} data-testid="rule-kind">
                      <option value="time">每天到点</option>
                      <option value="hostTheme">宿主切明暗</option>
                      <option value="systemTheme">系统切明暗</option>
                    </select>
                  </div>

                  {draft.kind === 'time' ? (
                    <div className="field">
                      <label htmlFor="ruleAt">时间</label>
                      <input id="ruleAt" className="input" type="time" value={draft.at} onChange={(event) => patchDraft({ at: event.target.value })} data-testid="rule-at" />
                    </div>
                  ) : (
                    <div className="field">
                      <label htmlFor="ruleDark">切成哪一面时</label>
                      <select id="ruleDark" className="select2" value={draft.dark ? 'dark' : 'light'} onChange={(event) => patchDraft({ dark: event.target.value === 'dark' })} data-testid="rule-dark">
                        <option value="dark">深色</option>
                        <option value="light">浅色</option>
                      </select>
                    </div>
                  )}

                  <div className="field rule-theme-field">
                    <label htmlFor="ruleTheme">换成主题</label>
                    <select id="ruleTheme" className="select2" value={draft.themeId} onChange={(event) => patchDraft({ themeId: event.target.value })} data-testid="rule-theme">
                      {themes.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="rule-form-actions">
                  <button type="button" className="btn gold" onClick={submitRule} data-testid="rule-save">
                    {draft.id ? '保存修改' : '添加规则'}
                  </button>
                  {draft.id ? (
                    <button type="button" className="btn light" onClick={() => setDraft({ id: null, kind: 'time', at: '22:30', dark: true, themeId })} data-testid="rule-cancel">
                      取消编辑
                    </button>
                  ) : null}
                </div>
                <p className="note">宿主明暗通过定期检测实现；系统明暗由 Windows 事件直接通知。</p>
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
