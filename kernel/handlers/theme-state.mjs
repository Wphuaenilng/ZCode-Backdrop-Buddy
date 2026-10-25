import { AppError } from '../protocol/errors.mjs';

export function activeTheme(ctx) {
  const pointer = ctx.pointer.read();
  if (!pointer.activeThemeId) return { pointer, theme: null, ephemeral: false };

  const stored = ctx.library.get(pointer.activeThemeId);
  if (stored) return { pointer, theme: stored, ephemeral: false };

  return {
    pointer,
    ephemeral: true,
    theme: {
      id: pointer.activeThemeId,
      name: pointer.activeName || pointer.activeThemeId,
      params: pointer.params || {},
      media: null,
      ephemeral: true
    }
  };
}

function emitStatus(ctx, { theme, paused, state, ephemeral, dryRun = false, host = null }) {
  ctx.bus.emit('theme.status', {
    themeId: theme ? theme.id : null,
    name: theme ? theme.name : null,
    paused: !!paused,
    state,
    ephemeral: !!ephemeral,
    dryRun: !!dryRun,
    ...(host ? { host } : {})
  });
}

export async function applyThemeState(ctx, { themeId, name, params }) {
  // 启动期的 applyOnStart 可能正在注入；先让它收口，避免两次应用交错
  if (typeof ctx.awaitStartup === 'function') await ctx.awaitStartup();
  const stored = ctx.library.get(themeId);
  const theme = stored || {
    id: themeId,
    name: name || themeId,
    params: params || {},
    media: null,
    ephemeral: true
  };

  const mergedParams = { ...(theme.params || {}), ...(params || {}) };
  const hostResult = await ctx.host.apply({ theme, params: mergedParams });
  const previous = ctx.pointer.read();

  try {
    const pointer = ctx.pointer.write({
      activeThemeId: theme.id,
      activeName: theme.name,
      params: mergedParams,
      paused: false
    });
    try {
      ctx.config.set({ selectedThemeId: theme.id, lastAppliedThemeId: theme.id });
    } catch { /* config persistence must not block a successful apply */ }
    emitStatus(ctx, {
      theme,
      paused: false,
      state: 'running',
      ephemeral: !stored,
      dryRun: hostResult.dryRun,
      host: hostResult
    });
    return {
      themeId: theme.id,
      name: theme.name,
      paused: false,
      ephemeral: !stored,
      dryRun: !!hostResult.dryRun,
      injected: !!hostResult.injected,
      target: hostResult.target || null,
      windows: hostResult.windows || null,
      media: hostResult.media || null,
      snapshot: hostResult.snapshot || null,
      hostFiles: hostResult.hostFiles || null,
      revision: pointer.revision
    };
  } catch (error) {
    try { ctx.pointer.write(previous); } catch { /* best effort rollback */ }
    try { await ctx.host.restore(); } catch { /* best effort rollback */ }
    throw new AppError('TRANSACTION_FAILED', 'could not persist applied theme pointer', { details: { cause: error.message } });
  }
}

export async function setPausedState(ctx, paused) {
  const { pointer, theme, ephemeral } = activeTheme(ctx);
  if (!theme) throw new AppError('BAD_PARAMS', 'no theme is applied');

  const result = paused ? await ctx.host.pause() : await ctx.host.resume();

  let next;
  try {
    next = ctx.pointer.write({
      activeThemeId: theme.id,
      activeName: theme.name,
      params: pointer.params,
      paused
    });
  } catch (error) {
    try { if (paused) await ctx.host.resume(); else await ctx.host.pause(); } catch { /* best effort rollback */ }
    throw new AppError('TRANSACTION_FAILED', 'could not persist paused state', { details: { cause: error.message } });
  }

  emitStatus(ctx, { theme, paused, state: paused ? 'paused' : 'running', ephemeral, host: result });
  return {
    themeId: theme.id,
    paused,
    verified: result.verified,
    tokenMatch: result.tokenMatch === undefined ? null : result.tokenMatch,
    background: result.background,
    revision: next.revision
  };
}

export async function resetThemeState(ctx) {
  const { pointer, theme, ephemeral } = activeTheme(ctx);
  if (!theme) throw new AppError('BAD_PARAMS', 'no theme is applied');

  const result = await ctx.host.reset();
  const next = ctx.pointer.write({
    activeThemeId: theme.id,
    activeName: theme.name,
    params: {},
    paused: pointer.paused
  });
  emitStatus(ctx, { theme, paused: pointer.paused, state: pointer.paused ? 'paused' : 'running', ephemeral, host: result });
  return { themeId: theme.id, paused: pointer.paused, reset: true, revision: next.revision };
}

export async function restoreThemeState(ctx) {
  const { pointer, theme, ephemeral } = activeTheme(ctx);
  const result = await ctx.host.restore();
  const next = ctx.pointer.clear();
  try {
    // 恢复原貌只清"当前在跑什么"；上一次用过的主题要留着，
    // 否则开了「启动时自动应用」的用户恢复过一次之后就再也不会被自动换回。
    ctx.config.set({ selectedThemeId: null });
  } catch { /* ignore */ }
  emitStatus(ctx, {
    theme: null,
    paused: false,
    state: 'restored',
    ephemeral: false,
    host: result
  });
  return {
    restored: true,
    verified: result.verified,
    hostFiles: result.hostFiles || null,
    previousThemeId: theme ? theme.id : pointer.activeThemeId,
    revision: next.revision
  };
}
