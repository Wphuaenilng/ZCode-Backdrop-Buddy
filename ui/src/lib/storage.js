import { BUILTINS, LOCAL_THEMES, isNative } from '../data/themes.js';
import { TAG_LIST, normalizeParams } from '../data/params.js';

const STORE_KEY = 'bb.theme.v3';

function sanitizeTags(value) {
  const tags = Array.isArray(value) ? value.filter((tag) => TAG_LIST.includes(tag)) : [];
  return tags.length ? tags : ['艺术'];
}

function sanitizeTheme(raw) {
  if (!raw || typeof raw !== 'object' || !raw.id || !raw.name) return null;

  const theme = {
    id: String(raw.id).slice(0, 64),
    name: String(raw.name).slice(0, 24),
    tags: sanitizeTags(raw.tags),
    dot: typeof raw.dot === 'string' ? raw.dot : '#6F9275',
    builtin: false,
    local: !!raw.local,
    imageFile: typeof raw.imageFile === 'string' ? raw.imageFile : '',
    videoFile: typeof raw.videoFile === 'string' ? raw.videoFile : '',
    video: !!raw.video || !!raw.videoFile,
    image: typeof raw.image === 'string' ? raw.image : (typeof raw.imageSrc === 'string' ? raw.imageSrc : ''),
    bg: typeof raw.bg === 'string' ? raw.bg : '',
    videoSrc: '',
    needsFile: !!raw.video && !raw.videoFile,
    params: normalizeParams(raw.params),
    at: Number(raw.at) || Date.now()
  };

  if (!theme.image && !theme.imageFile && !theme.bg && !theme.video && !theme.videoFile) return null;
  return theme;
}

function seedLocals(existing) {
  const seeded = LOCAL_THEMES
    .filter((theme) => !existing.some((item) => item.id === theme.id))
    .map((theme) => ({
      ...theme,
      tags: [...theme.tags],
      params: { ...theme.params },
      at: Date.now()
    }));

  return [...existing, ...seeded];
}

function readRaw() {
  try {
    const current = localStorage.getItem(STORE_KEY);
    if (current) return JSON.parse(current);
  } catch {
    // Corrupt or unavailable storage falls back to an empty library.
  }

  return null;
}

export function loadLibrary() {
  const raw = readRaw();

  if (!raw) {
    return {
      my: isNative() ? [] : seedLocals([]),
      hidden: [],
      overrides: {},
      selectedId: 'forest',
      seeded: true
    };
  }

  let my = Array.isArray(raw.my) ? raw.my.map(sanitizeTheme).filter(Boolean) : [];
  if (!raw.seeded && !isNative()) my = seedLocals(my);

  const hidden = Array.isArray(raw.hidden)
    ? raw.hidden.filter((id) => BUILTINS.some((theme) => theme.id === id))
    : [];

  const overrides = {};
  if (raw.overrides && typeof raw.overrides === 'object') {
    for (const id of Object.keys(raw.overrides)) {
      if (BUILTINS.some((theme) => theme.id === id)) overrides[id] = normalizeParams(raw.overrides[id]);
    }
  }

  const selectedId = typeof raw.selectedId === 'string' ? raw.selectedId : 'forest';

  return { my, hidden, overrides, selectedId, seeded: true };
}

export function saveLibrary(library) {
  try {
    const my = library.my.map((theme) => {
      const out = {
        id: theme.id,
        name: theme.name,
        tags: theme.tags,
        dot: theme.dot,
        builtin: false,
        local: !!theme.local,
        params: theme.params,
        at: theme.at
      };

      if (theme.imageFile) out.imageFile = theme.imageFile;
      if (theme.videoFile) out.videoFile = theme.videoFile;
      if (theme.video) out.video = true;
      if (theme.image) out.image = theme.image;
      if (theme.bg) out.bg = theme.bg;
      if (theme.video && !theme.videoFile) out.needsFile = true;

      return out;
    });

    localStorage.setItem(STORE_KEY, JSON.stringify({
      my,
      hidden: library.hidden,
      overrides: library.overrides,
      selectedId: library.selectedId,
      seeded: true
    }));

    return true;
  } catch {
    return false;
  }
}
