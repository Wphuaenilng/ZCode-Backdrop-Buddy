import { PROTOCOL_VERSION } from '../../shared/protocol/constants.mjs';
import { createContext } from './context.mjs';
import { createLifecycle } from './lifecycle.mjs';
import { resolveDataRoot, resolveAppRoot, resolveLogLevel, resolveProductVersion } from '../platform/env.mjs';
import { resolvePaths, ensureDirs } from '../store/paths.mjs';
import { createLibrary } from '../store/library.mjs';
import { KeyedMutex } from '../store/locks.mjs';
import { ConfigStore } from '../store/config.mjs';
import { PointerStore } from '../store/pointer.mjs';
import { RuntimeStore } from '../store/runtime.mjs';
import { createLogger } from '../util/logger.mjs';
import { resolveTools, toolSummary } from '../media/tooling.mjs';
import { probeMedia } from '../media/probe.mjs';
import { hashFile } from '../media/hashing.mjs';
import { createMediaService } from '../media/thumbnail.mjs';
import { cleanCache } from '../media/cache.mjs';
import { createDetector } from '../host/detect.mjs';
import { createHostAdapter } from '../host/adapter.mjs';
import { createRegistry } from '../host/registry.mjs';
import { discoverExecutable } from '../host/zcode.mjs';
import { EventBus } from '../protocol/event-bus.mjs';
import { Router } from '../protocol/router.mjs';
import { MethodRegistry } from '../protocol/method-registry.mjs';
import { registerHandlers } from '../handlers/index.mjs';
import { applyThemeState } from '../handlers/theme-state.mjs';
import { runSchedule } from '../schedule/service.mjs';

