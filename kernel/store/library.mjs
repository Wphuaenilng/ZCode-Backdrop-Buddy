import fs from 'node:fs';
import path from 'node:path';
import { AppError } from '../protocol/errors.mjs';
import { mediaUrl } from '../media/url.mjs';
import { ensureDirs } from './paths.mjs';
import {
  removeDirToTrash,
  removeDir,
  writeFileAtomic,
  writeFileAtomicAsync,
  createZip,
  readZipEntries,
  safeZipName,
  pruneBackups,
  pruneOrphanDirs
} from './atomic.mjs';
import { readJson, writeJsonAtomic } from './json-file.mjs';
import { loadTheme, loadThemes } from './loader.mjs';
import { createRecord, newThemeId, isValidThemeId, normalizeStartup, RECORD_SCHEMA } from './record.mjs';
import { createStartupPreviewHtml, normalizeStartupTemplate, STARTUP_LIMITS } from '../host/startup-template.mjs';
import { seedBuiltins } from './seed.mjs';
import { BUILTIN_CATALOG, LOCAL_ASSET_THEMES } from './catalog.mjs';
import { storeStats } from './stats.mjs';
import { cleanupStaging, ThemeTransaction } from './transaction.mjs';
import { themeFile, writeTheme } from './writer.mjs';

const PACK_SCHEMA = 'backdropbuddy.pack/1';
const MAX_PACK_BYTES = 300 * 1024 * 1024;
const MAX_PACK_MANIFEST = 1024 * 1024;
const STATS_TTL_MS = 60 * 1000;

const MEDIA_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.mp4', '.webm', '.mov', '.m4v']);

function packMediaName(originalName, kind) {
  const extension = path.extname(String(originalName || '')).toLowerCase();
  return 'media' + (MEDIA_EXTENSIONS.has(extension) ? extension : (kind === 'video' ? '.mp4' : '.jpg'));
}

function packThumbName(originalName) {
  const extension = path.extname(String(originalName || '')).toLowerCase();
  return 'thumb' + (['.jpg', '.jpeg', '.png', '.webp'].includes(extension) ? extension : '.jpg');
}

function mediaName(value) {
  const name = String(value || '');
  if (!name || /[\\/]/.test(name) || name === '.' || name === '..' || name.includes('\0')) {
    throw new AppError('MEDIA_INVALID', `invalid media file name: ${name}`);
  }
  return name;
}

function startupMediaName(value) {
  const name = mediaName(value);
  if (name.length > 255 || /[<>:"|?*\u0000-\u001f]/.test(name)
    || !['.jpg', '.jpeg', '.png', '.webp'].includes(path.extname(name).toLowerCase())) {
    throw new AppError('MEDIA_INVALID', `startup media must be a safe JPEG, PNG or WebP file name: ${name}`);
  }
  return name;
}

function startupImagePath(dir, value) {
  const name = startupMediaName(value);
  const root = path.resolve(dir);
  const file = path.resolve(root, name);
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !fs.existsSync(file)) {
    throw new AppError('MEDIA_INVALID', `startup media is missing or outside the theme: ${name}`);
  }
  const realRoot = fs.realpathSync(root);
  const realFile = fs.realpathSync(file);
  const realRelative = path.relative(realRoot, realFile);
  if (realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
    throw new AppError('MEDIA_INVALID', `startup media resolves outside the theme: ${name}`);
  }
  const stat = fs.statSync(realFile);
  if (!stat.isFile()) throw new AppError('MEDIA_INVALID', `startup media is not a file: ${name}`);
  if (stat.size > STARTUP_LIMITS.maxMediaBytes) {
    throw new AppError('MEDIA_TOO_LARGE', `startup media exceeds ${STARTUP_LIMITS.maxMediaBytes} bytes: ${name}`);
  }
  const header = Buffer.alloc(12);
  const fd = fs.openSync(realFile, 'r');
  try { fs.readSync(fd, header, 0, header.length, 0); } finally { fs.closeSync(fd); }
  const extension = path.extname(name).toLowerCase();
  const valid = extension === '.png'
    ? header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : extension === '.webp'
      ? header.subarray(0, 4).toString('ascii') === 'RIFF' && header.subarray(8, 12).toString('ascii') === 'WEBP'
      : header[0] === 0xff && header[1] === 0xd8 && header[2] === 0xff;
  if (!valid) throw new AppError('MEDIA_INVALID', `startup media content does not match its image extension: ${name}`);
  return name;
}

