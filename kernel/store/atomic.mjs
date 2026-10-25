import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const inflateRawAsync = promisify(zlib.inflateRaw);

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeFileAtomic(file, contents) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(temp, contents);

  try {
    fs.renameSync(temp, file);
  } catch (error) {
    if (error.code === 'EEXIST' || error.code === 'EPERM') {
      fs.rmSync(file, { force: true });
      fs.renameSync(temp, file);
    } else {
      try { fs.rmSync(temp, { force: true }); } catch { /* ignore */ }
      throw error;
    }
  }

  return file;
}

export async function writeFileAtomicAsync(file, contents) {
  ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.promises.writeFile(temp, contents);

  try {
    await fs.promises.rename(temp, file);
  } catch (error) {
    if (error.code === 'EEXIST' || error.code === 'EPERM') {
      await fs.promises.rm(file, { force: true });
      await fs.promises.rename(temp, file);
    } else {
      try { await fs.promises.rm(temp, { force: true }); } catch { /* ignore */ }
      throw error;
    }
  }

  return file;
}

export function moveDirAtomic(source, destination) {
  ensureDir(path.dirname(destination));
  let backup = null;

  if (fs.existsSync(destination)) {
    backup = `${destination}.old-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    fs.renameSync(destination, backup);
  }

  try {
    fs.renameSync(source, destination);
  } catch (error) {
    if (backup) {
      try { fs.renameSync(backup, destination); } catch { /* best effort */ }
    }
    throw error;
  }

  if (backup) {
    try { fs.rmSync(backup, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  return destination;
}

export function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function removeDirToTrash(dir, trashRoot) {
  if (!fs.existsSync(dir)) return null;
  ensureDir(trashRoot);
  const trash = path.join(trashRoot, `trash-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.renameSync(dir, trash);
  return trash;
}

export function copyFile(source, destination) {
  ensureDir(path.dirname(destination));
  fs.copyFileSync(source, destination);
  return destination;
}

export function directorySize(dir) {
  let total = 0;
  if (!fs.existsSync(dir)) return total;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += directorySize(full);
    else {
      try { total += fs.statSync(full).size; } catch { /* ignore */ }
    }
  }

  return total;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(buffer) {
  if (typeof zlib.crc32 === 'function') return zlib.crc32(buffer) >>> 0;
  let value = 0xFFFFFFFF;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xFF] ^ (value >>> 8);
  return (value ^ 0xFFFFFFFF) >>> 0;
}

export function safeZipName(name) {
  const value = String(name || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!value || value.length > 255 || value.includes('\0')) throw new Error(`invalid zip entry name: ${name}`);
  if (value.startsWith('/') || /^[a-zA-Z]:/.test(value)) throw new Error(`absolute zip entry rejected: ${value}`);
  if (value.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new Error(`unsafe zip entry path: ${value}`);
  }
  return value;
}

function dosTimestamp(date = new Date()) {
  const value = date instanceof Date ? date : new Date();
  const year = Math.min(2107, Math.max(1980, value.getFullYear()));
  return {
    time: (value.getHours() << 11) | (value.getMinutes() << 5) | Math.floor(value.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((value.getMonth() + 1) << 5) | value.getDate()
  };
}

export function createZip(entries, { date = new Date() } = {}) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('zip requires at least one entry');
  if (entries.length > 256) throw new Error('zip has too many entries');

  const stamp = dosTimestamp(date);
  const locals = [];
  const centrals = [];
  let offset = 0;
  let total = 0;

  for (const entry of entries) {
    const name = safeZipName(entry.name);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data || '');
    if (data.length > 300 * 1024 * 1024) throw new Error(`zip entry too large: ${name}`);
    total += data.length;
    if (total > 400 * 1024 * 1024) throw new Error('zip payload too large');

    const nameBuffer = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    local.writeUInt16LE(0, 28);
    const record = Buffer.concat([local, nameBuffer, data]);
    locals.push(record);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(Buffer.concat([central, nameBuffer]));

    offset += record.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralPart.length, 12);
  end.writeUInt32LE(localPart.length, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([localPart, centralPart, end]);
}

