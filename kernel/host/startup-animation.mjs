import fs from 'node:fs';
import path from 'node:path';

// 宿主启动后的可选展示层：不参与皮肤状态，不修改宿主文件。
// 视频由 CDP 文件输入桥交给页面，避免启动 HTTP 服务，也不依赖 file: 媒体 CSP。
export function installHostStartupVideo() {
  if (window.top !== window || !document.body) return { installed: false, reason: 'not-ready' };
  if (window.__bbStartupAnimation) return { installed: true, alreadyActive: true };
  if (window.__bbStartupShown) return { installed: false, reason: 'already-shown' };

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const priorFocus = document.activeElement;
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'video/mp4,video/webm';
  input.hidden = true;
  input.id = 'backdropbuddy-startup-video-file';
  document.body.appendChild(input);

  let disposed = false;
  let completed = false;
  let phase = 'loading';
  let frame = null;
  let video = null;
  let objectURL = null;
  let watchdog = 0;
  let mediaError = null;
  let audioContext = null;

  function cleanup() {
    clearTimeout(watchdog);
    window.removeEventListener('keydown', keyboard, true);
    if (video) {
      video.pause();
      video.removeAttribute('src');
      video.load();
      video = null;
    }
    if (frame) { frame.remove(); frame = null; }
    input.value = '';
    input.remove();
    if (objectURL) URL.revokeObjectURL(objectURL);
    objectURL = null;
    if (audioContext) { audioContext.close().catch(() => {}); audioContext = null; }
    if (priorFocus && priorFocus.isConnected && typeof priorFocus.focus === 'function') priorFocus.focus();
  }

  function finish(next = 'complete') {
    if (disposed) return;
    completed = next === 'complete' || next === 'skipped' || next === 'reduced-motion';
    phase = next;
    window.__bbStartupShown = true;
    cleanup();
  }

  function keyboard(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      finish('skipped');
    }
  }

  function bind() {
    if (!video || objectURL || disposed || completed || !input.files || !input.files[0]) return false;
    objectURL = URL.createObjectURL(input.files[0]);
    video.src = objectURL;
    video.play().catch((error) => { if (!disposed && phase === 'loading') { mediaError = error?.message || 'play rejected'; finish('failed'); } });
    return true;
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    cleanup();
    if (window.__bbStartupAnimation === api) delete window.__bbStartupAnimation;
  }

  const api = {
    dispose,
    bind,
    status: () => ({ installed: true, ready: phase === 'playing', completed, phase, overlay: !!frame, mediaError })
  };
  window.__bbStartupAnimation = api;
  window.addEventListener('keydown', keyboard, true);
  frame = document.createElement('iframe');
  frame.id = 'backdropbuddy-startup-animation';
  frame.title = '启动动画';
  Object.assign(frame.style, {
    position: 'fixed', inset: '0', width: '100%', height: '100%', border: '0',
    zIndex: '2147483646', background: '#0b0d12', pointerEvents: 'auto'
  });
  frame.setAttribute('aria-label', '启动动画，按 Escape 跳过');
  const current = frame;
  current.addEventListener('load', () => {
    if (frame !== current || disposed) return;
    const doc = current.contentDocument;
    doc.documentElement.innerHTML = '<head></head><body></body>';
    const style = doc.createElement('style');
    style.textContent = 'html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#0b0d12}video{width:100%;height:100%;object-fit:cover}button{position:fixed;right:24px;top:24px;padding:9px 15px;border:1px solid #ffffff40;border-radius:999px;background:#ffffffe0;color:#27313d;cursor:pointer;font:13px system-ui,"Microsoft YaHei"}button:focus-visible{outline:2px solid #fff;outline-offset:3px}@media(prefers-reduced-motion:reduce){video{display:none}}';
    doc.head.appendChild(style);
    video = doc.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.loop = false;
    video.preload = 'auto';
    video.addEventListener('playing', () => {
      if (frame && !disposed) { phase = reduced ? 'reduced-motion' : 'playing'; if (reduced) finish('reduced-motion'); }
    }, { once: true });
    video.addEventListener('ended', () => finish('complete'), { once: true });
    video.addEventListener('error', () => { mediaError = `media error ${video?.error?.code || 'unknown'}`; finish('failed'); }, { once: true });
    // Chromium/Electron 会在后台暂停"没有音轨的视频"，即使它正在全屏展示。
    // 把视频接入零增益 Web Audio 后仍完全静音，但不再被当成无声背景媒体。
    // 只创建静音图，不注入振荡器或任何可听声音。
    try {
      const AudioContext = current.contentWindow.AudioContext || current.contentWindow.webkitAudioContext;
      if (AudioContext) {
        audioContext = new AudioContext();
        const source = audioContext.createMediaElementSource(video);
        const gain = audioContext.createGain();
        gain.gain.value = 0;
        source.connect(gain);
        gain.connect(audioContext.destination);
        audioContext.resume().catch(() => {});
      }
    } catch { /* 不支持 Web Audio 时保留原生静音播放 */ }
    const skip = doc.createElement('button');
    skip.type = 'button';
    skip.textContent = '跳过 · Esc';
    skip.addEventListener('click', () => finish('skipped'));
    skip.setAttribute('aria-label', '跳过启动动画');
    doc.body.append(video, skip);
    current.contentWindow.addEventListener('keydown', keyboard, true);
    current.focus();
    skip.focus();
    bind();
  }, { once: true });
  current.src = 'about:blank';
  document.body.appendChild(current);
  // iframe 的 load 是异步的；即使文件已交给 input，也要等 load 建好 video 后再 bind。
  watchdog = setTimeout(() => finish('timeout'), 75000);
  return { installed: true };
}

