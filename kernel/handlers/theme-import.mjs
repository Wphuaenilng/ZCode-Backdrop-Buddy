import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.THEME_IMPORT, METHOD_SCHEMAS[METHODS.THEME_IMPORT], async (params) => ({
    theme: await ctx.library.importTheme(params)
  }));
}
