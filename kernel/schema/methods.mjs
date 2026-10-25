import { METHODS, PROTOCOL_VERSION } from '../../shared/protocol/constants.mjs';
import { EMPTY } from './common.mjs';
import { themeList, themeGet, themeSave, themeRemove, themeImport, themeExport, themeApply, themeEmpty } from './theme.mjs';
import { mediaUrl } from './media.mjs';
import { settingsGet, settingsSet } from './settings.mjs';
import { scheduleList, scheduleSave, scheduleRemove, scheduleTick } from './schedule.mjs';
import { hostDetect, hostStatus, hostApply, hostRestore, hostRestart, hostPort, hostProfileBody, hostUse } from './host.mjs';
import { filePick, fileValidate } from './file.mjs';

export const PROTOCOL = PROTOCOL_VERSION;

export const METHOD_SCHEMAS = Object.freeze({
  [METHODS.SYSTEM_HELLO]: EMPTY,
  [METHODS.SYSTEM_PING]: EMPTY,
  [METHODS.SYSTEM_SHUTDOWN]: EMPTY,
  [METHODS.STATUS_GET]: EMPTY,
  [METHODS.THEME_LIST]: themeList,
  [METHODS.THEME_GET]: themeGet,
  [METHODS.THEME_SAVE]: themeSave,
  [METHODS.THEME_REMOVE]: themeRemove,
  [METHODS.THEME_IMPORT]: themeImport,
  [METHODS.THEME_EXPORT]: themeExport,
  [METHODS.THEME_APPLY]: themeApply,
  [METHODS.THEME_PAUSE]: themeEmpty,
  [METHODS.THEME_RESUME]: themeEmpty,
  [METHODS.THEME_RESET]: themeEmpty,
  [METHODS.THEME_RESTORE]: themeEmpty,
  [METHODS.SETTINGS_GET]: settingsGet,
  [METHODS.SETTINGS_SET]: settingsSet,
  [METHODS.SCHEDULE_LIST]: scheduleList,
  [METHODS.SCHEDULE_SAVE]: scheduleSave,
  [METHODS.SCHEDULE_REMOVE]: scheduleRemove,
  [METHODS.SCHEDULE_TICK]: scheduleTick,
  [METHODS.HOST_DETECT]: hostDetect,
  [METHODS.HOST_STATUS]: hostStatus,
  [METHODS.HOST_APPLY]: hostApply,
  [METHODS.HOST_RESTORE]: hostRestore,
  [METHODS.HOST_RESTART]: hostRestart,
  [METHODS.HOST_INSPECT]: hostPort,
  [METHODS.HOST_PICK_START]: hostPort,
  [METHODS.HOST_PICK_POLL]: hostPort,
  [METHODS.HOST_PICK_CANCEL]: hostPort,
  [METHODS.HOST_PROFILE_LIST]: EMPTY,
  [METHODS.HOST_PROFILE_TEST]: hostProfileBody,
  [METHODS.HOST_PROFILE_SAVE]: hostProfileBody,
  [METHODS.HOST_AUTOSCAN]: EMPTY,
  [METHODS.HOST_AUTOIMPORT]: hostProfileBody,
  [METHODS.HOST_USE]: hostUse,
  [METHODS.FILE_PICK]: filePick,
  [METHODS.FILE_VALIDATE]: fileValidate,
  [METHODS.MEDIA_URL]: mediaUrl,
  [METHODS.LOG_TAIL]: {
    type: 'object',
    additionalProperties: false,
    properties: { limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 } }
  }
});
