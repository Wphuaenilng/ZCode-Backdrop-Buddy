// 运行时切换宿主：换掉 ctx.host / ctx.hostProfile（适配器按 profile 装配），
// 重跑 detect/adopt/audit，然后把这个宿主上次用的壁纸补回去。
// 用户不再需要 BACKDROPBUDDY_HOST 环境变量——界面里点一下就换。
import { AppError } from '../protocol/errors.mjs';
import { applyThemeState } from '../handlers/theme-state.mjs';

export async function switchHost(ctx, id, deps = {}) {
  const key = String(id || '').toLowerCase();
  if (!key) throw new AppError('BAD_PARAMS', '缺少宿主 id');

  const buildAdapter = deps.buildAdapter || ctx.switchHostDeps?.buildAdapter;
  if (!buildAdapter) throw new AppError('BAD_PARAMS', '这个内核不支持运行时切换宿主');

  const registry = ctx.hostRegistry;
  // 切换要继承进程环境（ZCODE_PATH 这类启动期注入不落盘，env 是唯一来源），
  // 再叠加 config 里持久化的修正值；否则内置 zcode 会回落到编译期默认路径。
  const prefs = ctx.config.get();
  const resolveEnv = { ...process.env, BACKDROPBUDDY_HOST: key };
  if (key === 'zcode' && prefs.zcodePath) resolveEnv.ZCODE_PATH = prefs.zcodePath;
  const nextProfile = registry ? registry.resolve(resolveEnv, key) : null;
  if (!nextProfile) {
    const known = registry ? registry.list().map((h) => h.id).join(' / ') : '';
    throw new AppError('HOST_NOT_FOUND', `未知宿主 "${key}"，可选：${known}`);
  }

  const previous = ctx.hostProfile ? ctx.hostProfile.id : null;
  if (previous === nextProfile.id) {
    return { ok: true, hostId: nextProfile.id, name: nextProfile.name, switched: false };
  }

  // 旧宿主上正在跑的皮肤留在原页面（注入不跨进程消失）；指针语义交给新宿主的 adopt/audit 校对
  try { ctx.config.set({ hostId: nextProfile.id }); } catch { /* 尽力而为 */ }
  const nextAdapter = buildAdapter(nextProfile);
  ctx.host = nextAdapter;
  ctx.hostProfile = nextProfile;
  ctx.bus.emit('host.switched', { from: previous, to: nextProfile.id, name: nextProfile.name });

  // 与内核启动同款的认领/审计序列：指针说在跑、页面说没有 → 清指针；页面有残留 → 认领或报告
  const pointerBefore = ctx.pointer.read();
  let adoption = null;
  try {
    adoption = typeof nextAdapter.adopt === 'function' ? nextAdapter.adopt(ctx.pointer) : null;
  } catch (error) {
    ctx.logger?.warn('switch adopt failed', { host: nextProfile.id, message: error.message });
  }

  if (adoption && adoption.ready && typeof adoption.ready.then === 'function') {
    const outcome = await adoption.ready.catch((error) => {
      ctx.logger?.warn('switch adoption failed', { host: nextProfile.id, message: error.message });
      return null;
    });
    ctx.logger?.info('switch adopt outcome', { host: nextProfile.id, outcome: outcome || null });
    if (outcome && outcome.cleared) {
      try { ctx.config.set({ selectedThemeId: null }); } catch { /* ignore */ }
      ctx.bus.emit('theme.status', {
        themeId: null, name: null, paused: false, state: 'restored', ephemeral: false, reason: outcome.reason
      });
    }
  }

  let audit = null;
  try {
    audit = await nextAdapter.audit({ pointerValue: pointerBefore, adoption: null });
    ctx.bus.emit('recovery.status', audit);
  } catch (error) {
    ctx.logger?.warn('switch audit failed', { host: nextProfile.id, message: error.message });
  }

  // 每宿主壁纸记忆：新宿主此刻没有在跑的主题、但记忆里有 → 自动换上它上次的壁纸
  let appliedTheme = null;
  const remembered = prefs.hostThemes && prefs.hostThemes[nextProfile.id];
  if (!remembered) {
    ctx.logger?.info('switch auto-apply skipped', { host: nextProfile.id, reason: 'no-memory' });
  } else if (ctx.pointer.read().activeThemeId) {
    ctx.logger?.info('switch auto-apply skipped', { host: nextProfile.id, reason: 'already-running', active: ctx.pointer.read().activeThemeId });
  } else if (!ctx.library.get(remembered)) {
    ctx.logger?.info('switch auto-apply skipped', { host: nextProfile.id, reason: 'theme-missing', themeId: remembered });
  }
  if (remembered && !ctx.pointer.read().activeThemeId && ctx.library.get(remembered)) {
    try {
      await applyThemeState(ctx, { themeId: remembered });
      appliedTheme = remembered;
      ctx.logger?.info('host theme restored on switch', { host: nextProfile.id, themeId: remembered });
    } catch (error) {
      ctx.logger?.warn('host theme restore on switch failed', { host: nextProfile.id, message: error.message });
    }
  }

  try {
    const status = await nextAdapter.detect({ force: true });
    ctx.bus.emit('host.status', status);
  } catch (error) {
    ctx.logger?.warn('switch detect failed', { host: nextProfile.id, message: error.message });
  }

  return { ok: true, hostId: nextProfile.id, name: nextProfile.name, switched: true, audit, appliedTheme };
}
