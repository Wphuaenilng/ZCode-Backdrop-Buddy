import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function isWindows() {
  return process.platform === 'win32';
}

export function resolveDataRoot(env = process.env) {
  if (env.BACKDROPBUDDY_DATA_DIR) return path.resolve(env.BACKDROPBUDDY_DATA_DIR);
  if (env.LOCALAPPDATA) return path.join(env.LOCALAPPDATA, 'BackdropBuddy');
  return path.join(os.homedir(), '.backdropbuddy');
}

export function resolveAppRoot(env = process.env) {
  if (env.BACKDROPBUDDY_APP_ROOT) return path.resolve(env.BACKDROPBUDDY_APP_ROOT);
  return process.cwd();
}

export function resolveLogLevel(env = process.env) {
  return env.BACKDROPBUDDY_LOG_LEVEL || 'info';
}

export function resolveProductVersion(appRoot, env = process.env) {
  if (env.BACKDROPBUDDY_VERSION) return String(env.BACKDROPBUDDY_VERSION);

  const candidates = [
    path.join(appRoot, 'VERSION'),
    path.join(appRoot, 'build', 'version.json')
  ];

  for (const file of candidates) {
    try {
      const text = fs.readFileSync(file, 'utf8').trim();
      if (!text) continue;
      if (file.endsWith('.json')) {
        const parsed = JSON.parse(text);
        if (parsed && parsed.version) return String(parsed.version);
        continue;
      }
      return text;
    } catch { /* try the next candidate */ }
  }

  return '1.0.0';
}
