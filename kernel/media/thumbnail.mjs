import fs from 'node:fs';
import path from 'node:path';
import { thumbPath, ensureCache } from './cache.mjs';
import { compressImage } from './image.mjs';
import { copyVideo, extractFrame } from './video.mjs';
import { THUMB_MAX_EDGE } from './limits.mjs';

function copyIfPresent(source, destination) {
  if (!source || !fs.existsSync(source)) return false;
  fs.copyFileSync(source, destination);
  return true;
}

async function ensureThumb({ source, info, sha256, cacheDir, tools, logger }) {
  ensureCache(cacheDir);
  const target = thumbPath(cacheDir, sha256);
  if (fs.existsSync(target) && fs.statSync(target).size > 0) return target;

  let ok = false;
  if (info.kind === 'video') {
    ok = await extractFrame({ source, destination: target, tools, width: THUMB_MAX_EDGE });
  } else if (tools?.ffmpeg) {
    try {
      await compressImage({ source, destination: target, info, tools, maxEdge: THUMB_MAX_EDGE });
      ok = fs.existsSync(target) && fs.statSync(target).size > 0;
    } catch (error) {
      logger?.warn('image thumbnail failed', { message: error.message });
    }
  }

  if (!ok) {
    try { fs.rmSync(target, { force: true }); } catch { /* ignore */ }
    return null;
  }

  return target;
}

export function createMediaService({ cacheDir, tools, logger }) {
  async function prepare({ source, info, stageDir, sha256 }) {
    fs.mkdirSync(stageDir, { recursive: true });

    if (info.kind === 'image') {
      const destination = path.join(stageDir, 'media.jpg');
      let compressed;
      try {
        compressed = await compressImage({ source, destination, info, tools });
      } catch (error) {
        logger?.warn('image compression failed; storing original', { message: error.message });
        compressed = {
          file: `media${path.extname(source).toLowerCase() || '.img'}`,
          compressed: false,
          mime: info.mime
        };
        fs.copyFileSync(source, path.join(stageDir, compressed.file));
      }

      const cachedThumb = await ensureThumb({ source: path.join(stageDir, compressed.file), info, sha256, cacheDir, tools, logger });
      const thumb = cachedThumb && copyIfPresent(cachedThumb, path.join(stageDir, 'thumb.jpg')) ? 'thumb.jpg' : null;

      return {
        kind: 'image',
        file: compressed.file,
        thumb,
        mime: compressed.mime,
        width: compressed.width ?? info.width,
        height: compressed.height ?? info.height,
        duration: null,
        bytes: fs.statSync(path.join(stageDir, compressed.file)).size,
        sha256
      };
    }

    const file = await copyVideo({ source, stageDir, mime: info.mime });
    const cachedThumb = await ensureThumb({ source, info, sha256, cacheDir, tools, logger });
    const thumb = cachedThumb && copyIfPresent(cachedThumb, path.join(stageDir, 'thumb.jpg')) ? 'thumb.jpg' : null;

    return {
      kind: 'video',
      file,
      thumb,
      mime: info.mime,
      width: info.width,
      height: info.height,
      duration: info.duration,
      bytes: info.bytes,
      sha256
    };
  }

  return { prepare, tools, cacheDir };
}
