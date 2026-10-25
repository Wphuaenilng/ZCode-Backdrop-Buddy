import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileAsync } from '../../kernel/platform/exec.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const WINDOWS = path.join(ROOT, 'platform', 'windows');

function scriptFiles(dir = WINDOWS) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return scriptFiles(full);
    return entry.name.endsWith('.ps1') ? [full] : [];
  });
}

test('powershell: exactly 33 scripts in five groups', () => {
  const files = scriptFiles().map((file) => path.relative(WINDOWS, file).replace(/\\/g, '/')).sort();
  assert.equal(files.length, 33);
  assert.equal(files.filter((file) => file.startsWith('env/')).length, 6);
  assert.equal(files.filter((file) => file.startsWith('host/')).length, 11);
  assert.equal(files.filter((file) => file.startsWith('theme/')).length, 7);
  assert.equal(files.filter((file) => file.startsWith('backup/')).length, 4);
  assert.equal(files.filter((file) => file.startsWith('install/')).length, 5);
});

test('powershell: all scripts parse with Windows PowerShell 5.1', async () => {
  const command = [
    `$root='${WINDOWS.replace(/'/g, "''")}';`,
    '$bad=@();',
    '$files=@(Get-ChildItem -LiteralPath $root -Recurse -Filter *.ps1);',
    'foreach($f in $files){ $t=$null; $e=$null; [void][System.Management.Automation.Language.Parser]::ParseFile($f.FullName,[ref]$t,[ref]$e); if($e.Count -gt 0){ $bad += @{ file=$f.FullName; errors=@($e | ForEach-Object { $_.Message }) } } };',
    '@{ ok=($bad.Count -eq 0); count=$files.Count; bad=$bad } | ConvertTo-Json -Compress -Depth 6'
  ].join(' ');

  const { stdout } = await execFileAsync('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command
  ], { timeout: 30000 });
  const result = JSON.parse(String(stdout).trim());
  assert.equal(result.ok, true);
  assert.equal(result.count, 33);
  assert.deepEqual(result.bad, []);
});
