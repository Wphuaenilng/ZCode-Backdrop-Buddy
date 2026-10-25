import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.LOG_TAIL, METHOD_SCHEMAS[METHODS.LOG_TAIL], async ({ limit }) => ({
    lines: ctx.logger.tail(limit)
  }));
}
