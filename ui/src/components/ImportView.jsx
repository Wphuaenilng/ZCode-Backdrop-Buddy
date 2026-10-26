import { useRef } from 'react';
import HostPreview from './HostPreview.jsx';
import { ColorField, RangeField, SelectField } from './Fields.jsx';
import { TAG_LIST } from '../data/params.js';

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
  { value: 'center', label: '居中' }
];

const TASKS = [
  { value: 'auto', label: '自动' },
  { value: 'ambient', label: '氛围' },
  { value: 'focus', label: '聚焦' }
];

export default function ImportView({ draft, native, onDraft, onParams, onToggleTag, onFile, onPick, onSave, onCancel }) {
  const fileInput = useRef(null);
  const params = draft.params;

  const previewTheme = {
    name: draft.name || '导入预览',
    imageSrc: draft.isVideo ? '' : draft.src,
    videoSrc: draft.isVideo ? draft.src : '',
    bg: ''
  };

  return (
    <section className="view" data-testid="view-import">
      <div className="import-layout">
        <div className="import-left">
          <div className="card tags-card">
            <div className="card-title">标签（可多选）</div>
            <div className="tags" data-testid="import-tags">
              {TAG_LIST.map((tag) => (
                <label key={tag}>
                  <input
                    type="checkbox"
                    checked={draft.tags.includes(tag)}
                    onChange={(event) => onToggleTag(tag, event.target.checked)}
                    data-testid={`tag-${tag}`}
                  />
                  {tag}
                </label>
              ))}
            </div>
            <p className="note">可同时选择多个分类；未选择时归入艺术。</p>
          </div>

          <div className="import-preview-wrap">
            <HostPreview theme={previewTheme} params={params} locked large />
          </div>
        </div>

        <aside className="settings-card" id="importPanel">
          <div className="form-scroll">
            <div className="field">
            <label htmlFor="importName">主题名称</label>
            <input
              id="importName"
              className="input"
              placeholder="给这个主题起个名字"
              maxLength={24}
              autoComplete="off"
              value={draft.name}
              onChange={(event) => onDraft({ name: event.target.value })}
              data-testid="import-name"
            />
          </div>

          <div className="field">
            <label>背景图片或视频</label>
            <div className="file-row">
              <input
                className="input"
                readOnly
                placeholder="选择图片 / 视频"
                value={(draft.src || draft.path) ? (draft.isVideo ? '已选择视频' : '已选择图片') : ''}
                data-testid="import-file-name"
              />
              <button type="button" className="btn dark" onClick={() => (native ? onPick() : fileInput.current?.click())} data-testid="choose-file">
                选择文件
              </button>
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*,video/*"
              hidden
              data-testid="file-input"
              onChange={(event) => {
                const file = event.target.files && event.target.files[0];
                if (file) onFile(file);
                event.target.value = '';
              }}
            />
          </div>

          <SelectField
            id="import-mode"
            label="外观模式"
            value={params.mode}
            options={MODES}
            onChange={(value) => onParams({ mode: value })}
            testId="import-mode"
          />

          <RangeField id="import-x" label="水平位置" value={params.x} onChange={(value) => onParams({ x: value })} testId="import-x" />
          <RangeField id="import-y" label="垂直位置" value={params.y} onChange={(value) => onParams({ y: value })} testId="import-y" />
          <RangeField id="import-zoom" label="缩放" value={params.zoom} min={100} max={220} onChange={(value) => onParams({ zoom: value })} testId="import-zoom" />

          <div className="lock-row">
            <button
              type="button"
              className={`btn ${params.lock ? 'dark active' : 'light'}`}
              onClick={() => onParams({ lock: true })}
              data-testid="lock-in"
            >
              锁定区域内
            </button>
            <button
              type="button"
              className={`btn ${!params.lock ? 'dark active' : 'light'}`}
              onClick={() => onParams({ lock: false })}
              data-testid="lock-out"
            >
              不锁定区域
            </button>
            <button
              type="button"
              className="btn light"
              onClick={() => onParams({ x: 0, y: 0, zoom: 100 })}
              data-testid="reset-crop"
            >
              复位
            </button>
          </div>

          <SelectField
            id="import-safe"
            label="文字安全区"
            value={params.safe}
            options={SAFES}
            onChange={(value) => onParams({ safe: value })}
            testId="import-safe"
          />

          <SelectField
            id="import-task"
            label="任务页模式"
            value={params.task}
            options={TASKS}
            onChange={(value) => onParams({ task: value })}
            testId="import-task"
          />

          <RangeField
            id="import-bubble"
            label="消息气泡不透明度（用户与助手）"
            value={params.bubble}
            onChange={(value) => onParams({ bubble: value })}
            testId="import-bubble"
          />

          <RangeField
            id="import-panel"
            label="面板不透明度（输入框、工具面板等）"
            value={params.panel}
            onChange={(value) => onParams({ panel: value })}
            testId="import-panel"
          />

          <ColorField id="import-accent" value={params.accent} onChange={(value) => onParams({ accent: value })} />

          <label className="check">
            <input
              type="checkbox"
              checked={!!params.custom}
              onChange={(event) => onParams({ custom: event.target.checked })}
              data-testid="import-custom"
            />
            启用自定义取景
          </label>
          </div>

          <div className="save-row">
            <button type="button" className="btn gold full" onClick={onSave} data-testid="save-theme">保存为主题</button>
            <button type="button" className="btn light full" onClick={onCancel} data-testid="cancel-import">取消</button>
          </div>
        </aside>
      </div>
    </section>
  );
}
