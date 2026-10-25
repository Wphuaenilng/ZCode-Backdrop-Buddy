import { themeThumb } from '../data/themes.js';

export default function ThemeCard({ theme, selected, running, onSelect }) {
  const thumb = themeThumb(theme);
  const isVideo = !!thumb.video;
  const hasVideoSource = !!(theme.videoSrc || theme.videoFile || (theme.media && theme.media.kind === 'video' && theme.media.url));
  const needsFile = isVideo && !hasVideoSource;

  const style = isVideo
    ? (thumb.poster
      ? { backgroundImage: `url("${thumb.poster}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
      : { background: 'linear-gradient(135deg,#151B26,#334155)' })
    : thumb.image
      ? { backgroundImage: `url("${thumb.image}")` }
      : { background: thumb.bg };

  return (
    <article
      className={`theme-card${selected ? ' selected' : ''}${running ? ' running' : ''}`}
      tabIndex={0}
      role="button"
      aria-label={`选择主题 ${theme.name}`}
      data-testid={`theme-card-${theme.id}`}
      onClick={() => onSelect(theme.id)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(theme.id);
        }
      }}
    >
      <div className="theme-thumb" style={style}>
        {isVideo ? <span className="video-badge">{hasVideoSource ? '视频' : '视频 · 需重选'}</span> : null}
        {needsFile ? <span className="needs-file">需重新选择视频</span> : null}
      </div>

      <div className="theme-meta">
        <span className="theme-dot" style={{ background: theme.dot || '#A0A4AC' }} />
        <span className="theme-name">{theme.name}</span>
        {running ? <span className="run-tag">运行中</span> : null}
        <span className="mytag">{theme.builtin ? '内置' : '我的'}</span>
      </div>
    </article>
  );
}
