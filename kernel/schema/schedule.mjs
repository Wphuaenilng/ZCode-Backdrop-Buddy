const ruleId = { type: 'string', minLength: 1, maxLength: 64 };
const themeRef = { oneOf: [{ type: 'string', format: 'theme-id' }, { type: 'null' }] };

export const scheduleList = { type: 'object', additionalProperties: false, properties: {} };

export const scheduleTick = {
  type: 'object',
  additionalProperties: false,
  properties: {
    systemDark: { oneOf: [{ type: 'boolean' }, { type: 'null' }] },
    reason: { type: 'string', minLength: 1, maxLength: 24 }
  }
};

export const scheduleRemove = {
  type: 'object',
  additionalProperties: false,
  required: ['id'],
  properties: { id: ruleId }
};

export const scheduleSave = {
  type: 'object',
  additionalProperties: false,
  required: ['rule'],
  properties: {
    rule: {
      type: 'object',
      additionalProperties: false,
      required: ['when', 'themeId'],
      properties: {
        id: { oneOf: [ruleId, { type: 'null' }] },
        name: { type: 'string', maxLength: 40 },
        enabled: { type: 'boolean' },
        themeId: themeRef,
        when: {
          type: 'object',
          additionalProperties: false,
          required: ['kind'],
          properties: {
            kind: { type: 'string', enum: ['time', 'hostTheme', 'systemTheme'] },
            at: { oneOf: [{ type: 'string', pattern: '^([01]\\d|2[0-3]):[0-5]\\d$' }, { type: 'null' }] },
            dark: { oneOf: [{ type: 'boolean' }, { type: 'null' }] }
          }
        }
      }
    }
  }
};
