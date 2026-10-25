import { themeId, params } from './common.mjs';

export const settingsGet = {
  type: 'object',
  additionalProperties: false,
  properties: {}
};

export const settingsSet = {
  type: 'object',
  additionalProperties: false,
  required: ['settings'],
  properties: {
    settings: {
      type: 'object',
      additionalProperties: false,
      properties: {
        selectedThemeId: { oneOf: [themeId, { type: 'null' }] },
        applyOnStart: { type: 'boolean' },
        reducedMotion: { type: 'boolean' },
        lastAppliedThemeId: { oneOf: [themeId, { type: 'null' }] },
        // ZCode.exe 的完整路径；null = 回到自动发现。只作为发现链的候选之一，
        // 路径不存在时内核会继续尝试其他候选，因此这里不做更严格的格式校验。
        zcodePath: { oneOf: [{ type: 'string', minLength: 1, maxLength: 512 }, { type: 'null' }] },
        builtinOverrides: {
          type: 'object',
          additionalProperties: params
        }
      }
    }
  }
};
