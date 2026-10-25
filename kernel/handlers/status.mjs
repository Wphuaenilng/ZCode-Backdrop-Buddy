import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { activeTheme } from './theme-state.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.STATUS_GET, METHOD_SCHEMAS[METHODS.STATUS_GET], async () => {
    const { pointer, theme, ephemeral } = activeTheme(ctx);
    const hostStatus = ctx.host.status();
    const prefs = ctx.config.get();

    return {
      protocol: ctx.protocol,
      kernel: 'backdropbuddy-kernel/' + ctx.productVersion,
      node: process.version,
      startedAt: ctx.startedAt,
      uptimeMs: Date.now() - ctx.startedAt,
      host: hostStatus,
      hostId: ctx.hostProfile ? ctx.hostProfile.id : null,
      hostName: ctx.hostProfile ? ctx.hostProfile.name : null,
      theme: theme ? { themeId: theme.id, name: theme.name, ephemeral } : null,
      running: !!theme,
      paused: !!pointer.paused,
      preferences: { applyOnStart: !!prefs.applyOnStart, reducedMotion: !!prefs.reducedMotion },
      store: ctx.library.stats(),
      tools: ctx.toolsSummary
    };
  });
}
