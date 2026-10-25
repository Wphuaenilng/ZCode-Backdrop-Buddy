import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { applyThemeState, activeTheme } from './theme-state.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.SETTINGS_GET, METHOD_SCHEMAS[METHODS.SETTINGS_GET], async () => ({
    settings: ctx.config.get()
  }));

  registry.register(METHODS.SETTINGS_SET, METHOD_SCHEMAS[METHODS.SETTINGS_SET], async ({ settings }) => {
    const before = ctx.config.get();
    const after = ctx.config.set(settings);
    const result = { settings: after };

    // 减弱动效改的是"素材用不用视频"，只对已经跑着的主题有可见差异，所以立刻按新偏好重放一次
    if (before.reducedMotion !== after.reducedMotion) {
      const { theme } = activeTheme(ctx);
      if (theme) {
        try {
          const applied = await applyThemeState(ctx, { themeId: theme.id, name: theme.name, params: theme.params });
          result.reapplied = { themeId: theme.id, media: applied.media || null };
        } catch (error) {
          result.reapplied = null;
          result.reapplyError = { code: error.code || 'TRANSACTION_FAILED', message: error.message };
        }
      }
    }
    return result;
  });
}
