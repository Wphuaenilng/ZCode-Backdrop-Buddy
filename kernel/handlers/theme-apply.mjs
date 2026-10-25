import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { applyThemeState } from './theme-state.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.THEME_APPLY, METHOD_SCHEMAS[METHODS.THEME_APPLY], async (params) => (
    applyThemeState(ctx, params)
  ));
}
