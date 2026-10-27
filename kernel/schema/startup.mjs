import { EMPTY, themeId } from './common.mjs';

export const startupGet = EMPTY;

export const startupUpdate = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean' },
    themeId: { ...themeId, type: ['string', 'null'] }
  }
};
