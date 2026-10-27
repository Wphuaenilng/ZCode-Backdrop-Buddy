import fs from 'node:fs';
import path from 'node:path';

export function resolvePaths({ dataRoot, appRoot }) {
  const root = path.resolve(dataRoot);
  const themes = path.join(root, 'themes');

  return {
    root,
    themes,
    builtin: path.join(themes, 'builtin'),
    user: path.join(themes, 'user'),
    staging: path.join(themes, 'staging'),
    cache: path.join(root, 'cache'),
    backup: path.join(root, 'backup'),
    logs: path.join(root, 'logs'),
    config: path.join(root, 'config.json'),
    startupAnimation: path.join(root, 'startup-animation.json'),
    pointer: path.join(themes, 'pointer.json'),
    runtime: path.join(themes, 'runtime.json'),
    hosts: path.join(root, 'hosts'),
    appRoot: path.resolve(appRoot),
    assets: path.join(path.resolve(appRoot), 'assets')
  };
}

export function ensureDirs(paths) {
  for (const dir of [paths.root, paths.themes, paths.builtin, paths.user, paths.staging, paths.cache, paths.backup, paths.logs, paths.hosts]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function assertInside(root, candidate) {
  const base = path.resolve(root);
  const target = path.resolve(candidate);
  if (target !== base && !target.startsWith(base + path.sep)) {
    const error = new Error(`path escapes ${base}`);
    error.code = 'PATH_OUTSIDE_ROOT';
    throw error;
  }
  return target;
}

export function safeSegment(value) {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
}
