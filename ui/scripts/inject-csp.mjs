import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const indexPath = path.join(dist, 'index.html');
const placeholder = '<meta name="bb-csp" content="pending">';
const limit = 256 * 1024;

if (!fs.existsSync(indexPath)) throw new Error(`missing build output: ${indexPath}`);

let html = fs.readFileSync(indexPath, 'utf8');
if (!html.includes(placeholder)) throw new Error('CSP placeholder missing from dist/index.html');

const inlineScripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
if (!inlineScripts.length) throw new Error('no inline script found; single-file build expected');

const hashes = inlineScripts.map((source) => {
  const digest = crypto.createHash('sha256').update(source, 'utf8').digest('base64');
  return `'sha256-${digest}'`;
});

const csp = [
  "default-src 'none'",
  `script-src ${hashes.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src https://media.backdropbuddy.invalid https://preview.backdropbuddy.invalid data: blob:",
  "media-src https://media.backdropbuddy.invalid https://preview.backdropbuddy.invalid blob:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'"
].join('; ');

html = html.replace(placeholder, `<meta http-equiv="Content-Security-Policy" content="${csp}">`);

const externalScript = /<script[^>]*\bsrc=/.test(html);
const externalStyle = /<link[^>]*rel=["']stylesheet["'][^>]*\bhref=/.test(html);
if (externalScript) throw new Error('external script remains; single-file build failed');
if (externalStyle) throw new Error('external stylesheet remains; single-file build failed');

fs.writeFileSync(indexPath, html);

const files = fs.readdirSync(dist);
const bytes = Buffer.byteLength(html, 'utf8');
if (bytes > limit) throw new Error(`dist/index.html is ${bytes} bytes, limit is ${limit}`);
if (files.length !== 1) throw new Error(`dist should contain only index.html, found: ${files.join(', ')}`);

console.log(`dist/index.html ${bytes} bytes / ${limit} limit · inline scripts ${inlineScripts.length} · files ${files.length}`);
