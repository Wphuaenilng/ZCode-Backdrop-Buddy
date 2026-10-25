import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export function execFileAsync(file, args, { timeout = 30000, maxBuffer = 4 * 1024 * 1024, env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, maxBuffer, windowsHide: true, env }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = String(stdout || '');
        error.stderr = String(stderr || '');
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

const POWERSHELL_FALLBACK = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';

export function runPowerShell(script, { appRoot, args = [], timeout = 30000, maxBuffer = 4 * 1024 * 1024 } = {}) {
  if (!appRoot) return Promise.reject(new Error('appRoot is required to run platform scripts'));
  const file = path.resolve(appRoot, 'platform', 'windows', script);
  if (!fs.existsSync(file)) {
    const error = new Error(`PowerShell script not found: ${file}`);
    error.code = 'PS_NOT_FOUND';
    return Promise.reject(error);
  }

  const executable = which('powershell.exe') || (fs.existsSync(POWERSHELL_FALLBACK) ? POWERSHELL_FALLBACK : 'powershell.exe');
  const argv = [
    '-NoLogo',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    file,
    ...args.map(String)
  ];

  return execFileAsync(executable, argv, {
    timeout,
    maxBuffer,
    env: { ...process.env, BACKDROPBUDDY_APP_ROOT: path.resolve(appRoot) }
  }).catch((error) => {
    if (error.killed || error.signal) {
      error.code = 'PS_TIMEOUT';
      error.message = `PowerShell script timed out after ${timeout}ms: ${script}`;
    }
    throw error;
  });
}

export async function runPowerShellJson(script, options = {}) {
  const result = await runPowerShell(script, options);
  const text = String(result.stdout || '').trim();
  const line = text.split(/\r?\n/).map((entry) => entry.trim()).filter((entry) => entry.startsWith('{')).pop();

  if (!line) {
    const error = new Error(`PowerShell script produced no JSON: ${script}`);
    error.code = 'PS_NO_JSON';
    error.stdout = text;
    error.stderr = String(result.stderr || '');
    throw error;
  }

  let data;
  try {
    data = JSON.parse(line);
  } catch (cause) {
    const error = new Error(`PowerShell script produced invalid JSON: ${script}`);
    error.code = 'PS_BAD_JSON';
    error.details = { line: line.slice(0, 500), cause: cause.message };
    throw error;
  }

  if (data && data.ok === false) {
    const failure = data.error || {};
    const error = new Error(failure.message || `PowerShell script failed: ${script}`);
    error.code = failure.code || 'PS_FAILED';
    error.details = failure.details || data;
    error.script = script;
    throw error;
  }

  return data;
}

export function which(name, env = process.env) {
  if (!name) return null;
  if (path.isAbsolute(name)) return fs.existsSync(name) ? name : null;

  const extensions = process.platform === 'win32'
    ? (env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';')
    : [''];
  const directories = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, name + extension.toLowerCase());
      if (fs.existsSync(candidate)) return candidate;
      const upper = path.join(directory, name + extension.toUpperCase());
      if (upper !== candidate && fs.existsSync(upper)) return upper;
    }
  }

  return null;
}
