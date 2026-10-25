import { EMPTY, params, themeId, themeName } from './common.mjs';

export const hostDetect = EMPTY;
export const hostStatus = EMPTY;
export const hostRestore = EMPTY;

export const hostRestart = {
  type: 'object',
  additionalProperties: false,
  properties: { reapply: { type: 'boolean', default: true } }
};

export const hostApply = {
  type: 'object',
  additionalProperties: false,
  required: ['themeId'],
  properties: { themeId, name: themeName, params }
};

export const hostPort = {
  type: 'object',
  additionalProperties: false,
  required: ['port'],
  properties: { port: { type: 'integer', minimum: 1024, maximum: 65535 } }
};

export const hostProfileBody = {
  type: 'object',
  additionalProperties: false,
  required: ['profile'],
  properties: { profile: { type: 'object' } }
};
