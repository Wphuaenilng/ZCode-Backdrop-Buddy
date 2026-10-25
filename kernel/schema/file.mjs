import { filePath } from './common.mjs';

export const filePick = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['image', 'video', 'media', 'pack', 'any'], default: 'any' },
    mode: { type: 'string', enum: ['open', 'save'], default: 'open' },
    suggestedName: { type: 'string', minLength: 1, maxLength: 255 }
  }
};

export const fileValidate = {
  type: 'object',
  additionalProperties: false,
  required: ['path'],
  properties: { path: filePath }
};
