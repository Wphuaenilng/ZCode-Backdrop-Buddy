import fs from 'node:fs';
import { AppError } from '../protocol/errors.mjs';
import { execFileAsync } from '../platform/exec.mjs';
import { assertSize } from './limits.mjs';
import { detectMime, kindForMime } from './mime.mjs';

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function probeMedia(file, { tools } = {}) {
  if (!fs.existsSync(file)) throw new AppError('FILE_NOT_FOUND', `media file not found: ${file}`);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw new AppError('MEDIA_INVALID', 'path is not a file');

  const mime = detectMime(file);
  const kind = kindForMime(mime);
  if (!kind) throw new AppError('MEDIA_INVALID', `unsupported media type: ${mime || 'unknown'}`);
  assertSize(stat.size, kind);

  const info = {
    path: file,
    kind,
    mime,
    bytes: stat.size,
    width: null,
    height: null,
    duration: null,
    codec: null,
    probed: false
  };

  if (!tools?.ffprobe) return info;

  try {
    const { stdout } = await execFileAsync(tools.ffprobe, [
      '-v', 'error',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      file
    ], { timeout: 20000 });

    const parsed = JSON.parse(stdout);
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const stream = streams.find((item) => item.width && item.height) || streams[0] || {};
    info.width = number(stream.width);
    info.height = number(stream.height);
    info.codec = stream.codec_name || null;
    info.duration = number(parsed.format?.duration ?? stream.duration);
    info.probed = true;
  } catch (error) {
    info.probeError = error.message;
  }

  return info;
}
