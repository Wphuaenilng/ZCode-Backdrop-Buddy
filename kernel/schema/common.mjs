export const TAGS = ['动态', '人物', '动漫', '风景', '城市', '萌宠', '科技', '艺术'];

export const EMPTY = { type: 'object', additionalProperties: false };

export const startup = {
  type: 'object',
  additionalProperties: false,
  properties: {
    enabled: { type: 'boolean', default: false },
    preset: { type: 'string', enum: ['zcode-pop', 'theme-reveal'], default: 'zcode-pop' },
    holdMs: { type: 'integer', minimum: 900, maximum: 3000, default: 900 },
    media: {
      type: ['string', 'null'],
      maxLength: 255,
      pattern: '^[^\\\\/:*?"<>|\\u0000-\\u001F]+$'
    }
  }
};

export const themeId = {
  type: 'string',
  minLength: 1,
  maxLength: 64,
  pattern: '^[a-z0-9][a-z0-9-]*$'
};

export const themeName = { type: 'string', minLength: 1, maxLength: 24 };

export const tags = {
  type: 'array',
  maxItems: 8,
  items: { type: 'string', enum: TAGS }
};

export const params = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['auto', 'cover', 'contain', 'stretch'] },
    x: { type: 'number', minimum: 0, maximum: 100 },
    y: { type: 'number', minimum: 0, maximum: 100 },
    zoom: { type: 'number', minimum: 100, maximum: 220 },
    hpos: { type: 'number', minimum: 0, maximum: 100 },
    safe: { type: 'string', enum: ['auto', 'left', 'right', 'center'] },
    task: { type: 'string', enum: ['auto', 'ambient', 'focus'] },
    bubble: { type: 'number', minimum: 0, maximum: 100 },
    panel: { type: 'number', minimum: 0, maximum: 100 },
    accent: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
    lock: { type: 'boolean' },
    custom: { type: 'boolean' }
  }
};

export const source = { type: 'string', enum: ['all', 'builtin', 'user'] };

export const filePath = { type: 'string', minLength: 1, maxLength: 32767 };

export const mediaFile = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'file'],
  properties: {
    kind: { type: 'string', enum: ['image', 'video'] },
    file: { type: 'string', minLength: 1, maxLength: 255 },
    mime: { type: 'string', maxLength: 100 },
    width: { type: 'number', minimum: 1 },
    height: { type: 'number', minimum: 1 },
    duration: { type: 'number', minimum: 0 },
    bytes: { type: 'number', minimum: 1 },
    sha256: { type: 'string', pattern: '^[0-9a-f]{64}$' }
  }
};
