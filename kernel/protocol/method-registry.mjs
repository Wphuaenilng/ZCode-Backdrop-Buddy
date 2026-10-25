import { validate } from '../schema/validator.mjs';
import { badParams } from './errors.mjs';

export class MethodRegistry {
  constructor(router) {
    this.router = router;
    this.methods = new Map();
  }

  register(method, schema, handler) {
    if (typeof method !== 'string' || !method) throw new TypeError('method must be a string');
    if (!schema || typeof schema !== 'object') throw new TypeError('schema must be an object');
    if (typeof handler !== 'function') throw new TypeError('handler must be a function');

    this.methods.set(method, { schema, handler });

    this.router.register(method, async (params, message) => {
      const result = validate(schema, params);
      if (!result.valid) {
        throw badParams(`invalid params for ${method}`, result.errors);
      }
      return handler(result.value, message);
    });

    return this;
  }

  has(method) {
    return this.methods.has(method);
  }

  list() {
    return [...this.methods.keys()].sort();
  }

  get size() {
    return this.methods.size;
  }
}
