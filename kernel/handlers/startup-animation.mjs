import fs from 'node:fs';
import path from 'node:path';
import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { AppError } from '../protocol/errors.mjs';
import { readJson, writeJsonAtomic } from '../store/json-file.mjs';

// 启动动画设置独立于 config.json：壳在内核启动前就要读到（splash 开场用），
// 所以这里只保存内核解析好的 videoPath，壳按文件存在性自行回退内置动画。
const SCHEMA_VERSION = 1;
const DEFAULTS = Object.freeze({
  schemaVersion: SCHEMA_VERSION,
  enabled: true,
  themeId: null,
  themeName: null,
  videoPath: null
});

export function readStartupSettings(ctx) {
  const value = readJson(ctx.paths.startupAnimation, null);
  if (!value || typeof value !== 'object' || value.schemaVersion !== SCHEMA_VERSION) {
    return { ...DEFAULTS };
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    enabled: value.enabled !== false,
    themeId: typeof value.themeId === 'string' ? value.themeId : null,
    themeName: typeof value.themeName === 'string' ? value.themeName : null,
    videoPath: typeof value.videoPath === 'string' ? value.videoPath : null
  };
}

function clearThemeRef(settings) {
  return { ...settings, themeId: null, themeName: null, videoPath: null };
}

export default function register(registry, ctx) {
  registry.register(METHODS.STARTUP_GET, METHOD_SCHEMAS[METHODS.STARTUP_GET], async () => ({
    settings: readStartupSettings(ctx)
  }));

  registry.register(METHODS.STARTUP_UPDATE, METHOD_SCHEMAS[METHODS.STARTUP_UPDATE], async (params) => {
    let next = readStartupSettings(ctx);
    if (typeof params.enabled === 'boolean') next = { ...next, enabled: params.enabled };

    if (Object.prototype.hasOwnProperty.call(params, 'themeId')) {
      if (params.themeId === null) {
        next = clearThemeRef(next);
      } else {
        const record = ctx.library.get(params.themeId);
        if (!record) throw new AppError('THEME_NOT_FOUND', `theme not found: ${params.themeId}`);
        const media = record.media;
        if (!media || media.kind !== 'video' || !media.file) {
          throw new AppError('MEDIA_INVALID', 'startup animation requires a video theme');
        }
        const videoPath = path.join(
          record.source === 'builtin' ? ctx.paths.builtin : ctx.paths.user,
          record.id,
          media.file
        );
        if (!fs.existsSync(videoPath)) {
          throw new AppError('MEDIA_INVALID', 'theme video file is missing');
        }
        next = { ...next, themeId: record.id, themeName: record.name, videoPath };
      }
    }

    writeJsonAtomic(ctx.paths.startupAnimation, next);
    return { settings: next };
  });
}

// 主题删除后清掉指向它的启动动画引用；失败不阻塞删除本身。
export function clearStartupThemeRef(ctx, themeId) {
  try {
    const current = readStartupSettings(ctx);
    if (current.themeId !== themeId) return;
    writeJsonAtomic(ctx.paths.startupAnimation, clearThemeRef(current));
  } catch (error) {
    ctx.logger?.warn('failed to clear startup animation ref', {
      themeId,
      message: error && error.message
    });
  }
}
