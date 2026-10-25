import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { AppError } from '../protocol/errors.mjs';
import { mediaUrl } from '../media/url.mjs';

export default function register(registry, ctx) {
  registry.register(METHODS.MEDIA_URL, METHOD_SCHEMAS[METHODS.MEDIA_URL], async ({ source, themeId, file }) => {
    const theme = ctx.library.get(themeId);
    if (!theme) throw new AppError('THEME_NOT_FOUND', `theme not found: ${themeId}`);
    if (!theme.media) throw new AppError('MEDIA_INVALID', 'theme has no media');

    if (file !== theme.media.file && file !== theme.media.thumb) {
      throw new AppError('BAD_PARAMS', 'file does not belong to the theme');
    }

    return { url: mediaUrl(source, themeId, file), source, themeId, file };
  });
}
