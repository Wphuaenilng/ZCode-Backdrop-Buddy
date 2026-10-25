import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { resetThemeState } from './theme-state.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.THEME_RESET, METHOD_SCHEMAS[METHODS.THEME_RESET], async () => resetThemeState(ctx));
}
