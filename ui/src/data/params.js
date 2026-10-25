export const TAG_LIST = ['动态', '人物', '动漫', '风景', '城市', '萌宠', '科技', '艺术'];

export const DEFAULT_PARAMS = {
  mode: 'auto',
  x: 50,
  y: 50,
  zoom: 100,
  hpos: 0,
  safe: 'auto',
  task: 'auto',
  bubble: 0,
  panel: 30,
  accent: '#6F9275',
  lock: true,
  custom: false
};

export function normalizeParams(params) {
  return { ...DEFAULT_PARAMS, ...(params && typeof params === 'object' ? params : {}) };
}

export const P = (overrides = {}) => ({ ...DEFAULT_PARAMS, ...overrides });

export const clamp = (value, min, max) =>
  Math.min(max, Math.max(min, Number.isFinite(+value) ? +value : min));

export const HEX = /^#[0-9a-f]{6}$/i;
