import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashFile } from '../../kernel/media/hashing.mjs';
import { probeMedia } from '../../kernel/media/probe.mjs';
import { resolveTools } from '../../kernel/media/tooling.mjs';
import { compressImage } from '../../kernel/media/image.mjs';
import { extractFrame } from '../../kernel/media/video.mjs';
import { assertSize } from '../../kernel/media/limits.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const IMAGE = path.join(ROOT, 'assets', 'original.jpg');
const VIDEO = path.join(ROOT, 'assets', 'original.mp4');
const tools = resolveTools();

test('media: hashes are stable and 64 hex characters', async () => {
  const first = await hashFile(IMAGE);
  const second = await hashFile(IMAGE);
  assert.equal(first, second);
  assert.match(first, /^[0-9a-f]{64}$/);
});

test('media: probes image dimensions', async () => {
  assert.ok(tools.ffprobe, 'ffprobe is required for the local media tests');
  const info = await probeMedia(IMAGE, { tools });
  assert.equal(info.kind, 'image');
  assert.equal(info.mime, 'image/jpeg');
  assert.equal(info.width, 2048);
  assert.equal(info.height, 1152);
  assert.equal(info.bytes, fs.statSync(IMAGE).size);
});

test('media: rejects oversized media', () => {
  assert.throws(() => assertSize(21 * 1024 * 1024, 'image'), /exceeds/);
  assert.throws(() => assertSize(201 * 1024 * 1024, 'video'), /exceeds/);
});

test('media: compresses an image to at most 1400 px', async () => {
  assert.ok(tools.ffmpeg, 'ffmpeg is required for the local media tests');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-media-'));
  const target = path.join(dir, 'media.jpg');
  const info = await probeMedia(IMAGE, { tools });
  const result = await compressImage({ source: IMAGE, destination: target, info, tools });
  assert.equal(result.compressed, true);
  assert.ok(fs.statSync(target).size > 0);
  assert.ok(result.width <= 1400);
  assert.ok(result.height <= 1400);
  assert.ok(fs.statSync(target).size < fs.statSync(IMAGE).size);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('media: probes video and extracts its first frame', async () => {
  assert.ok(tools.ffmpeg && tools.ffprobe, 'ffmpeg/ffprobe are required for the local media tests');
  const info = await probeMedia(VIDEO, { tools });
  assert.equal(info.kind, 'video');
  assert.equal(info.width, 3840);
  assert.equal(info.height, 2160);
  assert.ok(info.duration > 0);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-video-'));
  const frame = path.join(dir, 'thumb.jpg');
  const ok = await extractFrame({ source: VIDEO, destination: frame, tools });
  assert.equal(ok, true);
  assert.ok(fs.statSync(frame).size > 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
