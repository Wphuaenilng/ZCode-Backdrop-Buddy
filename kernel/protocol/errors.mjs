import { ERRORS } from '../../shared/protocol/constants.mjs';

export class AppError extends Error {
  constructor(code, message, { retryable = false, details = null } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code || ERRORS.INTERNAL;
    this.retryable = !!retryable;
    this.details = details;
  }
}

export function badParams(message, details = null) {
  return new AppError(ERRORS.BAD_PARAMS, message, { details });
}

export function notFound(message = 'theme not found') {
  return new AppError(ERRORS.THEME_NOT_FOUND, message);
}

export function notImplemented(message) {
  return new AppError(ERRORS.NOT_IMPLEMENTED, message);
}

export function asAppError(error) {
  if (error instanceof AppError) return error;
  return new AppError(ERRORS.INTERNAL, error?.message || 'internal error', { details: null });
}

export function publicError(error) {
  const value = asAppError(error);
  return {
    code: value.code,
    message: value.message,
    retryable: value.retryable,
    ...(value.details ? { details: value.details } : {})
  };
}
