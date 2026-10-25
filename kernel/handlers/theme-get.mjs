import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { AppError } from '../protocol/errors.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.THEME_GET, METHOD_SCHEMAS[METHODS.THEME_GET], async ({ themeId }) => {
    const theme = ctx.library.get(themeId);
    if (!theme) throw new AppError('THEME_NOT_FOUND', `theme not found: ${themeId}`);
    return { theme };
  });
}