export async function playHostStartupAnimation({
  status,
  videoPath,
  openSession,
  timeoutMs = 10000,
  logger = null
}) {
  if (!status || status.safeToInject !== true || !status.target) throw new Error('host identity or main window is not verified');
  if (!videoPath || !path.isAbsolute(videoPath) || !fs.statSync(videoPath).isFile()) {
    throw new Error('startup video is unavailable');
  }
  if (typeof openSession !== 'function') throw new Error('CDP session factory is required');

  const deadline = Date.now() + timeoutMs;
  const remaining = () => {
    const ms = deadline - Date.now();
    if (ms <= 0) throw new Error('startup animation handoff timed out');
    return ms;
  };
  let session = null;
  let installed = false;
  let started = false;
  try {
    session = await openSession(status.target, { timeoutMs: Math.min(5000, remaining()) });
    const result = await session.evaluate(`(${installHostStartupVideo.toString()})()`, { timeoutMs: remaining() });
    if (!result || result.installed !== true) throw new Error(result?.reason || 'startup overlay was not installed');
    installed = true;
    if (result.alreadyActive) return { started: true, alreadyActive: true };

    const lookup = await session.send('Runtime.evaluate', {
      expression: 'document.getElementById("backdropbuddy-startup-video-file")',
      returnByValue: false
    }, remaining());
    const objectId = lookup.result?.objectId;
    if (!objectId) throw new Error('startup video file input was not installed');
    try {
      await session.send('DOM.setFileInputFiles', { files: [videoPath], objectId }, remaining());
    } finally {
      await session.send('Runtime.releaseObject', { objectId }).catch(() => {});
    }
    await session.evaluate('window.__bbStartupAnimation.bind()', { timeoutMs: remaining() });

    while (true) {
      const state = await session.evaluate('window.__bbStartupAnimation?.status() ?? null', { timeoutMs: remaining() });
      if (!state) throw new Error('startup overlay disappeared before playback');
      if (state.phase === 'failed' || state.phase === 'timeout') throw new Error(`startup video ${state.phase}`);
      if (state.ready || state.completed) {
        started = true;
        return { started: true, phase: state.phase };
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  } finally {
    // 成功开始播放后动画归页面所有；交接失败则只清理本次动画，皮肤保持原样。
    if (session && installed && !started) {
      await session.evaluate('window.__bbStartupAnimation?.dispose()', { timeoutMs: 1000 }).catch(() => {});
    }
    if (session) session.close();
  }
}
