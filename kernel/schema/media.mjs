import { themeId } from './common.mjs';

export const mediaUrl = {
  type: 'object',
  additionalProperties: false,
  required: ['source', 'themeId', 'file'],
  properties: {
    source: { type: 'string', enum: ['builtin', 'user'] },
    themeId,
    file: { type: 'string', minLength: 1, maxLength: 255, pattern: '^[A-Za-z0-9._-]+$' }
  }
};
