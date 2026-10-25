import fs from 'node:fs';
import path from 'node:path';
import { execFileAsync } from '../platform/exec.mjs';
import { extensionForMime } from './mime.mjs';
import { THUMB_MAX_EDGE } from './limits.mjs';

export async function copyVideo({ source, stageDir, mime }) {
  const file = `media${extensionForMime(mime)}`;
  await fs.promises.copyFile(source, path.join(stageDir, file));
  return file;
}

export async function extractFrame({ source, destination, tools, width = THUMB_MAX_EDGE }) {
  if (!tools?.ffmpeg) return false;

  try {
    await execFileAsync(tools.ffmpeg, [
      '-y',
      '-ss', '0',
      '-i', source,
      '-frames:v', '1',
      '-vf', `scale=${width}:-2`,
      '-q:v', '4',
      destination
    ], { timeout: 60000 });
    return fs.existsSync(destination) && fs.statSync(destination).size > 0;
  } catch {
    return false;
  }
}
