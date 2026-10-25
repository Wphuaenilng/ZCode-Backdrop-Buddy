export function createLifecycle({ logger, onClose } = {}) {
  let closing = null;

  return {
    get closing() {
      return !!closing;
    },
    shutdown(reason = 'shutdown') {
      if (closing) return closing;

      logger?.info('lifecycle shutdown', { reason });
      closing = Promise.resolve()
        .then(() => onClose?.(reason))
        .catch((error) => logger?.error('lifecycle close failed', { message: error?.message }))
        .finally(() => logger?.info('lifecycle closed', { reason }));

      return closing;
    }
  };
}
