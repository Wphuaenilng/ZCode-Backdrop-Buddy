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

export default function SettingsView({ themes, themeId, params, native, minimizeToTray, onMinimizeToTray, prefs, onPreference, onSaveHostPath, schedule, onSaveRule, onRemoveRule, onSelect, onSave, onCancel }) {
  const [form, setForm] = useState(() => normalizeParams(params));
  const theme = themes.find((item) => item.id === themeId) || null;
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
    // Reset the form only when the edited theme changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeId]);

  const patch = (value) => setForm((current) => ({ ...current, ...value }));
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
      <div className="settings-layout">
        <aside className="settings-side">
          <div className="card select-card">
            <div className="card-title">选择主题</div>
            <p className="note" style={{ marginTop: 0 }}>选择内置主题或我的主题，调整显示与取景参数。</p>

            <div className="field">
              <label htmlFor="settingsTheme">主题</label>
              <select
                id="settingsTheme"
                className="select2"
                value={themeId}
                onChange={(event) => onSelect(event.target.value)}
                data-testid="settings-theme"
              >
                {themes.map((theme) => (
                  <option key={theme.id} value={theme.id}>
                    {theme.name} · {theme.builtin ? '内置' : '我的'}
                  </option>
                ))}
              </select>
            </div>

            <p className="note">可修改此主题的显示参数。</p>

            {editable ? (
              <div className="field">
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
                <p className="note">保存后会写回主题库；内置主题的名称不可修改。</p>
              </div>
            ) : null}
          </div>

          {native ? (
            <div className="card app-card">
              <div className="card-title">应用设置</div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={!!minimizeToTray}
                  onChange={(event) => onMinimizeToTray(event.target.checked)}
                  data-testid="set-minimize-to-tray"
                />
                关闭窗口时最小化到托盘
              </label>
              <p className="note">开启后点击关闭按钮不会退出，皮肤继续运行；需要退出时使用托盘菜单中的“退出”。</p>

              <label className="check">
                <input
                  type="checkbox"
                  checked={!!(prefs && prefs.applyOnStart)}
                  onChange={(event) => onPreference && onPreference('applyOnStart', event.target.checked)}
                  data-testid="set-apply-on-start"
                />
                启动时自动应用上次的主题
              </label>
              <p className="note">皮肤没有正在运行时才补应用；宿主没开或已经挂着主题就不动。触发时刻会写进内核日志。</p>

              <label className="check">
                <input
                  type="checkbox"
                  checked={!!(prefs && prefs.reducedMotion)}
                  onChange={(event) => onPreference && onPreference('reducedMotion', event.target.checked)}
                  data-testid="set-reduced-motion"
                />
                减弱动效（视频主题改用首帧静图）
              </label>
              <p className="note">开启后不再往宿主插入播放中的视频，改用主题已有的首帧图；正在运行的主题会立刻重放一次。图片与纯渐变主题不受影响。</p>

              <div className="field" style={{ marginTop: 12 }}>
                <label htmlFor="setZcodePath">ZCode 位置（可选）</label>
                <input
                  id="setZcodePath"
                  className="input"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="留空 = 自动搜索（运行进程 / 注册表 / 开始菜单）"
                  value={hostPath}
                  onChange={(event) => setHostPath(event.target.value)}
                  data-testid="set-zcode-path"
                />
                <div className="save-row">
                  <button
                    type="button"
                    className="btn dark"
                    onClick={() => onSaveHostPath && onSaveHostPath(hostPath)}
                    data-testid="save-zcode-path"
                  >
                    保存位置
                  </button>
                </div>
                <p className="note">ZCode 装在非常规位置、自动搜索失败时，在这里填 ZCode.exe 的完整路径（例如 <code>E:\ZCode\ZCode.exe</code>）；修改后重启 BackdropBuddy 生效，留空恢复自动搜索。环境变量 ZCODE_PATH 优先于此设置。</p>
              </div>
            </div>
          ) : null}

          {native ? (
            <div className="card app-card">
              <div className="card-title">自动切换</div>
              {rules.length ? (
                <ul className="rule-list" data-testid="rule-list">
                  {rules.map((rule) => (
                    <li key={rule.id} className={`rule ${rule.enabled === false ? 'off' : ''}`}>
                      <span className="rule-text">{describeRule(rule)}</span>
                      <span className="rule-kind">{ruleKindLabel[rule.when.kind]}</span>
                      <button
                        type="button"
                        className="link"
                        onClick={() => setDraft({ id: rule.id, kind: rule.when.kind, at: rule.when.at || '22:30', dark: rule.when.dark !== false, themeId: rule.themeId })}
                        data-testid={`rule-edit-${rule.id}`}
                      >
                        改
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
                        删
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="note" style={{ marginTop: 0 }}>还没有规则。到点或明暗变化时，按规则换一个主题。</p>
              )}

              <div className="rule-form">
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

                <div className="field">
                  <label htmlFor="ruleTheme">换成</label>
                  <select id="ruleTheme" className="select2" value={draft.themeId} onChange={(event) => patchDraft({ themeId: event.target.value })} data-testid="rule-theme">
                    {themes.map((item) => (
                      <option key={item.id} value={item.id}>{item.name}</option>
                    ))}
                  </select>
                </div>

                <div className="save-row">
                  <button type="button" className="btn dark" onClick={submitRule} data-testid="rule-save">
                    {draft.id ? '保存修改' : '添加规则'}
                  </button>
                  {draft.id ? (
                    <button type="button" className="btn gray" onClick={() => setDraft({ id: null, kind: 'time', at: '22:30', dark: true, themeId })} data-testid="rule-cancel">
                      取消
                    </button>
                  ) : null}
                </div>
                {nextLabel ? <p className="note">下次到点：{nextLabel}。</p> : null}
                <p className="note">宿主明暗这条靠定期看一眼实现；系统明暗由 Windows 事件直接通知。</p>
              </div>
            </div>
          ) : null}
        </aside>

        <div className="card display-card">
          <div className="card-title">显示与取景参数</div>
          <p className="note" style={{ marginTop: 0 }}>正在使用的主题保存后会刷新；已暂停的皮肤保持暂停。</p>

          <SelectField
            id="set-mode"
            label="外观模式"
            value={form.mode}
            options={MODES}
            onChange={(value) => patch({ mode: value })}
            testId="set-mode"
          />

          <RangeField id="set-x" label="焦点水平位置" value={form.x} onChange={(value) => patch({ x: value })} testId="set-x" />
          <RangeField id="set-y" label="焦点垂直位置" value={form.y} onChange={(value) => patch({ y: value })} testId="set-y" />

          <SelectField
            id="set-safe"
            label="文字安全区"
            value={form.safe}
            options={SAFES}
            onChange={(value) => patch({ safe: value })}
            testId="set-safe"
          />

          <SelectField
            id="set-task"
            label="任务页模式"
            value={form.task}
            options={TASKS}
            onChange={(value) => patch({ task: value })}
            testId="set-task"
          />

          <RangeField
            id="set-bubble"
            label="消息气泡不透明度（用户与助手）"
            value={form.bubble}
            onChange={(value) => patch({ bubble: value })}
            testId="set-bubble"
          />

          <RangeField
            id="set-panel"
            label="面板不透明度（输入框、工具面板等）"
            value={form.panel}
            onChange={(value) => patch({ panel: value })}
            testId="set-panel"
          />

          <ColorField id="set-accent" value={form.accent} onChange={(value) => patch({ accent: value })} />

          <label className="check">
            <input
              type="checkbox"
              checked={!!form.custom}
              onChange={(event) => patch({ custom: event.target.checked })}
              data-testid="set-custom"
            />
            启用自定义取景
          </label>

          <RangeField id="set-h" label="水平位置" value={form.hpos} onChange={(value) => patch({ hpos: value })} testId="set-h" />

          <div className="save-row">
            <button type="button" className="btn gold full" onClick={() => onSave({ ...form, name })} data-testid="save-settings">保存</button>
            <button
              type="button"
              className="btn light full"
              onClick={() => {
                setForm(normalizeParams(params));
                onCancel();
              }}
              data-testid="cancel-settings"
            >
              取消
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
