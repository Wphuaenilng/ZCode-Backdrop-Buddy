export default function Footer({ total, host, kernel, onRefresh }) {
  const windows = Array.isArray(host.info?.targets) ? host.info.targets.length : 0;
  const hostText = host.status === 'running'
    ? `宿主 ${host.info?.hostName || host.info?.host || '在线'} · 已就绪${windows > 1 ? ` · ${windows} 个窗口` : ''}`
    : host.status === 'checking'
      ? '宿主检测中'
      : host.status === 'error'
        ? '宿主需处理'
        : '宿主未运行';

  const kernelText = kernel.status === 'running'
    ? '内核运行中'
    : kernel.status === 'restarting'
      ? '内核重启中'
      : kernel.status === 'stopped'
        ? '内核已停止'
        : kernel.status === 'checking'
          ? '内核连接中'
          : '内核不可用';

  return (
    <footer className="statusbar">
      <span data-testid="footer-text">主题库就绪 · {total} 个主题</span>
      <div className="footer-right">
        <span className={`host-chip ${host.status} ${kernel.status}`} title={host.info?.reason || ''}>
          <i />{hostText} · {kernelText}
        </span>
        <button type="button" className="link" onClick={onRefresh}>刷新主题库</button>
      </div>
    </footer>
  );
}
