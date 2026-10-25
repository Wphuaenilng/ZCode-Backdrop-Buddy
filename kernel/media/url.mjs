const SOURCES = new Set(['builtin', 'user']);

export function mediaUrl(source, themeId, file) {
  if (!SOURCES.has(source)) throw new Error(`unsupported media source: ${source}`);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(themeId)) throw new Error(`invalid theme id: ${themeId}`);
  if (!file || /[\\/]/.test(file)) throw new Error(`invalid media file: ${file}`);

  return `https://media.backdropbuddy.invalid/${encodeURIComponent(source)}/${encodeURIComponent(themeId)}/${encodeURIComponent(file)}`;
}
