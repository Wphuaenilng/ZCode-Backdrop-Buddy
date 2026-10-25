import { resolveProfile as resolveZcode } from './zcode.mjs';
import { resolveProfile as resolveObsidian } from './obsidian.mjs';
import { createGenericProfile } from './generic.mjs';
import { loadUserProfiles } from './user-profiles.mjs';

// 宿主注册表：内置宿主 + 用户通过接入向导保存的 profile（纯数据）。
const BUILTIN = Object.freeze({
  zcode: { id: 'zcode', name: 'ZCode', resolve: resolveZcode },
  obsidian: { id: 'obsidian', name: 'Obsidian', resolve: resolveObsidian }
});

export function createRegistry({ hostsDir = null } = {}) {
  const users = new Map();
  if (hostsDir) {
    for (const data of loadUserProfiles(hostsDir)) users.set(data.id, data);
  }

  function userProfile(id) {
    const data = users.get(id);
    return data ? createGenericProfile(data) : null;
  }

  return {
    list() {
      const builtins = Object.values(BUILTIN).map((host) => ({ id: host.id, name: host.name, source: 'builtin' }));
      const custom = [...users.values()].map((data) => ({ id: data.id, name: data.name, source: 'user', port: data.port }));
      return [...builtins, ...custom];
    },
    get(id) {
      const key = String(id || '').toLowerCase();
      if (BUILTIN[key]) return BUILTIN[key].resolve(process.env);
      return userProfile(key);
    },
    resolve(env = process.env, configHostId = null) {
      const key = String(env.BACKDROPBUDDY_HOST || configHostId || 'zcode').toLowerCase();
      if (BUILTIN[key]) return BUILTIN[key].resolve(env);
      const profile = userProfile(key);
      if (!profile) {
        const known = [...Object.keys(BUILTIN), ...users.keys()].join(' / ');
        throw new Error(`unknown host "${key}"，可选：${known}`);
      }
      return profile;
    },
    reload() {
      users.clear();
      if (!hostsDir) return;
      for (const data of loadUserProfiles(hostsDir)) users.set(data.id, data);
    }
  };
}

// 兼容旧调用：默认注册表不含用户 profile。
const defaultRegistry = createRegistry();

export function listHosts() {
  return defaultRegistry.list();
}

export function hostById(id) {
  return defaultRegistry.get(id);
}

export function resolveProfile(env = process.env, configHostId = null) {
  return defaultRegistry.resolve(env, configHostId);
}
