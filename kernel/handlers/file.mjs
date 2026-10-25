import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { notImplemented } from '../protocol/errors.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.FILE_PICK, METHOD_SCHEMAS[METHODS.FILE_PICK], async () => {
    throw notImplemented('file.pick is handled by the shell; call it directly from the UI');
  });

  registry.register(METHODS.FILE_VALIDATE, METHOD_SCHEMAS[METHODS.FILE_VALIDATE], async ({ path }) => {
    const info = await ctx.media.probe(path);
    return {
      valid: true,
      kind: info.kind,
      mime: info.mime,
      bytes: info.bytes,
      width: info.width,
      height: info.height,
      duration: info.duration
    };
  });
}
