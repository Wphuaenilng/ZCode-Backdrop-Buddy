import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { setPausedState } from './theme-state.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.THEME_PAUSE, METHOD_SCHEMAS[METHODS.THEME_PAUSE], async () => setPausedState(ctx, true));
}
