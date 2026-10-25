import { readJson, writeJsonAtomic } from './json-file.mjs';

const DEFAULTS = {
  selectedThemeId: null,
  applyOnStart: false,
  reducedMotion: false,
  lastAppliedThemeId: null,
  localAssetsSeeded: false,
  builtinOverrides: {},
  schedules: [],
  scheduleState: {},
  zcodePath: null,
  hostId: null,
  hostThemes: {}
};

export class ConfigStore {
  constructor(file) {
    this.file = file;
  }

  get() {
    const value = readJson(this.file, null);
    return { ...DEFAULTS, ...(value && typeof value === 'object' ? value : {}) };
  }

  set(patch) {
    const next = { ...this.get(), ...(patch && typeof patch === 'object' ? patch : {}) };
    writeJsonAtomic(this.file, next);
    return next;
  }
}
