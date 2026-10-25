import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { restoreThemeState } from './theme-state.mjs';

function clearActiveTheme(ctx) {
  try { ctx.pointer.clear(); } catch { /* pointer rewrite is best effort here */ }
  try { ctx.config.set({ selectedThemeId: null, lastAppliedThemeId: null }); } catch { /* config persistence must not mask the failure */ }
}

export default function register(registry, ctx) {
  registry.register(METHODS.THEME_REMOVE, METHOD_SCHEMAS[METHODS.THEME_REMOVE], async ({ themeId }) => {
    const result = await ctx.library.remove(themeId);
    if (ctx.pointer.read().activeThemeId !== themeId) return result;

    try {
      return { ...result, restore: await restoreThemeState(ctx) };
    } catch (error) {
      ctx.logger?.warn('theme removed but host restore failed', {
        themeId,
        code: error.code || 'INTERNAL',
        message: error.message
      });
      clearActiveTheme(ctx);
      return {
        ...result,
        restoreFailed: {
          code: error.code || 'INTERNAL',
          message: error.message || 'host restore failed',
          retryable: !!error.retryable
        }
      };
    }
  });
}
