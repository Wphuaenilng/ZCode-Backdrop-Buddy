import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { applyThemeState, restoreThemeState } from './theme-state.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.HOST_DETECT, METHOD_SCHEMAS[METHODS.HOST_DETECT], async () => {
    const status = await ctx.host.detect({ force: true });
    ctx.bus.emit('host.status', status);

    if (typeof ctx.host.audit !== 'function') return status;

    try {
      const recovery = await ctx.host.audit({ pointerValue: ctx.pointer.read(), adoption: null });
      ctx.bus.emit('recovery.status', recovery);
      return { ...status, recovery };
    } catch (error) {
      ctx.logger?.warn('host audit failed', { message: error.message });
      return status;
    }
  });

  registry.register(METHODS.HOST_STATUS, METHOD_SCHEMAS[METHODS.HOST_STATUS], async () => ctx.host.status());

  registry.register(METHODS.HOST_APPLY, METHOD_SCHEMAS[METHODS.HOST_APPLY], async (params) => (
    applyThemeState(ctx, params)
  ));

  registry.register(METHODS.HOST_RESTORE, METHOD_SCHEMAS[METHODS.HOST_RESTORE], async () => (
    restoreThemeState(ctx)
  ));

  registry.register(METHODS.HOST_RESTART, METHOD_SCHEMAS[METHODS.HOST_RESTART], async (params) => {
    const result = await ctx.host.restart({ reapply: params.reapply !== false });
    if (result.status) ctx.bus.emit('host.status', result.status);
    return result;
  });
}
