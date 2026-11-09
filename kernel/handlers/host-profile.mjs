import path from 'node:path';
import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { AppError } from '../protocol/errors.mjs';
import { inspectHost, pickStart, pickPoll, pickCancel, testProfile } from '../host/wizard.mjs';
import { removeUserProfile, saveUserProfile, validateProfile } from '../host/user-profiles.mjs';
import { scanHosts } from '../host/autoscan.mjs';
import { switchHost } from '../host/switch.mjs';
import { safeSegment } from '../store/paths.mjs';
import { readJson } from '../store/json-file.mjs';

export default function register(registry, ctx) {
  const hosts = () => (ctx.hostRegistry ? ctx.hostRegistry.list() : []);

  registry.register(METHODS.HOST_PROFILE_LIST, METHOD_SCHEMAS[METHODS.HOST_PROFILE_LIST], async () => ({
    hosts: hosts(),
    active: ctx.hostProfile ? ctx.hostProfile.id : null
  }));

  // 读取已保存的用户 profile 原始数据（含 launchEnv/skin 这类表单不管的字段），给向导编辑用
  registry.register(METHODS.HOST_PROFILE_GET, METHOD_SCHEMAS[METHODS.HOST_PROFILE_GET], async ({ id }) => {
    const clean = String(id || '');
    if (!safeSegment(clean)) throw new AppError('BAD_PARAMS', `宿主 id 不合法：${clean.slice(0, 40)}`);
    const profile = readJson(path.join(ctx.paths.hosts, `${clean}.json`), null);
    if (!profile || profile.id !== clean) {
      throw new AppError('HOST_NOT_FOUND', `没有保存过宿主「${clean}」`);
    }
    return { profile };
  });

  // 一键发现：扫本机调试端口 + 只读指纹，直接给出可保存的 profile 建议
  registry.register(METHODS.HOST_AUTOSCAN, METHOD_SCHEMAS[METHODS.HOST_AUTOSCAN], async () => {
    const knownProfiles = (ctx.hostRegistry ? ctx.hostRegistry.list() : [])
      .map((host) => ctx.hostRegistry.get(host.id))
      .filter(Boolean);
    const found = await scanHosts({
      appRoot: ctx.paths.appRoot,
      logger: ctx.logger,
      knownProfiles
    });
    return { found, hosts: hosts(), active: ctx.hostProfile ? ctx.hostProfile.id : null };
  });

  // 一键接入：先试穿（应用→暂停→继续→恢复，不动 pointer），过了才落盘注册
  registry.register(METHODS.HOST_AUTOIMPORT, METHOD_SCHEMAS[METHODS.HOST_AUTOIMPORT], async (params) => {
    const validated = validateProfile(params.profile);
    if (!validated.ok) {
      return { ok: false, stage: 'validate', errors: validated.errors };
    }
    const test = await testProfile({
      profile: validated.profile,
      appRoot: ctx.paths.appRoot,
      paths: ctx.paths,
      logger: ctx.logger
    });
    if (!test.ok) {
      ctx.logger?.warn('autoimport try-on failed', { id: validated.profile.id, error: test.error });
      return { ok: false, stage: 'tryon', test };
    }
    const saved = saveUserProfile(ctx.paths.hosts, validated.profile);
    if (!saved.ok) {
      return { ok: false, stage: 'save', errors: saved.errors };
    }
    if (ctx.hostRegistry) ctx.hostRegistry.reload();
    ctx.logger?.info('host auto-imported', { id: saved.profile.id, path: saved.path });
    return { ok: true, profile: saved.profile, test, hosts: hosts() };
  });

  // 一键切换：换活动宿主并自动补上它上次的壁纸
  registry.register(METHODS.HOST_USE, METHOD_SCHEMAS[METHODS.HOST_USE], async (params) => (
    switchHost(ctx, params.id)
  ));

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

  registry.register(METHODS.HOST_PROFILE_REMOVE, METHOD_SCHEMAS[METHODS.HOST_PROFILE_REMOVE], async (params) => {
    const key = String(params.id || '').toLowerCase();
    const target = hosts().find((host) => host.id === key);
    if (!target || target.source !== 'user') {
      throw new AppError('HOST_NOT_FOUND', '自定义宿主不存在或不可删除');
    }
    if (ctx.hostProfile?.id === key) await switchHost(ctx, 'zcode');

    const removed = removeUserProfile(ctx.paths.hosts, key);
    if (!removed.ok) throw new AppError('HOST_NOT_FOUND', removed.errors.join('；'));
    if (ctx.hostRegistry) ctx.hostRegistry.reload();

    const prefs = ctx.config.get();
    const hostThemes = { ...(prefs.hostThemes || {}) };
    delete hostThemes[key];
    ctx.config.set({ hostThemes, ...(prefs.hostId === key ? { hostId: 'zcode' } : {}) });
    ctx.logger?.info('host profile removed', { id: key, path: removed.path });
    return { ok: true, id: key, hosts: hosts(), active: ctx.hostProfile ? ctx.hostProfile.id : null };
  });
}
