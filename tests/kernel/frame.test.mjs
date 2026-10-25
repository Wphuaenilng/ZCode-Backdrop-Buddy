import test from 'node:test';
import assert from 'node:assert/strict';
import { LineFramer } from '../../kernel/protocol/frame.mjs';
import { MAX_MESSAGE_BYTES } from '../../shared/protocol/constants.mjs';

test('framing: two NDJSON lines in one chunk', () => {
  const framer = new LineFramer();
  const { lines, errors } = framer.push(Buffer.from('{"a":1}\n{"b":2}\n'));
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
  assert.deepEqual(errors, []);
});

test('framing: a UTF-8 sequence split across chunks is reconstructed', () => {
  const framer = new LineFramer();
  const text = Buffer.from('{"name":"森林薄雾"}\n', 'utf8');
  const cut = 14;
  const first = framer.push(text.subarray(0, cut));
  const second = framer.push(text.subarray(cut));
  assert.deepEqual(first.lines, []);
  assert.deepEqual(second.lines, ['{"name":"森林薄雾"}']);
});

test('framing: 1 MiB minus 1 is accepted', () => {
  const framer = new LineFramer();
  const line = Buffer.alloc(MAX_MESSAGE_BYTES - 1, 0x61);
  const { lines, errors } = framer.push(Buffer.concat([line, Buffer.from('\n')]));
  assert.equal(lines.length, 1);
  assert.equal(Buffer.byteLength(lines[0]), MAX_MESSAGE_BYTES - 1);
  assert.deepEqual(errors, []);
});

test('framing: exactly 1 MiB is accepted', () => {
  const framer = new LineFramer();
  const line = Buffer.alloc(MAX_MESSAGE_BYTES, 0x61);
  const { lines, errors } = framer.push(Buffer.concat([line, Buffer.from('\n')]));
  assert.equal(lines.length, 1);
  assert.equal(Buffer.byteLength(lines[0]), MAX_MESSAGE_BYTES);
  assert.deepEqual(errors, []);
});

test('framing: 1 MiB + 1 is rejected and does not leak a partial line', () => {
  const framer = new LineFramer();
  const line = Buffer.alloc(MAX_MESSAGE_BYTES + 1, 0x61);
  const { lines, errors } = framer.push(Buffer.concat([line, Buffer.from('\n'), Buffer.from('{"ok":1}\n')]));
  assert.deepEqual(lines, ['{"ok":1}']);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'MESSAGE_TOO_LARGE');
  assert.equal(errors[0].bytes, MAX_MESSAGE_BYTES + 1);
});

test('framing: an oversized unterminated line is discarded', () => {
  const framer = new LineFramer();
  const { lines, errors } = framer.push(Buffer.alloc(MAX_MESSAGE_BYTES + 10, 0x62));
  assert.deepEqual(lines, []);
  assert.equal(errors.length, 1);
  const next = framer.push(Buffer.from('\n{"after":true}\n'));
  assert.deepEqual(next.lines, ['{"after":true}']);
});
