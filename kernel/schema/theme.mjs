import { EMPTY, params, source, startup, tags, themeId, themeName, mediaFile, filePath } from './common.mjs';

export const themeList = {
  type: 'object',
  additionalProperties: false,
  properties: {
    source: { ...source, enum: ['all', 'builtin', 'user'], default: 'all' }
  }
};

export const themeGet = {
  type: 'object',
  additionalProperties: false,
  required: ['themeId'],
  properties: { themeId }
};

export const themeSave = {
  type: 'object',
  additionalProperties: false,
  required: ['name'],
  properties: {
    id: themeId,
    name: themeName,
    tags: { ...tags, default: [] },
    params: { ...params, default: {} },
    media: mediaFile,
    startup
  }
};

export const themeRemove = themeGet;

export const themeImport = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: {
    id: themeId,
    name: themeName,
    tags: { ...tags, default: [] },
    params: { ...params, default: {} },
    path: filePath,
    kind: { type: 'string', enum: ['auto', 'image', 'video', 'pack'], default: 'auto' }
  }
};

export const themeExport = {
  type: 'object',
  additionalProperties: false,
  required: ['themeId', 'destPath'],
  properties: { themeId, destPath: filePath }
};

export const themeApply = {
  type: 'object',
  additionalProperties: false,
  required: ['themeId'],
  properties: {
    themeId,
    name: themeName,
    params
  }
};

export const themeEmpty = EMPTY;
