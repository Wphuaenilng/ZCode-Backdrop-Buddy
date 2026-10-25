import { which } from '../platform/exec.mjs';

export function resolveTools({ env = process.env, ffmpeg = null, ffprobe = null } = {}) {
  return {
    ffmpeg: which(ffmpeg || env.BACKDROPBUDDY_FFMPEG || 'ffmpeg', env),
    ffprobe: which(ffprobe || env.BACKDROPBUDDY_FFPROBE || 'ffprobe', env)
  };
}

export function toolSummary(tools) {
  return {
    ffmpeg: tools.ffmpeg || null,
    ffprobe: tools.ffprobe || null,
    ready: !!(tools.ffmpeg && tools.ffprobe)
  };
}
