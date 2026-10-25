import test from 'node:test';
import assert from 'node:assert/strict';
import { validate } from '../../kernel/schema/validator.mjs';
import { themeApply } from '../../kernel/schema/theme.mjs';

test('schema: strips unknown fields and applies defaults', () => {
  const result = validate(themeApply, { themeId: 'forest', unknown: 1, params: { accent: '#AABBCC' } });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { themeId: 'forest', params: { accent: '#AABBCC' } });
});

test('schema: rejects invalid theme id and accent', () => {
  const badId = validate(themeApply, { themeId: 'Forest!' });
  assert.equal(badId.valid, false);
  assert.ok(badId.errors.some((error) => error.keyword === 'pattern'));

  const badAccent = validate(themeApply, { themeId: 'forest', params: { accent: 'blue' } });
  assert.equal(badAccent.valid, false);
  assert.ok(badAccent.errors.some((error) => error.path === '$.params.accent'));
});

test('schema: enforces numeric ranges and enums', () => {
  const result = validate(themeApply, {
    themeId: 'forest',
    params: { panel: 150, mode: 'zoom' }
  });
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((error) => error.path === '$.params.panel' && error.keyword === 'maximum'));
  assert.ok(result.errors.some((error) => error.path === '$.params.mode' && error.keyword === 'enum'));
});

test('schema: strips unknown top-level fields', () => {
  const result = validate({ type: 'object', additionalProperties: false, properties: { a: { type: 'string' } } }, { a: 'x', b: 2 });
  assert.equal(result.valid, true);
  assert.deepEqual(result.value, { a: 'x' });
});
