import { directorySize } from './atomic.mjs';
import { loadThemes } from './loader.mjs';

export function storeStats({ paths, logger }) {
  const builtin = loadThemes(paths.builtin, 'builtin', logger);
  const user = loadThemes(paths.user, 'user', logger);
  const mediaBytes = directorySize(paths.user);
  const cacheBytes = directorySize(paths.cache);

  return {
    builtin: builtin.length,
    user: user.length,
    total: builtin.length + user.length,
    mediaBytes,
    cacheBytes
  };
}
