import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.THEME_STARTUP_PREVIEW, METHOD_SCHEMAS[METHODS.THEME_STARTUP_PREVIEW], async ({ themeId }) => {
    return ctx.library.previewStartup(themeId, {
      reducedMotion: ctx.config.get().reducedMotion === true
    });
  });
}