export async function createKernel(options = {}) {
  const env = options.env || process.env;
  const mode = options.mode || 'manager';
  const dataRoot = options.dataDir || resolveDataRoot(env);
  const appRoot = options.appRoot || resolveAppRoot(env);
  const paths = resolvePaths({ dataRoot, appRoot });
  ensureDirs(paths);

  const logger = options.logger || createLogger({
    dir: paths.logs,
    level: options.logLevel || resolveLogLevel(env),
    echo: !!options.echo
  });

  const tools = resolveTools({
    env,
    ffmpeg: options.ffmpeg,
    ffprobe: options.ffprobe
  });

  const mediaBase = createMediaService({ cacheDir: paths.cache, tools, logger });
  const media = {
    ...mediaBase,
    probe: (file) => probeMedia(file, { tools }),
    hash: hashFile
  };

  const locks = new KeyedMutex();
  const config = new ConfigStore(paths.config);
  const pointer = new PointerStore(paths.pointer);
  const runtime = new RuntimeStore(paths.runtime);
  const library = options.library || createLibrary({ paths, logger, media, locks });
  library.init();

  const cachedRemoved = cleanCache(paths.cache);
  if (cachedRemoved) logger.info('cache pruned', { removed: cachedRemoved });

  const seeding = (async () => {
    if (options.seedLocalAssets === false || typeof library.ensureLocalThemes !== 'function') return null;
    try {
      const seeded = await library.ensureLocalThemes({ assetRoot: paths.assets, config });
      if (!seeded.skipped) logger.info('local theme assets ready', seeded);
      return seeded;
    } catch (error) {
      logger.warn('local theme asset seeding failed', { message: error.message });
      return null;
    }
  })();
  if (!options.deferSeeding) await seeding;

  const productVersion = resolveProductVersion(appRoot, env);
  const preferences = config.get();
  const hostRegistry = options.registry || createRegistry({ hostsDir: paths.hosts });
  let profile = options.profile;
  if (!profile) {
    const activeHostId = String(env.BACKDROPBUDDY_HOST || preferences.hostId || 'zcode').toLowerCase();
    let resolveEnv = env;
    if (activeHostId === 'zcode' && !options.host && !options.detector) {
      try {
        const discovered = await discoverExecutable({
          appRoot,
          env,
          configured: preferences.zcodePath || null
        });
        if (discovered) {
          resolveEnv = { ...env, ZCODE_PATH: discovered.path };
          logger.info('zcode executable located', discovered);
          if (!['env', 'default', 'config'].includes(discovered.source) && preferences.zcodePath !== discovered.path) {
            try { config.set({ zcodePath: discovered.path }); } catch { /* best effort */ }
          }
        }
      } catch (error) {
        logger.warn('zcode executable discovery failed', { message: error.message });
      }
    }
    profile = hostRegistry.resolve(resolveEnv, preferences.hostId || null);
  }
  const detector = options.detector || createDetector({ profile, appRoot, logger });
  const host = options.host || createHostAdapter({
    detector,
    logger,
    appRoot,
    paths,
    profile,
    runtime,
    getPreferences: () => config.get(),
    getStartupTheme: () => library.get(config.get().selectedThemeId || config.get().lastAppliedThemeId),
    session: options.session
  });
  const bus = new EventBus();
  const lifecycle = createLifecycle({ logger, onClose: options.onClose });

  const ctx = createContext({
    protocol: PROTOCOL_VERSION,
    productVersion,
    mode,
    startedAt: Date.now(),
    paths,
    logger,
    tools,
    toolsSummary: toolSummary(tools),
    media,
    library,
    config,
    pointer,
    host,
    hostRegistry,
    hostProfile: profile,
    bus,
    lifecycle,
    switchHostDeps: {
      buildAdapter: options.buildHostAdapter || ((nextProfile) => createHostAdapter({
        detector: createDetector({ profile: nextProfile, appRoot, logger }),
        logger,
        appRoot,
        paths,
        profile: nextProfile,
        runtime,
        getPreferences: () => config.get(),
        getStartupTheme: () => library.get(config.get().selectedThemeId || config.get().lastAppliedThemeId),
        session: options.session
      }))
    }
  });

  const router = new Router();
  const registry = new MethodRegistry(router);
  ctx.registry = registry;
  ctx.seeding = seeding;
  registerHandlers(registry, ctx);

  logger.info('kernel ready', {
    mode,
    dataRoot: paths.root,
    methods: registry.size,
    ffmpeg: !!tools.ffmpeg,
    ffprobe: !!tools.ffprobe
  });

  const pointerBefore = pointer.read();
  const adoption = typeof host.adopt === 'function' ? host.adopt(pointer) : null;

  const runAudit = async (outcome) => {
    if (typeof host.audit !== 'function') return null;
    try {
      const result = await host.audit({
        pointerValue: pointerBefore,
        adoption: adoption
          ? { adopted: !!adoption.adopted, reason: adoption.reason || null, outcome: outcome || null }
          : null
      });
      bus.emit('recovery.status', result);
      return result;
    } catch (error) {
      logger.warn('startup audit failed', { message: error.message });
      return null;
    }
  };

  let auditReady = Promise.resolve(null);

  if (adoption && adoption.ready && typeof adoption.ready.then === 'function') {
    auditReady = adoption.ready
      .then(async (outcome) => {
        if (outcome && outcome.cleared) {
          // 记录里说在跑、页面上却没有：清掉"当前在跑"的指针与选中项，
          // 但 lastAppliedThemeId 是"上次用过的主题"，要留着——否则开了「启动时自动应用」
          // 的用户遇到宿主重载/重启后就再也不会被自动换回。
          try { config.set({ selectedThemeId: null }); } catch { /* ignore */ }
          bus.emit('theme.status', {
            themeId: null,
            name: null,
            paused: false,
            state: 'restored',
            ephemeral: false,
            reason: outcome.reason
          });
        } else if (outcome) {
          const pointerValue = pointer.read();
          if (pointerValue.activeThemeId && pointerValue.paused !== adoption.paused) {
            try { pointer.write({ activeThemeId: pointerValue.activeThemeId, paused: adoption.paused }); } catch { /* ignore */ }
          }
        }

        return runAudit(outcome || null);
      })
      .catch((error) => {
        logger.warn('host adoption failed', { message: error.message });
        return null;
      });
  } else {
    auditReady = host.detect()
      .then(() => runAudit(null))
      .catch((error) => {
        logger.warn('initial host detect failed', { message: error.message });
        return null;
      });
  }

  // applyOnStart 与启动期的调度评估都可能在开机时应用主题；
  // selfApplying 让它们内部的 applyThemeState 不再回头 await 自己（否则死锁）。
  let selfApplying = false;
  const startupTask = auditReady
    .then(async () => {
      selfApplying = true;
      try {
        const prefs = config.get();
        let applied = null;
        if (prefs.applyOnStart && !pointer.read().activeThemeId) {
          const candidate = prefs.lastAppliedThemeId || prefs.selectedThemeId || null;
          if (candidate && library.get(candidate)) {
            applied = await applyThemeState(ctx, { themeId: candidate });
            logger.info('applied on start', { themeId: candidate });
          } else {
            logger.info('apply on start skipped', { reason: 'no theme to apply', candidate });
          }
        }

        // 顺带记录此刻的明暗观测：规则要的是"看着它变了"，不是"开机就触发"
        const scheduled = await runSchedule(ctx, { reason: 'startup' });
        return { applied, scheduled };
      } finally {
        selfApplying = false;
      }
    })
    .catch((error) => {
      logger.warn('startup task failed', { message: error.message });
      return null;
    });

  ctx.awaitStartup = async () => {
    if (selfApplying) return;
    try { await startupTask; } catch { /* 失败已在上面记录 */ }
  };

  return {
    ctx,
    router,
    registry,
    bus,
    lifecycle,
    logger,
    paths,
    adoption,
    audit: auditReady,
    startup: startupTask,
    handle: (message) => router.handle(message),
    close: () => lifecycle.shutdown('kernel.close')
  };
}