function resolveStartup(record, dir) {
  const startup = normalizeStartup(record.startup);
  if (startup.media) return { ...startup, media: startupImagePath(dir, startup.media) };
  if (!startup.enabled) return startup;
  const candidates = [record.media?.thumb, record.media?.kind === 'image' ? record.media.file : null];
  for (const name of candidates) {
    if (!name) continue;
    try { return { ...startup, media: startupImagePath(dir, name) }; } catch { /* try the next safe theme still */ }
  }
  return startup;
}

function packManifest(record) {
  return {
    schema: PACK_SCHEMA,
    version: 1,
    createdAt: new Date().toISOString(),
    themeId: record.id,
    name: record.name
  };
}

function publicRecord(record) {
  const media = record.media
    ? {
        ...record.media,
        url: mediaUrl(record.source, record.id, record.media.file),
        thumbUrl: record.media.thumb ? mediaUrl(record.source, record.id, record.media.thumb) : null
      }
    : null;

  const startup = normalizeStartup(record.startup);
  if (startup.media) {
    try { startupMediaName(startup.media); } catch { startup.media = null; }
  }
  return {
    ...record,
    media,
    startup: {
      ...startup,
      mediaUrl: startup.media ? mediaUrl(record.source, record.id, startup.media) : null
    }
  };
}

