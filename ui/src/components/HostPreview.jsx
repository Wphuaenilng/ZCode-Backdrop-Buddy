import { useEffect, useRef } from 'react';
import { clamp } from '../data/params.js';
import { themeVisual } from '../data/themes.js';

export default function HostPreview({ theme, params, paused = false, locked = false, large = false }) {
  const videoRef = useRef(null);
  const visual = themeVisual(theme);
  const mode = params.mode === 'contain' ? 'contain' : params.mode === 'stretch' ? '100% 100%' : 'cover';
  const objectFit = params.mode === 'contain' ? 'contain' : params.mode === 'stretch' ? 'fill' : 'cover';
  const position = `${clamp(params.x + params.hpos * 0.3, 0, 100)}% ${params.y}%`;
  const safe = ['left', 'right', 'center', 'off'].includes(params.safe) ? params.safe : 'auto';
  const scrim = 'rgba(15, 20, 28, .34)';
  const safeBackground = safe === 'off'
    ? 'transparent'
    : safe === 'center'
      ? `radial-gradient(circle at 50% 45%, transparent 35%, ${scrim} 100%)`
      : `linear-gradient(${safe === 'right' ? '270deg' : '90deg'}, ${scrim}, transparent 62%)`;

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (paused) {
      video.pause();
      return;
    }

    const play = video.play();
    if (play && typeof play.catch === 'function') play.catch(() => {});
  }, [paused, visual.video]);

  const surfaceStyle = {
    transform: `scale(${clamp(params.zoom, 100, 220) / 100})`,
    backgroundSize: mode,
    backgroundPosition: position
  };

  if (visual.image) surfaceStyle.backgroundImage = `url("${visual.image}")`;
  else if (visual.bg) surfaceStyle.background = visual.bg;

  const stageStyle = {
    '--panel': (clamp(params.panel, 0, 100) / 100).toFixed(2),
    '--bubble': (clamp(params.bubble, 0, 100) / 100).toFixed(2),
    '--accent': params.accent || '#6F9275'
  };

  return (
    <div
      className={`host-stage${large ? ' large' : ''}${locked ? ' locked' : ''}`}
      style={stageStyle}
      data-safe={safe === 'auto' ? 'left' : safe}
      data-task={params.task === 'auto' ? 'ambient' : params.task}
      data-testid={large ? 'import-preview' : 'host-preview'}
    >
      <div className="theme-surface" style={surfaceStyle}>
        {visual.video ? (
          <video
            ref={videoRef}
            src={visual.video}
            style={{ objectFit, objectPosition: position }}
            muted
            loop
            playsInline
            autoPlay
          />
        ) : null}
      </div>
      <div className="host-safe-overlay" style={{ background: safeBackground }} data-testid="host-safe-overlay" />

      <div className="host-mock">
        <div className="host-side"><i /><i /><i /><i /></div>
        <div className="host-main">
          <div className="host-head"><span /><b /></div>
          <div className="host-content">
            <div className="host-safe"><i /><i /><i /></div>
            <div className="host-bubble" />
          </div>
          <div className="host-input"><span /><b /></div>
        </div>
      </div>
    </div>
  );
}
