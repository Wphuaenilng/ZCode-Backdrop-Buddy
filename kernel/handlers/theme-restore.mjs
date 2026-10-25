import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { restoreThemeState } from './theme-state.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.THEME_RESTORE, METHOD_SCHEMAS[METHODS.THEME_RESTORE], async () => restoreThemeState(ctx));
}
