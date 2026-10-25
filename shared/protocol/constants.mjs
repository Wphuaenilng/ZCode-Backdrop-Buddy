export const PROTOCOL_VERSION = 'dreamskin.manager/1';
export const MAX_MESSAGE_BYTES = 1024 * 1024;
export const DEDUPE_WINDOW = 1024;

export const REQUEST = 'request';
export const RESPONSE = 'response';
export const EVENT = 'event';

export const METHODS = Object.freeze({
  SYSTEM_HELLO: 'system.hello',
  SYSTEM_PING: 'system.ping',
  SYSTEM_SHUTDOWN: 'system.shutdown',
  STATUS_GET: 'status.get',
  THEME_LIST: 'theme.list',
  THEME_GET: 'theme.get',
  THEME_SAVE: 'theme.save',
  THEME_REMOVE: 'theme.remove',
  THEME_IMPORT: 'theme.import',
  THEME_EXPORT: 'theme.export',
  THEME_APPLY: 'theme.apply',
  THEME_PAUSE: 'theme.pause',
  THEME_RESUME: 'theme.resume',
  THEME_RESET: 'theme.reset',
  THEME_RESTORE: 'theme.restore',
  SETTINGS_GET: 'settings.get',
  SETTINGS_SET: 'settings.set',
  SCHEDULE_LIST: 'schedule.list',
  SCHEDULE_SAVE: 'schedule.save',
  SCHEDULE_REMOVE: 'schedule.remove',
  SCHEDULE_TICK: 'schedule.tick',
  HOST_DETECT: 'host.detect',
  HOST_STATUS: 'host.status',
  HOST_APPLY: 'host.apply',
  HOST_RESTORE: 'host.restore',
  HOST_RESTART: 'host.restart',
  HOST_INSPECT: 'host.inspect',
  HOST_PICK_START: 'host.pick.start',
  HOST_PICK_POLL: 'host.pick.poll',
  HOST_PICK_CANCEL: 'host.pick.cancel',
  HOST_PROFILE_LIST: 'host.profile.list',
  HOST_PROFILE_TEST: 'host.profile.test',
  HOST_PROFILE_SAVE: 'host.profile.save',
  HOST_AUTOSCAN: 'host.autoscan',
  HOST_AUTOIMPORT: 'host.autoimport',
  HOST_USE: 'host.use',
  FILE_PICK: 'file.pick',
  FILE_VALIDATE: 'file.validate',
  MEDIA_URL: 'media.url',
  LOG_TAIL: 'log.tail'
});

export const ERRORS = Object.freeze({
  BAD_ENVELOPE: 'BAD_ENVELOPE',
  HANDSHAKE_REQUIRED: 'HANDSHAKE_REQUIRED',
  METHOD_NOT_FOUND: 'METHOD_NOT_FOUND',
  BAD_PARAMS: 'BAD_PARAMS',
  MESSAGE_TOO_LARGE: 'MESSAGE_TOO_LARGE',
  BUSY: 'BUSY',
  HOST_NOT_FOUND: 'HOST_NOT_FOUND',
  HOST_NOT_READY: 'HOST_NOT_READY',
  HOST_UNREACHABLE: 'HOST_UNREACHABLE',
  HOST_UNSUPPORTED: 'HOST_UNSUPPORTED',
  HOST_INJECTION_REJECTED: 'HOST_INJECTION_REJECTED',
  HOST_RESTART_FAILED: 'HOST_RESTART_FAILED',
  THEME_NOT_FOUND: 'THEME_NOT_FOUND',
  THEME_EXISTS: 'THEME_EXISTS',
  MEDIA_INVALID: 'MEDIA_INVALID',
  MEDIA_TOO_LARGE: 'MEDIA_TOO_LARGE',
  FILE_NOT_FOUND: 'FILE_NOT_FOUND',
  PATH_OUTSIDE_ROOT: 'PATH_OUTSIDE_ROOT',
  TRANSACTION_FAILED: 'TRANSACTION_FAILED',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  TIMEOUT: 'TIMEOUT',
  KERNEL_UNAVAILABLE: 'KERNEL_UNAVAILABLE',
  INTERNAL: 'INTERNAL'
});
