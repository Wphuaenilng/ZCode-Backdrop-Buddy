import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { AppError } from '../protocol/errors.mjs';
import { inspectHost, pickStart, pickPoll, pickCancel, testProfile } from '../host/wizard.mjs';
import { saveUserProfile } from '../host/user-profiles.mjs';

export default function register(registry, ctx) {
  const hosts = () => (ctx.hostRegistry ? ctx.hostRegistry.list() : []);

  registry.register(METHODS.HOST_PROFILE_LIST, METHOD_SCHEMAS[METHODS.HOST_PROFILE_LIST], async () => ({
    hosts: hosts(),
    active: ctx.hostProfile ? ctx.hostProfile.id : null
  }));

  registry.register(METHODS.HOST_INSPECT, METHOD_SCHEMAS[METHODS.HOST_INSPECT], async (params) => (
    inspectHost({ port: params.port })
  ));

  registry.register(METHODS.HOST_PICK_START, METHOD_SCHEMAS[METHODS.HOST_PICK_START], async (params) => (
    pickStart({ port: params.port })
  ));

  registry.register(METHODS.HOST_PICK_POLL, METHOD_SCHEMAS[METHODS.HOST_PICK_POLL], async (params) => (
    pickPoll({ port: params.port })
  ));

  registry.register(METHODS.HOST_PICK_CANCEL, METHOD_SCHEMAS[METHODS.HOST_PICK_CANCEL], async (params) => (
    pickCancel({ port: params.port })
  ));

  registry.register(METHODS.HOST_PROFILE_TEST, METHOD_SCHEMAS[METHODS.HOST_PROFILE_TEST], async (params) => (
    testProfile({
      profile: params.profile,
      appRoot: ctx.paths.appRoot,
      paths: ctx.paths,
      logger: ctx.logger
    })
  ));

  registry.register(METHODS.HOST_PROFILE_SAVE, METHOD_SCHEMAS[METHODS.HOST_PROFILE_SAVE], async (params) => {
    const saved = saveUserProfile(ctx.paths.hosts, params.profile);
    if (!saved.ok) {
      throw new AppError('BAD_PARAMS', '宿主配置不合法：' + saved.errors.join('；'), { details: saved.errors });
    }
    if (ctx.hostRegistry) ctx.hostRegistry.reload();
    ctx.logger?.info('host profile saved', { id: saved.profile.id, path: saved.path });
    return { ok: true, profile: saved.profile, path: saved.path, hosts: hosts() };
  });
}