export async function readZipEntries(buffer, { maxEntries = 64, maxTotalBytes = 300 * 1024 * 1024 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new Error('zip is too small');
  if (buffer.length > 400 * 1024 * 1024) throw new Error('zip file is too large');

  let end = -1;
  const floor = Math.max(0, buffer.length - 65557);
  for (let index = buffer.length - 22; index >= floor; index -= 1) {
    if (buffer.readUInt32LE(index) === 0x06054b50) { end = index; break; }
  }
  if (end < 0) throw new Error('zip end-of-central-directory not found');

  const entryCount = buffer.readUInt16LE(end + 10);
  const centralSize = buffer.readUInt32LE(end + 12);
  const centralOffset = buffer.readUInt32LE(end + 16);
  if (entryCount === 0 || entryCount > maxEntries) throw new Error(`zip entry count rejected: ${entryCount}`);
  if (centralOffset + centralSize > buffer.length) throw new Error('zip central directory is outside the file');

  const entries = [];
  const seen = new Set();
  let cursor = centralOffset;
  let total = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('zip central directory is corrupt');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const name = buffer.toString('utf8', nameStart, nameStart + nameLength);
    safeZipName(name);
    if (seen.has(name)) throw new Error(`duplicate zip entry: ${name}`);
    seen.add(name);

    if (flags & 0x0001) throw new Error(`encrypted zip entry rejected: ${name}`);
    if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF) throw new Error('zip64 entries are not supported');
    if (uncompressedSize > 200 * 1024 * 1024) throw new Error(`zip entry too large: ${name}`);
    if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error(`zip local header is corrupt: ${name}`);
    }

    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    if (dataStart + compressedSize > buffer.length) throw new Error(`zip entry data is truncated: ${name}`);

    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);
    let data;
    if (method === 0) data = Buffer.from(compressed);
    else if (method === 8) data = await inflateRawAsync(compressed, { maxOutputLength: uncompressedSize + 1 });
    else throw new Error(`unsupported zip compression method ${method}: ${name}`);

    if (data.length !== uncompressedSize) throw new Error(`zip size mismatch: ${name}`);
    if (crc32(data) !== crc) throw new Error(`zip crc mismatch: ${name}`);

    total += data.length;
    if (total > maxTotalBytes) throw new Error('zip uncompressed payload too large');
    entries.push({ name, data, method });

    cursor = nameStart + nameLength + extraLength + commentLength;
  }

  return entries;
}

export function pruneBackups(dir, { keep = 40, prefixes = ['snapshot', 'restore', 'apply'] } = {}) {
  if (!fs.existsSync(dir)) return 0;

  const groups = new Map();
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const prefix = prefixes.find((item) => entry.name.startsWith(item + '-'));
    if (!prefix) continue;
    const full = path.join(dir, entry.name);
    let mtime = 0;
    try { mtime = fs.statSync(full).mtimeMs; } catch { continue; }
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix).push({ full, mtime });
  }

  let removed = 0;
  for (const files of groups.values()) {
    files.sort((a, b) => b.mtime - a.mtime);
    for (const file of files.slice(keep)) {
      try { fs.rmSync(file.full, { force: true }); removed += 1; } catch { /* ignore */ }
    }
  }
  return removed;
}

export function pruneOrphanDirs(root, { maxAgeMs = 60 * 60 * 1000 } = {}) {
  if (!fs.existsSync(root)) return 0;

  let removed = 0;
  const now = Date.now();
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (!/\.old-|^trash-/.test(entry.name)) continue;
    const full = path.join(root, entry.name);
    try {
      if (now - fs.statSync(full).mtimeMs > maxAgeMs) {
        removeDir(full);
        removed += 1;
      }
    } catch { /* ignore */ }
  }
  return removed;
}
