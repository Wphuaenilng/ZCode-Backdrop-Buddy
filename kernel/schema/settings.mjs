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
        builtinOverrides: {
          type: 'object',
          additionalProperties: params
        }
      }
    }
  }
};
