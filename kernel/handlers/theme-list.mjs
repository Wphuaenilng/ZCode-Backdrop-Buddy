import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.THEME_LIST, METHOD_SCHEMAS[METHODS.THEME_LIST], async ({ source }) => {
    // Local asset seeding may still be copying media during kernel startup.
    if (ctx.seeding) await ctx.seeding;
    const themes = ctx.library.list({ source });
    return { themes, count: themes.length };
  });
}
