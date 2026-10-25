import { TAGS } from '../schema/common.mjs';

export const RECORD_SCHEMA = 'backdropbuddy.theme/1';

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

export function normalizeParams(value = {}) {
  return { ...DEFAULT_PARAMS, ...(value && typeof value === 'object' ? value : {}) };
}

export function normalizeTags(value) {
  const tags = Array.isArray(value) ? value.filter((tag) => TAGS.includes(tag)) : [];
  return tags.length ? tags : ['艺术'];
}

export function isValidThemeId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

export function newThemeId(now = Date.now(), random = Math.random()) {
  return `my-${now.toString(36)}-${random.toString(36).slice(2, 6)}`;
}

export function createRecord({
  id,
  name,
  tags,
  params,
  media = null,
  source = 'user',
  createdAt = Date.now(),
  updatedAt = createdAt
}) {
  if (!isValidThemeId(id)) {
    const error = new Error(`invalid theme id: ${id}`);
    error.code = 'BAD_PARAMS';
    throw error;
  }
  if (typeof name !== 'string' || !name.trim()) {
    const error = new Error('theme name is required');
    error.code = 'BAD_PARAMS';
    throw error;
  }

  return {
    schema: RECORD_SCHEMA,
    id,
    name: name.trim().slice(0, 24),
    tags: normalizeTags(tags),
    params: normalizeParams(params),
    media: media || null,
    source,
    createdAt,
    updatedAt
  };
}

export function normalizeRecord(raw, { source = 'user' } = {}) {
  if (!raw || typeof raw !== 'object') return null;
  try {
    return createRecord({
      id: raw.id,
      name: raw.name,
      tags: raw.tags,
      params: raw.params,
      media: raw.media || null,
      source: raw.source || source,
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now()
    });
  } catch {
    return null;
  }
}
