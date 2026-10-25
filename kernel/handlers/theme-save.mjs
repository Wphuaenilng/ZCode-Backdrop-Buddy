import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.THEME_SAVE, METHOD_SCHEMAS[METHODS.THEME_SAVE], async (params) => ({
    theme: await ctx.library.save(params)
  }));
}
