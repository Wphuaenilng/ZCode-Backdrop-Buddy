import { METHODS, MAX_MESSAGE_BYTES } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { buildCapabilities, shellMethods } from '../app/capabilities.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.SYSTEM_HELLO, METHOD_SCHEMAS[METHODS.SYSTEM_HELLO], async () => ({
    protocol: ctx.protocol,
    kernel: 'backdropbuddy-kernel/' + ctx.productVersion,
    node: process.version,
    mode: ctx.mode,
    startedAt: ctx.startedAt,
    capabilities: buildCapabilities(ctx.registry),
    localMethods: shellMethods(),
    limits: { maxMessageBytes: MAX_MESSAGE_BYTES },
    dataRoot: ctx.paths.root,
    mediaBase: 'https://media.backdropbuddy.invalid',
    tools: ctx.toolsSummary
  }));

  registry.register(METHODS.SYSTEM_PING, METHOD_SCHEMAS[METHODS.SYSTEM_PING], async () => ({
    pong: true,
    at: Date.now()
  }));

  registry.register(METHODS.SYSTEM_SHUTDOWN, METHOD_SCHEMAS[METHODS.SYSTEM_SHUTDOWN], async () => {
    setImmediate(() => ctx.lifecycle.shutdown('system.shutdown'));
    return { ok: true };
  });
}
