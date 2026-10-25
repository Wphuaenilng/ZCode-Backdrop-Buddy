import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.THEME_EXPORT, METHOD_SCHEMAS[METHODS.THEME_EXPORT], async ({ themeId, destPath }) => (
    ctx.library.exportTheme(themeId, destPath)
  ));
}
