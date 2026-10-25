export function createShutdown({ kernel, writer, logger } = {}) {
  let pending = null;

  return function shutdown(reason = 'shutdown') {
    if (pending) return pending;

    pending = (async () => {
      logger?.info('transport shutdown', { reason });
      try {
        await kernel?.close?.();
      } catch (error) {
        logger?.error('kernel close failed', { message: error?.message });
      }

      try {
        await writer?.drain?.();
      } catch { /* ignore */ }
    })();

    return pending;
  };
}
