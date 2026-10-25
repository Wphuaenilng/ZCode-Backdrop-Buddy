import { AppError } from '../protocol/errors.mjs';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
export const IMAGE_MAX_EDGE = 1400;
export const THUMB_MAX_EDGE = 480;

export function assertSize(bytes, kind) {
  const limit = kind === 'video' ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
  if (bytes > limit) {
    throw new AppError('MEDIA_TOO_LARGE', `${kind} exceeds ${limit} bytes`, { details: { bytes, limit } });
  }
  return bytes;
}
