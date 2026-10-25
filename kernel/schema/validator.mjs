import { displayPath, isPlainObject, matchesType, typeOf } from './types.mjs';

function fail(errors, path, keyword, message) {
  errors.push({ path: displayPath(path), keyword, message });
}

function checkFormat(value, format) {
  switch (format) {
    case 'hex-color': return /^#[0-9a-fA-F]{6}$/.test(value);
    case 'theme-id': return /^[a-z0-9][a-z0-9-]{0,63}$/.test(value);
    case 'url': return /^https?:\/\//.test(value);
    default: return true;
  }
}

function visit(schema, value, path, errors, options) {
  if (schema === true || schema == null) return value;

  if (schema.default !== undefined && value === undefined) value = schema.default;

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((branch) => {
      const local = [];
      visit(branch, value, path, local, options);
      return local.length === 0;
    });
    if (matches.length !== 1) fail(errors, path, 'oneOf', 'must match exactly one schema');
    return value;
  }

  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      fail(errors, path, 'type', `expected ${types.join('|')}, got ${typeOf(value)}`);
      return value;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    fail(errors, path, 'enum', `must be one of: ${schema.enum.join(', ')}`);
    return value;
  }

  if (typeof value === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      fail(errors, path, 'minLength', `must be at least ${schema.minLength} characters`);
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      fail(errors, path, 'maxLength', `must be at most ${schema.maxLength} characters`);
    }
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
      fail(errors, path, 'pattern', 'has an invalid format');
    }
    if (schema.format && !checkFormat(value, schema.format)) {
      fail(errors, path, 'format', `must match format ${schema.format}`);
    }
  }

  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) {
      fail(errors, path, 'minimum', `must be >= ${schema.minimum}`);
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      fail(errors, path, 'maximum', `must be <= ${schema.maximum}`);
    }
    if (schema.type === 'integer' && !Number.isInteger(value)) {
      fail(errors, path, 'integer', 'must be an integer');
    }
  }

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      fail(errors, path, 'minItems', `must contain at least ${schema.minItems} items`);
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      fail(errors, path, 'maxItems', `must contain at most ${schema.maxItems} items`);
    }
    if (schema.items) {
      return value.map((item, index) => visit(schema.items, item, [...path, index], errors, options));
    }
    return value;
  }

  if (isPlainObject(value) && (schema.properties || schema.additionalProperties !== undefined || schema.required)) {
    const output = {};
    const properties = schema.properties || {};

    for (const key of schema.required || []) {
      if (!(key in value)) fail(errors, [...path, key], 'required', 'is required');
    }

    for (const [key, child] of Object.entries(properties)) {
      if (key in value) output[key] = visit(child, value[key], [...path, key], errors, options);
      else if (child && child.default !== undefined) output[key] = child.default;
    }

    for (const [key, item] of Object.entries(value)) {
      if (key in properties) continue;
      if (schema.additionalProperties === true) output[key] = item;
      else if (isPlainObject(schema.additionalProperties)) {
        output[key] = visit(schema.additionalProperties, item, [...path, key], errors, options);
      } else if (schema.additionalProperties === false) {
        if (options.stripUnknown === false) fail(errors, [...path, key], 'additionalProperties', 'is not allowed');
      } else if (options.stripUnknown !== false) {
        // Undeclared fields are ignored, matching the protocol contract.
      } else {
        output[key] = item;
      }
    }

    return output;
  }

  return value;
}

export function validate(schema, value, options = {}) {
  const errors = [];
  const output = visit(schema, value, [], errors, options);
  return { valid: errors.length === 0, value: output, errors };
}
