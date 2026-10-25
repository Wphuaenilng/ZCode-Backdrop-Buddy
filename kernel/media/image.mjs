import fs from 'node:fs';
import path from 'node:path';
import { execFileAsync } from '../platform/exec.mjs';
import { extensionForMime } from './mime.mjs';
import { IMAGE_MAX_EDGE } from './limits.mjs';

function targetSize(width, height, maxEdge) {
  if (!width || !height) return null;
  const scale = Math.min(1, maxEdge / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

export async function compressImage({ source, destination, info, tools, maxEdge = IMAGE_MAX_EDGE }) {
  if (!tools?.ffmpeg) {
    const file = `media${extensionForMime(info.mime)}`;
    fs.copyFileSync(source, path.join(path.dirname(destination), file));
    return { file, compressed: false, mime: info.mime };
  }

  const size = targetSize(info.width, info.height, maxEdge);
  const filter = size ? `scale=${size.width}:${size.height}` : `scale=${maxEdge}:-2`;

  await execFileAsync(tools.ffmpeg, [
    '-y',
    '-i', source,
    '-frames:v', '1',
    '-vf', filter,
    '-q:v', '3',
    destination
  ], { timeout: 60000 });

  return {
    file: path.basename(destination),
    compressed: true,
    mime: 'image/jpeg',
    width: size?.width ?? info.width,
    height: size?.height ?? info.height
  };
}
