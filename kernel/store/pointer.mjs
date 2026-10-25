import { readJson, writeJsonAtomic } from './json-file.mjs';

const DEFAULT_POINTER = {
  activeThemeId: null,
  activeName: null,
  params: null,
  paused: false,
  revision: 0,
  updatedAt: null
};

export class PointerStore {
  constructor(file) {
    this.file = file;
  }

  read() {
    const value = readJson(this.file, null);
    if (!value || typeof value !== 'object') return { ...DEFAULT_POINTER };
    return { ...DEFAULT_POINTER, ...value };
  }

  write(next) {
    const current = this.read();
    const value = {
      activeThemeId: next.activeThemeId ?? null,
      activeName: next.activeName ?? (next.activeThemeId ? current.activeName : null),
      params: next.params ?? (next.activeThemeId ? current.params : null),
      paused: !!next.paused,
      revision: current.revision + 1,
      updatedAt: new Date().toISOString()
    };
    writeJsonAtomic(this.file, value);
    return value;
  }

  clear() {
    return this.write({ activeThemeId: null, paused: false });
  }
}