export function createLibrary({ paths, logger, media, locks }) {
  let statsCache = { at: 0, value: null };

  function findRecord(id) {
    const builtin = loadTheme(paths.builtin, id, 'builtin', logger);
    if (builtin) return builtin;
    return loadTheme(paths.user, id, 'user', logger);
  }

  function themeDir(record) {
    return path.join(record.source === 'builtin' ? paths.builtin : paths.user, record.id);
  }

  function allocateThemeId() {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const id = newThemeId();
      if (!loadTheme(paths.builtin, id, 'builtin', logger) && !loadTheme(paths.user, id, 'user', logger)) return id;
      logger?.warn('generated theme id already exists; retrying', { id, attempt: attempt + 1 });
    }
    throw new AppError('THEME_ID_CONFLICT', 'could not allocate a unique theme id after 5 attempts');
  }

  function assertNewId(id) {
    if (!isValidThemeId(id)) throw new AppError('BAD_PARAMS', `invalid theme id: ${id}`);
    if (loadTheme(paths.builtin, id, 'builtin', logger)) throw new AppError('THEME_EXISTS', `builtin theme already uses id: ${id}`);
    if (loadTheme(paths.user, id, 'user', logger)) throw new AppError('THEME_EXISTS', `user theme already uses id: ${id}`);
  }

  async function importPack(packPath, input) {
    const stat = fs.statSync(packPath);
    if (stat.size > MAX_PACK_BYTES) {
      throw new AppError('MEDIA_TOO_LARGE', `theme pack is too large: ${stat.size} bytes`);
    }

    let entries;
    try {
      entries = await readZipEntries(await fs.promises.readFile(packPath));
    } catch (error) {
      throw new AppError('MEDIA_INVALID', `theme pack is not a readable zip: ${error.message}`);
    }

    const files = new Map(entries.map((entry) => [entry.name, entry.data]));
    const themeEntry = files.get('theme.json');
    if (!themeEntry || themeEntry.length > MAX_PACK_MANIFEST) {
      throw new AppError('MEDIA_INVALID', 'theme pack is missing a valid theme.json');
    }

    let themeData;
    try {
      themeData = JSON.parse(themeEntry.toString('utf8'));
    } catch (error) {
      throw new AppError('MEDIA_INVALID', `theme.json is invalid: ${error.message}`);
    }
    if (!themeData || themeData.schema !== RECORD_SCHEMA || !themeData.name) {
      throw new AppError('MEDIA_INVALID', 'theme pack schema is not backdropbuddy.theme/1');
    }

    const packEntry = files.get('pack.json');
    if (packEntry) {
      try {
        const manifest = JSON.parse(packEntry.toString('utf8'));
        if (manifest.schema !== PACK_SCHEMA) logger?.warn('theme pack manifest schema mismatch', { schema: manifest.schema });
      } catch (error) {
        logger?.warn('theme pack manifest ignored', { message: error.message });
      }
    }

    const id = input.id ? input.id : allocateThemeId();
    if (input.id) assertNewId(id);

    return locks.run('themes', async () => {
      const tx = ThemeTransaction.begin({ stagingRoot: paths.staging, logger });
      try {
        let mediaRecord = null;
        if (themeData.media && themeData.media.file) {
          const originalName = mediaName(themeData.media.file);
          const mediaBytes = files.get(originalName) || files.get(`media/${originalName}`);
          if (!mediaBytes) throw new AppError('MEDIA_INVALID', `theme pack is missing media file: ${originalName}`);
          const fileName = packMediaName(originalName, themeData.media.kind);
          const stagedMedia = path.join(tx.dir, fileName);
          await fs.promises.writeFile(stagedMedia, mediaBytes);
          const info = await media.probe(stagedMedia);
          const sha256 = await media.hash(stagedMedia);

          let thumb = null;
          if (themeData.media.thumb) {
            const originalThumb = mediaName(themeData.media.thumb);
            const thumbBytes = files.get(originalThumb) || files.get(`media/${originalThumb}`);
            if (thumbBytes) {
              const thumbName = packThumbName(originalThumb);
              await fs.promises.writeFile(path.join(tx.dir, thumbName), thumbBytes);
              thumb = thumbName;
            }
          }

          mediaRecord = {
            kind: info.kind,
            file: fileName,
            thumb,
            mime: info.mime,
            width: info.width,
            height: info.height,
            duration: info.duration,
            bytes: fs.statSync(stagedMedia).size,
            sha256
          };
        }

        const startup = normalizeStartup(themeData.startup);
        if (startup.media) {
          const originalName = startupMediaName(startup.media);
          const bytes = files.get(originalName) || files.get(`media/${originalName}`);
          if (!bytes) throw new AppError('MEDIA_INVALID', `theme pack is missing startup media: ${originalName}`);
          if (bytes.length > STARTUP_LIMITS.maxMediaBytes) throw new AppError('MEDIA_TOO_LARGE', 'startup media exceeds 500 KiB');
          startup.media = 'startup' + path.extname(originalName).toLowerCase();
          await fs.promises.writeFile(path.join(tx.dir, startup.media), bytes);
          startupImagePath(tx.dir, startup.media);
        }

        const record = createRecord({
          id,
          name: input.name || themeData.name,
          tags: input.tags && input.tags.length ? input.tags : themeData.tags,
          params: input.params && Object.keys(input.params).length ? input.params : themeData.params,
          media: mediaRecord,
          startup: resolveStartup({ startup, media: mediaRecord }, tx.dir),
          source: 'user',
          createdAt: Date.now(),
          updatedAt: Date.now()
        });

        writeTheme(tx.dir, record);
        tx.commit(path.join(paths.user, id));
        invalidateStats();
        logger?.info('theme pack imported', { packPath, themeId: id, media: !!mediaRecord, startup: startup.enabled });
        return publicRecord(record);
      } catch (error) {
        tx.abort();
        if (error instanceof AppError) throw error;
        throw new AppError('TRANSACTION_FAILED', 'theme pack import failed', { details: { cause: error.message } });
      }
    });
  }

  async function importJsonPack(pack, input) {
    const themeData = pack.schema === PACK_SCHEMA && pack.theme ? pack.theme : pack;
    if (!themeData || !themeData.name) throw new AppError('MEDIA_INVALID', 'theme json is missing a name');

    const id = input.id ? input.id : allocateThemeId();
    if (input.id) assertNewId(id);

    return locks.run('themes', async () => {
      const tx = ThemeTransaction.begin({ stagingRoot: paths.staging, logger });
      try {
        let mediaRecord = null;
        const dataUrl = typeof themeData.image === 'string'
          ? themeData.image.match(/^data:image\/(jpeg|png|webp);base64,(.+)$/i)
          : null;
        if (dataUrl) {
          const bytes = Buffer.from(dataUrl[2], 'base64');
          if (bytes.length > 20 * 1024 * 1024) throw new AppError('MEDIA_TOO_LARGE', 'embedded image is too large');
          const extension = dataUrl[1].toLowerCase() === 'jpeg' ? '.jpg' : `.${dataUrl[1].toLowerCase()}`;
          const incoming = path.join(tx.dir, `incoming${extension}`);
          fs.writeFileSync(incoming, bytes);
          const info = await media.probe(incoming);
          const sha256 = await media.hash(incoming);
          mediaRecord = await media.prepare({ source: incoming, info, stageDir: tx.dir, cacheDir: paths.cache, sha256 });
          fs.rmSync(incoming, { force: true });
        }

        const record = createRecord({
          id,
          name: input.name || themeData.name,
          tags: input.tags && input.tags.length ? input.tags : themeData.tags,
          params: input.params && Object.keys(input.params).length ? input.params : themeData.params,
          media: mediaRecord,
          startup: resolveStartup({ startup: themeData.startup, media: mediaRecord }, tx.dir),
          source: 'user',
          createdAt: Date.now(),
          updatedAt: Date.now()
        });

        writeTheme(tx.dir, record);
        tx.commit(path.join(paths.user, id));
        invalidateStats();
        logger?.info('theme json imported', { themeId: id, media: !!mediaRecord });
        return publicRecord(record);
      } catch (error) {
        tx.abort();
        if (error instanceof AppError) throw error;
        throw new AppError('TRANSACTION_FAILED', 'theme json import failed', { details: { cause: error.message } });
      }
    });
  }

  async function exportPack(record, target) {
    const dir = themeDir(record);
    if (record.media && record.media.file) {
      const mediaPath = path.join(dir, record.media.file);
      if (!fs.existsSync(mediaPath)) throw new AppError('MEDIA_INVALID', `theme media is missing: ${mediaPath}`);
    }
    if (record.media && record.media.thumb && !fs.existsSync(path.join(dir, record.media.thumb))) {
      throw new AppError('MEDIA_INVALID', `theme thumbnail is missing: ${record.media.thumb}`);
    }

    const exported = { ...record, startup: resolveStartup(record, dir), source: 'user' };
    const entries = [
      { name: 'pack.json', data: Buffer.from(JSON.stringify(packManifest(record), null, 2), 'utf8') },
      { name: 'theme.json', data: Buffer.from(JSON.stringify(exported, null, 2), 'utf8') }
    ];
    if (exported.startup.media && !entries.some((entry) => entry.name === exported.startup.media)) {
      entries.push({
        name: safeZipName(exported.startup.media),
        data: await fs.promises.readFile(path.join(dir, exported.startup.media))
      });
    }

    if (record.media && record.media.file && !entries.some((entry) => entry.name === record.media.file)) {
      const name = safeZipName(record.media.file);
      entries.push({ name, data: await fs.promises.readFile(path.join(dir, record.media.file)) });
    }
    if (record.media && record.media.thumb) {
      const name = safeZipName(record.media.thumb);
      if (!entries.some((entry) => entry.name === name)) {
        entries.push({ name, data: await fs.promises.readFile(path.join(dir, record.media.thumb)) });
      }
    }

    const zip = createZip(entries);
    await writeFileAtomicAsync(target, zip);
    logger?.info('theme pack exported', { themeId: record.id, target, bytes: zip.length });
    return { path: target, bytes: zip.length, format: 'bbskin', entries: entries.length };
  }

  async function ensureLocalThemes({ assetRoot, config }) {
    const current = config.get();
    if (current.localAssetsSeeded) return { seeded: 0, existing: 0, missing: 0, complete: true, skipped: true };

    let seeded = 0;
    let existing = 0;
    let missing = 0;

    for (const item of LOCAL_ASSET_THEMES) {
      if (loadTheme(paths.user, item.id, 'user', logger)) {
        existing += 1;
        continue;
      }
      const assetPath = path.join(assetRoot, item.file);
      if (!fs.existsSync(assetPath)) {
        missing += 1;
        logger?.warn('local asset missing', { file: assetPath });
        continue;
      }
      try {
        await importTheme({ id: item.id, name: item.name, tags: item.tags, params: item.params, path: assetPath, kind: item.kind });
        seeded += 1;
      } catch (error) {
        missing += 1;
        logger?.warn('local asset import failed', { file: item.file, message: error.message });
      }
    }

    const complete = missing === 0;
    if (complete) config.set({ localAssetsSeeded: true });
    logger?.info('local assets seeded', { seeded, existing, missing, complete });
    return { seeded, existing, missing, complete, skipped: false };
  }

  function init() {
    ensureDirs(paths);
    seedBuiltins({ paths, logger });
    cleanupStaging(paths.staging, 60 * 60 * 1000, logger);

    const orphans = pruneOrphanDirs(paths.user) + pruneOrphanDirs(paths.builtin);
    if (orphans) logger?.info('removed orphan theme directories', { removed: orphans });

    const backups = pruneBackups(paths.backup, { keep: 40 });
    if (backups) logger?.info('pruned backup history', { removed: backups });
  }

  function list({ source = 'all' } = {}) {
    const order = new Map(BUILTIN_CATALOG.map((theme, index) => [theme.id, index]));
    let themes = [];

    if (source === 'all' || source === 'builtin') {
      const builtin = loadThemes(paths.builtin, 'builtin', logger)
        .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999));
      themes = themes.concat(builtin);
    }
    if (source === 'all' || source === 'user') {
      const user = loadThemes(paths.user, 'user', logger)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      themes = themes.concat(user);
    }

    return themes.map(publicRecord);
  }

  function get(id) {
    const record = findRecord(id);
    return record ? publicRecord(record) : null;
  }

  function save(input) {
    return locks.run('themes', () => {
      if (input.id) {
        const existing = loadTheme(paths.user, input.id, 'user', logger);
        if (!existing) {
          if (loadTheme(paths.builtin, input.id, 'builtin', logger)) {
            throw new AppError('THEME_EXISTS', 'builtin theme cannot be overwritten');
          }
          throw new AppError('THEME_NOT_FOUND', `theme not found: ${input.id}`);
        }

        const updated = createRecord({
          ...existing,
          name: input.name ?? existing.name,
          tags: input.tags ?? existing.tags,
          params: input.params ?? existing.params,
          media: existing.media,
          startup: resolveStartup({
            ...existing,
            startup: { ...existing.startup, ...(input.startup || {}) }
          }, path.join(paths.user, existing.id)),
          source: 'user',
          createdAt: existing.createdAt,
          updatedAt: Date.now()
        });
        writeTheme(path.join(paths.user, existing.id), updated);
        invalidateStats();
        logger?.info('theme updated', { themeId: updated.id });
        return publicRecord(updated);
      }

      const id = allocateThemeId();
      const tx = ThemeTransaction.begin({ stagingRoot: paths.staging, logger });
      try {
        const record = createRecord({
          id,
          name: input.name,
          tags: input.tags,
          params: input.params,
          media: null,
          startup: resolveStartup({ startup: input.startup, media: null }, tx.dir),
          source: 'user'
        });
        writeTheme(tx.dir, record);
        tx.commit(path.join(paths.user, id));
        invalidateStats();
        logger?.info('theme saved', { themeId: id });
        return publicRecord(record);
      } catch (error) {
        tx.abort();
        throw error;
      }
    });
  }

  async function importTheme(input) {
    const sourcePath = path.resolve(input.path);
    if (!fs.existsSync(sourcePath) || !fs.statSync(sourcePath).isFile()) {
      throw new AppError('FILE_NOT_FOUND', `media file not found: ${sourcePath}`);
    }

    const extension = path.extname(sourcePath).toLowerCase();
    if (extension === '.bbskin' || extension === '.zip') {
      return importPack(sourcePath, input);
    }
    if (extension === '.json') {
      const stat = fs.statSync(sourcePath);
      if (stat.size > MAX_PACK_MANIFEST) {
        throw new AppError('MEDIA_TOO_LARGE', `theme json is too large: ${stat.size} bytes`);
      }
      const parsed = readJson(sourcePath, null);
      if (parsed && (parsed.schema === RECORD_SCHEMA || parsed.schema === PACK_SCHEMA)) {
        return importJsonPack(parsed, input);
      }
    }

    const info = await media.probe(sourcePath);
    const requestedKind = input.kind === 'pack' ? 'auto' : input.kind;
    if (requestedKind && requestedKind !== 'auto' && info.kind !== requestedKind) {
      throw new AppError('MEDIA_INVALID', `expected ${requestedKind}, got ${info.kind}`);
    }

    const requestedId = input.id || null;
    if (requestedId) assertNewId(requestedId);

    return locks.run('themes', async () => {
      const sha256 = await media.hash(sourcePath);
      const tx = ThemeTransaction.begin({ stagingRoot: paths.staging, logger });

      try {
        const prepared = await media.prepare({
          source: sourcePath,
          info,
          stageDir: tx.dir,
          cacheDir: paths.cache,
          sha256
        });

        const id = requestedId || allocateThemeId();
        const record = createRecord({
          id,
          name: input.name || path.basename(sourcePath, extension).slice(0, 24),
          tags: input.tags,
          params: input.params,
          media: prepared,
          source: 'user'
        });

        writeTheme(tx.dir, record);
        tx.commit(path.join(paths.user, id));
        invalidateStats();
        logger?.info('theme imported', { themeId: id, kind: info.kind, bytes: info.bytes });
        return publicRecord(record);
      } catch (error) {
        tx.abort();
        if (error instanceof AppError) throw error;
        throw new AppError('TRANSACTION_FAILED', 'theme import failed', { details: { cause: error.message } });
      }
    });
  }

  function remove(id) {
    return locks.run('themes', () => {
      if (loadTheme(paths.builtin, id, 'builtin', logger)) {
        throw new AppError('BAD_PARAMS', 'builtin themes cannot be removed');
      }
      const dir = path.join(paths.user, id);
      if (!fs.existsSync(themeFile(dir))) throw new AppError('THEME_NOT_FOUND', `theme not found: ${id}`);

      const trash = removeDirToTrash(dir, paths.staging);
      if (trash) removeDir(trash);
      invalidateStats();
      logger?.info('theme removed', { themeId: id });
      return { removed: id };
    });
  }

  async function exportTheme(id, destPath) {
    const record = findRecord(id);
    if (!record) throw new AppError('THEME_NOT_FOUND', `theme not found: ${id}`);

    const target = path.resolve(destPath);
    if (target.toLowerCase().endsWith('.bbskin')) return exportPack(record, target);

    fs.mkdirSync(path.dirname(target), { recursive: true });
    const pack = {
      schema: RECORD_SCHEMA,
      id: record.id,
      name: record.name,
      tags: record.tags,
      params: record.params,
      media: record.media,
      exportedAt: new Date().toISOString()
    };
    await writeFileAtomicAsync(target, JSON.stringify(pack, null, 2));
    logger?.info('theme exported', { themeId: id, target, format: 'json' });
    return { path: target, bytes: (await fs.promises.stat(target)).size, format: 'json' };
  }

  function invalidateStats() {
    statsCache = { at: 0, value: null };
  }

  function stats() {
    const now = Date.now();
    if (!statsCache.value || now - statsCache.at > STATS_TTL_MS) {
      statsCache = { at: now, value: storeStats({ paths, logger }) };
    }
    return statsCache.value;
  }

  function previewStartup(id, { reducedMotion = false } = {}) {
    const record = findRecord(id);
    if (!record) throw new AppError('THEME_NOT_FOUND', `theme not found: ${id}`);
    const startup = resolveStartup(record, themeDir(record));
    const config = normalizeStartupTemplate({
      ...startup,
      launchId: 'preview',
      themeName: record.name,
      accent: record.params?.accent,
      mediaUrl: startup.media ? mediaUrl(record.source, record.id, startup.media) : null,
      reducedMotion,
      preview: true
    });
    return { html: createStartupPreviewHtml(config), config };
  }

  function pointerInfo() {
    return readJson(paths.pointer, null);
  }

  return {
    init,
    list,
    get,
    save,
    importTheme,
    remove,
    exportTheme,
    ensureLocalThemes,
    stats,
    previewStartup,
    findRecord,
    pointerInfo
  };
}
