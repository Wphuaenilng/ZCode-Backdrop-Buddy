import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TopBar from './components/TopBar.jsx';
import Footer from './components/Footer.jsx';
import ConsoleView from './components/ConsoleView.jsx';
import ImportView from './components/ImportView.jsx';
import SettingsView from './components/SettingsView.jsx';
import ConfirmDialog from './components/ConfirmDialog.jsx';
import HostWizard from './components/HostWizard.jsx';
import Toast from './components/Toast.jsx';
import { BUILTINS, isNative } from './data/themes.js';
import { DEFAULT_PARAMS, TAG_LIST, normalizeParams } from './data/params.js';
import { loadLibrary, saveLibrary } from './lib/storage.js';
import { createBridge } from './bridge.js';

function blankDraft() {
  return {
    name: '',
    src: '',
    path: '',
    token: '',
    isVideo: false,
    tags: [],
    params: normalizeParams({ x: 0, y: 0, zoom: 100, lock: true })
  };
}

async function downscaleImage(src) {
  const image = await new Promise((resolve, reject) => {
    const element = new Image();
    element.onload = () => resolve(element);
    element.onerror = () => reject(new Error('image load failed'));
    element.src = src;
  });

  const max = 1400;
  const scale = Math.min(1, max / Math.max(image.naturalWidth || 1, image.naturalHeight || 1));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/jpeg', 0.84);
}

function themePack(theme, params) {
  return {
    schema: 'backdropbuddy.theme/1',
    name: theme.name,
    tags: theme.tags || [],
    params,
    image: theme.image || '',
    bg: theme.bg || '',
    video: !!theme.video,
    at: Date.now()
  };
}

function downloadJson(object, filename) {
  const blob = new Blob([JSON.stringify(object, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export default function App() {
  const bridgeRef = useRef(null);
  if (!bridgeRef.current) bridgeRef.current = createBridge();
  const bridge = bridgeRef.current;
  const native = isNative();

  const [library, setLibrary] = useState(loadLibrary);
  const [kernelThemes, setKernelThemes] = useState([]);
  const [view, setView] = useState('console');
  const [filters, setFilters] = useState({ search: '', category: 'all', source: 'all', sort: 'catalog' });
  const [runningId, setRunningId] = useState(null);
  const [paused, setPaused] = useState(false);
  const [settingsId, setSettingsId] = useState(() => library.selectedId);
  const [draft, setDraft] = useState(null);
  const [toast, setToast] = useState(null);
  const [host, setHost] = useState({ status: 'checking', info: null });
  const [hostList, setHostList] = useState([]);
  const [activeHost, setActiveHost] = useState(null);
  const [hostSwitching, setHostSwitching] = useState(false);
  const [kernel, setKernel] = useState({ status: 'checking', pid: null, capabilities: [] });
  const [recovery, setRecovery] = useState(null);
  const [recoveryDismissed, setRecoveryDismissed] = useState(null);
  const [shellSettings, setShellSettings] = useState({ minimizeToTray: false });
  const [prefs, setPrefs] = useState({ applyOnStart: false, reducedMotion: false, zcodePath: null });
  const [startupAnim, setStartupAnim] = useState(null);
  const [schedule, setSchedule] = useState({ rules: [], nextTriggerAt: null, wakeAt: null });
  const [applyBusy, setApplyBusy] = useState(false);
  const [restartPrompt, setRestartPrompt] = useState(null);
  const [hostStartupConfirm, setHostStartupConfirm] = useState(false);
  const [hostStartupBusy, setHostStartupBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);

  const toastTimer = useRef(0);

  const showToast = useCallback((message) => {
    setToast({ message, id: Date.now() });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  useEffect(() => {
    if (!saveLibrary(library)) showToast('本地存储空间不足，主题未写入本地');
  }, [library, showToast]);

  useEffect(() => {
    if (!deleteConfirm) return undefined;
    const timer = setTimeout(() => setDeleteConfirm(false), 3000);
    return () => clearTimeout(timer);
  }, [deleteConfirm]);

  useEffect(() => {
    setDeleteConfirm(false);
  }, [library.selectedId]);

  const refreshThemes = useCallback(async () => {
    if (!native) return [];
    const result = await bridge.request('theme.list', { source: 'all' });
    if (!result.ok) return [];
    const themes = (result.data?.themes || []).map((theme) => {
      const visual = BUILTINS.find((item) => item.id === theme.id);
      return {
        id: theme.id,
        name: theme.name,
        tags: theme.tags || [],
        builtin: theme.source === 'builtin',
        dot: theme.params?.accent || visual?.dot || '#6F9275',
        bg: visual?.bg || '',
        params: theme.source === 'builtin' && visual
          ? { ...theme.params, ...visual.params }
          : (theme.params || {}),
        media: theme.media || null,
        startup: theme.startup || { enabled: false, preset: 'zcode-pop', holdMs: 900, media: null },
        at: theme.updatedAt || theme.createdAt || 0
      };
    });

    setKernelThemes(themes);
    return themes;
  }, [bridge, native]);

  const applyHostInfo = useCallback((info) => {
    setHost({
      status: info?.safeToInject ? 'running' : info?.running ? 'error' : 'not-running',
      info: info || null
    });
  }, []);

  const allThemes = useMemo(() => {
    const base = native
      ? (kernelThemes.length ? kernelThemes : BUILTINS)
      : [...BUILTINS, ...library.my];
    return base.filter((theme) => !(theme.builtin && library.hidden.includes(theme.id)));
  }, [native, kernelThemes, library.hidden, library.my]);

  const findTheme = useCallback((id) => allThemes.find((theme) => theme.id === id) || null, [allThemes]);

  const selectedTheme = findTheme(library.selectedId) || allThemes[0] || null;
  const runningTheme = runningId ? findTheme(runningId) : null;
  const settingsTheme = findTheme(settingsId) || selectedTheme;

  const themeParams = useCallback((theme) => {
    if (!theme) return { ...DEFAULT_PARAMS };
    if (theme.builtin) {
      return normalizeParams({ ...(theme.params || {}), ...(library.overrides[theme.id] || {}) });
    }
    return normalizeParams(theme.params);
  }, [library.overrides]);

  const selectedParams = useMemo(() => themeParams(selectedTheme), [selectedTheme, themeParams]);
  const settingsParams = useMemo(() => themeParams(settingsTheme), [settingsTheme, themeParams]);

  const visibleThemes = useMemo(() => {
    let themes = allThemes;
    const query = filters.search.trim().toLowerCase();

    if (query) {
      themes = themes.filter((theme) =>
        theme.name.toLowerCase().includes(query)
        || (theme.tags || []).some((tag) => tag.toLowerCase().includes(query)));
    }
    if (filters.category !== 'all') themes = themes.filter((theme) => (theme.tags || []).includes(filters.category));
    if (filters.source === 'builtin') themes = themes.filter((theme) => theme.builtin);
    if (filters.source === 'my') themes = themes.filter((theme) => !theme.builtin);

    if (filters.sort === 'name') themes = themes.slice().sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    else if (filters.sort === 'recent') themes = themes.slice().sort((a, b) => (b.at || 0) - (a.at || 0));

    return themes;
  }, [allThemes, filters]);

  // 调度数据落 state：启动引导 effect（下方）与规则保存都会用，先声明
  const setScheduleFrom = useCallback((data) => {
    setSchedule({
      rules: Array.isArray(data?.rules) ? data.rules : [],
      nextTriggerAt: data?.nextTriggerAt || null,
      wakeAt: data?.wakeAt || null
    });
  }, []);

  useEffect(() => {
    let alive = true;

    const sync = async () => {
      const hello = await bridge.request('system.hello');
      if (!alive) return;
      if (hello.ok) {
        setKernel((current) => ({
          ...current,
          status: 'running',
          capabilities: Array.isArray(hello.data?.capabilities) ? hello.data.capabilities : []
        }));
      } else {
        setKernel({ status: 'error', pid: null, capabilities: [], reason: hello.error?.code });
      }

      await refreshThemes();
      if (!alive) return;

      if (native) {
        const settings = await bridge.request('settings.get');
        if (!alive) return;
        if (settings.ok) {
          const stored = settings.data?.settings || {};
          const overrides = stored.builtinOverrides;
          setPrefs({ applyOnStart: !!stored.applyOnStart, reducedMotion: !!stored.reducedMotion, zcodePath: stored.zcodePath || null });
          setLibrary((current) => ({
            ...current,
            ...(stored.selectedThemeId ? { selectedId: stored.selectedThemeId } : {}),
            ...(overrides && typeof overrides === 'object' && !Array.isArray(overrides) ? { overrides } : {})
          }));
        }

        const shell = await bridge.request('shell.settings.get');
        if (!alive) return;
        if (shell.ok) setShellSettings({ minimizeToTray: !!shell.data?.minimizeToTray });

        const scheduled = await bridge.request('schedule.list');
        if (!alive) return;
        if (scheduled.ok) setScheduleFrom(scheduled.data);

        const startup = await bridge.request('startup.get');
        if (!alive) return;
        if (startup.ok) setStartupAnim(startup.data?.settings || null);
      }

      // 首屏可交互（主题列表与偏好已就绪）：通知壳收掉启动窗；宿主探测等在后台继续补。
      if (typeof bridge.notifyReady === 'function') bridge.notifyReady();

      const status = await bridge.request('status.get');
      if (!alive) return;
      if (status.ok) {
        const applied = status.data?.theme;
        setRunningId(applied && applied.themeId ? applied.themeId : null);
        setPaused(!!status.data?.paused);
        if (status.data?.host?.recovery) setRecovery(status.data.host.recovery);
        if (status.data?.hostId) setActiveHost(status.data.hostId);
      }

      const hostList = await bridge.request('host.profile.list');
      if (!alive) return;
      if (hostList.ok) {
        setHostList(Array.isArray(hostList.data?.hosts) ? hostList.data.hosts : []);
        setActiveHost((current) => hostList.data?.active || current);
      }

      const detect = await bridge.request('host.detect');
      if (!alive) return;
      if (detect.ok) {
        applyHostInfo(detect.data);
        if (detect.data?.recovery) setRecovery(detect.data.recovery);
      } else {
        setHost({ status: 'error', info: { reason: detect.error?.code } });
      }
    };

    const offTheme = bridge.on('theme.status', (data) => {
      if (!alive || !data) return;
      if (data.state === 'restored' || !data.themeId) {
        setRunningId(null);
        setPaused(false);
        setRecovery((current) => (current && current.attention ? null : current));
        return;
      }
      setRunningId(data.themeId);
      setPaused(!!data.paused);
      setRecovery((current) => (current && current.attention ? null : current));
    });

    const offRecovery = bridge.on('recovery.status', (data) => {
      if (!alive || !data) return;
      setRecovery(data);
    });

    // 宿主切换（host.use）后：同步当前宿主、宿主状态与正在跑的主题
    const offHostSwitched = bridge.on('host.switched', (data) => {
      if (!alive || !data) return;
      setActiveHost(data.to);
      bridge.request('status.get').then((result) => {
        if (!alive || !result.ok) return;
        const applied = result.data?.theme;
        setRunningId(applied && applied.themeId ? applied.themeId : null);
        setPaused(!!result.data?.paused);
      });
      bridge.request('host.detect').then((result) => {
        if (!alive) return;
        if (result.ok) applyHostInfo(result.data);
      });
    });

    const offSchedule = bridge.on('schedule.fired', (data) => {
      if (!alive || !data) return;
      showToast('自动切换：已按规则换主题');
      bridge.request('schedule.list').then((result) => {
        if (alive && result.ok) setScheduleFrom(result.data);
      });
    });

    const offKernel = bridge.on('system.kernel', (data) => {
      if (!alive || !data) return;

      if (data.state === 'restarting') {
        setKernel({ status: 'restarting', pid: data.pid, capabilities: [] });
        return;
      }
      if (data.state === 'stopped') {
        setKernel({ status: 'stopped', pid: data.pid, capabilities: [], reason: data.reason });
        setRunningId(null);
        setPaused(false);
        return;
      }

      setKernel((current) => ({ ...current, status: 'running', pid: data.pid }));
      if (data.state === 'restarted' || data.state === 'started') sync();
    });

    sync();

    return () => {
      alive = false;
      offTheme();
      offRecovery();
      offSchedule();
      offKernel();
      offHostSwitched();
    };
  }, [bridge, native, refreshThemes, applyHostInfo]);

  // 内核调用的统一包装：出错时也返回失败信封，调用方不用 try/catch
  const callKernel = useCallback(async (method, params, timeoutMs) => {
    try {
      return await bridge.request(method, params || {}, timeoutMs);
    } catch (error) {
      return { ok: false, error: { code: 'BRIDGE_ERROR', message: String(error) } };
    }
  }, [bridge]);

  // 一键切换宿主：切换后内核会自动把这个宿主上次的壁纸补回去（如果有记忆）
  const switchActiveHost = useCallback(async (id) => {
    if (!native || !id || hostSwitching) return;
    setHostSwitching(true);
    try {
      const result = await callKernel('host.use', { id }, 90000);
      if (!result.ok) {
        showToast('切换宿主失败：' + (result.error?.message || result.error?.code));
        return;
      }
      setActiveHost(result.data?.hostId || id);
      const list = await callKernel('host.profile.list');
      if (list.ok) setHostList(Array.isArray(list.data?.hosts) ? list.data.hosts : []);
      showToast(result.data?.appliedTheme
        ? `已切到 ${result.data.name}，并换上它上次的壁纸`
        : `已切到 ${result.data.name}`);
    } finally {
      setHostSwitching(false);
    }
  }, [native, hostSwitching, callKernel, showToast]);

  const setFiltersSafe = useCallback((patch) => {
    setFilters((current) => ({ ...current, ...patch }));
  }, []);

  const selectTheme = useCallback((id) => {
    setLibrary((current) => ({ ...current, selectedId: id }));
    if (view === 'settings') setSettingsId(id);
    if (native) bridge.request('settings.set', { settings: { selectedThemeId: id } });
  }, [view, native, bridge]);

  const setMinimizeToTray = useCallback(async (value) => {
    if (!native) return;

    setShellSettings((current) => ({ ...current, minimizeToTray: value }));
    const result = await bridge.request('shell.settings.set', { minimizeToTray: value });
    if (!result.ok) {
      setShellSettings((current) => ({ ...current, minimizeToTray: !value }));
      showToast('设置保存失败：' + (result.error?.message || result.error?.code || '未知错误'));
      return;
    }

    setShellSettings({ minimizeToTray: !!result.data?.minimizeToTray });
    showToast(value ? '已开启：关闭窗口将最小化到托盘' : '已关闭：关闭窗口将直接退出');
  }, [native, bridge, showToast]);

  const setPreference = useCallback(async (key, value) => {
    if (!native) return;

    const labels = {
      applyOnStart: value ? '已开启：下次启动自动应用上次的主题' : '已关闭：下次启动不再自动应用',
      reducedMotion: value ? '已开启：视频主题改用首帧静图' : '已关闭：视频主题恢复播放'
    };
    setPrefs((current) => ({ ...current, [key]: value }));
    const result = await bridge.request('settings.set', { settings: { [key]: value } });
    if (!result.ok) {
      setPrefs((current) => ({ ...current, [key]: !value }));
      showToast('设置保存失败：' + (result.error?.message || result.error?.code || '未知错误'));
      return;
    }

    setPrefs((current) => ({
      ...current,
      applyOnStart: !!result.data?.settings?.applyOnStart,
      reducedMotion: !!result.data?.settings?.reducedMotion
    }));
    const note = result.data?.reapplyError
      ? '（当前皮肤重放失败，下次应用时生效：' + (result.data.reapplyError.message || '') + '）'
      : '';
    showToast((labels[key] || '设置已保存') + note);
  }, [native, bridge, showToast]);

  const saveZcodePath = useCallback(async (value) => {
    if (!native) return false;

    const next = value && value.trim() ? value.trim() : null;
    const result = await bridge.request('settings.set', { settings: { zcodePath: next } });
    if (!result.ok) {
      showToast('保存失败：' + (result.error?.message || result.error?.code || '未知错误'));
      return false;
    }

    setPrefs((current) => ({ ...current, zcodePath: result.data?.settings?.zcodePath ?? null }));
    showToast(next ? 'ZCode 位置已保存，重启 BackdropBuddy 后生效' : '已恢复自动搜索，重启 BackdropBuddy 后生效');
    return true;
  }, [native, bridge, showToast]);

  const setStartupEnabled = useCallback(async (value) => {
    if (!native) { showToast('浏览器预览里不能改启动动画'); return; }

    const previous = startupAnim;
    setStartupAnim((current) => (current ? { ...current, enabled: value } : current));
    const result = await bridge.request('startup.update', { enabled: value });
    if (!result.ok) {
      setStartupAnim(previous);
      showToast('启动动画设置保存失败：' + (result.error?.message || result.error?.code || '未知错误'));
      return;
    }
    setStartupAnim(result.data?.settings || previous);
    showToast(value ? '已开启：下次启动播放开场动画' : '已关闭：下次启动使用内置品牌动画');
  }, [native, bridge, showToast, startupAnim]);

  const setStartupTheme = useCallback(async (themeId) => {
    if (!native) { showToast('浏览器预览里不能改启动动画'); return; }

    const previous = startupAnim;
    setStartupAnim((current) => (current ? { ...current, themeId } : current));
    const result = await bridge.request('startup.update', { themeId });
    if (!result.ok) {
      setStartupAnim(previous);
      showToast('启动动画设置保存失败：' + (result.error?.message || result.error?.code || '未知错误'));
      return;
    }
    const settings = result.data?.settings || previous;
    setStartupAnim(settings);
    showToast(themeId
      ? '已设为启动动画：' + (settings?.themeName || '所选视频主题')
      : '已恢复默认启动动画');
  }, [native, bridge, showToast, startupAnim]);

  const saveRule = useCallback(async (rule) => {
    if (!native) { showToast('浏览器预览里不能改调度规则'); return false; }

    const result = await bridge.request('schedule.save', { rule });
    if (!result.ok) {
      showToast('规则保存失败：' + (result.error?.message || result.error?.code || '未知错误'));
      return false;
    }
    setScheduleFrom(result.data);
    showToast('规则已保存');
    return true;
  }, [native, bridge, showToast, setScheduleFrom]);

  const removeRule = useCallback(async (id) => {
    if (!native) return false;

    const result = await bridge.request('schedule.remove', { id });
    if (!result.ok) {
      showToast('规则删除失败：' + (result.error?.message || result.error?.code || '未知错误'));
      return false;
    }
    setScheduleFrom(result.data);
    showToast('规则已删除');
    return true;
  }, [native, bridge, showToast, setScheduleFrom]);

  const performApply = useCallback(async (theme) => {
    if (!theme) return false;

    setRunningId(theme.id);
    setPaused(false);

    const result = await callKernel('theme.apply', {
      themeId: theme.id,
      name: theme.name,
      params: themeParams(theme)
    });

    if (result.ok) {
      if (native) {
        bridge.request('settings.set', {
          settings: { selectedThemeId: theme.id, lastAppliedThemeId: theme.id }
        });
      }
      showToast(result.data?.dryRun
        ? '已应用到预览'
        : '已应用皮肤：' + theme.name);
      return true;
    }

    setRunningId(null);
    setPaused(false);
    const detected = await bridge.request('host.detect');
    if (detected.ok) applyHostInfo(detected.data);
    showToast('应用失败：' + (result.error?.message || result.error?.code || '未知错误'));
    return false;
  }, [themeParams, callKernel, showToast, native, bridge, applyHostInfo]);

  // 当前宿主的显示名：重启确认文案与顶栏共用，须在 confirmRestartApply 之前声明
  const activeHostName = hostList.find((item) => item.id === activeHost)?.name || host?.info?.hostName || '宿主';

  const confirmRestartApply = useCallback(async () => {
    if (!restartPrompt || applyBusy) return;

    const theme = findTheme(restartPrompt.themeId) || selectedTheme;
    if (!theme) {
      setRestartPrompt(null);
      return;
    }

    setApplyBusy(true);
    showToast(restartPrompt.running ? `正在重启 ${activeHostName}…` : `正在启动 ${activeHostName}…`);
    try {
      const result = await callKernel('host.restart', { reapply: false }, 60000);
      if (!result.ok) {
        showToast(`${activeHostName} 启动失败：` + (result.error?.message || result.error?.code || '未知错误'));
        return;
      }

      const info = result.data?.status;
      if (info) applyHostInfo(info);
      if (!info?.safeToInject) {
        showToast(`${activeHostName} 已启动，但页面尚未就绪，请稍后重试`);
        return;
      }

      await performApply(theme);
    } finally {
      setApplyBusy(false);
      setRestartPrompt(null);
    }
  }, [restartPrompt, applyBusy, findTheme, selectedTheme, callKernel, showToast, applyHostInfo, performApply, activeHostName]);

  const confirmHostStartup = useCallback(async () => {
    if (hostStartupBusy || !native) return;
    setHostStartupBusy(true);
    showToast(`正在启动 ${activeHostName}…`);
    try {
      const result = await callKernel('host.restart', { reapply: true }, 60000);
      if (!result.ok) {
        showToast(`${activeHostName} 启动失败：` + (result.error?.message || result.error?.code || '未知错误'));
        return;
      }
      if (result.data?.status) applyHostInfo(result.data.status);
      const injection = result.data?.startupInjection;
      const animation = result.data?.startupAnimation;
      if (injection?.injected) showToast(`${activeHostName} 已启动，启动动画已就绪`);
      else if (injection && injection.reason !== 'already-open') showToast(`${activeHostName} 已启动；启动动画已回退，皮肤不受影响`);
      else if (animation?.started) showToast(`${activeHostName} 已启动，正在播放兼容启动动画`);
      else showToast(`${activeHostName} 已启动`);
    } finally {
      setHostStartupBusy(false);
      setHostStartupConfirm(false);
    }
  }, [hostStartupBusy, native, activeHostName, callKernel, showToast, applyHostInfo]);

  const persistOverrides = useCallback((overrides) => {
    if (!native) return;
    bridge.request('settings.set', { settings: { builtinOverrides: overrides } });
  }, [native, bridge]);

  const setThemeParams = useCallback((theme, params) => {
    if (!theme) return;
    const normalized = normalizeParams(params);

    if (theme.builtin) {
      const overrides = { ...library.overrides, [theme.id]: normalized };
      setLibrary((current) => ({ ...current, overrides }));
      persistOverrides(overrides);
      return;
    }

    setLibrary((current) => ({
      ...current,
      my: current.my.map((item) => (item.id === theme.id ? { ...item, params: normalized } : item))
    }));
  }, [library.overrides, persistOverrides]);

  const resetThemeParams = useCallback((theme) => {
    if (!theme) return;

    if (theme.builtin) {
      const overrides = { ...library.overrides };
      delete overrides[theme.id];
      setLibrary((current) => ({ ...current, overrides }));
      persistOverrides(overrides);
      return;
    }

    setLibrary((current) => ({
      ...current,
      my: current.my.map((item) => (item.id === theme.id ? { ...item, params: { ...DEFAULT_PARAMS } } : item))
    }));
  }, [library.overrides, persistOverrides]);

  const addTheme = useCallback((theme) => {
    setLibrary((current) => ({
      ...current,
      my: [theme, ...current.my],
      selectedId: theme.id
    }));
    setSettingsId(theme.id);
    setFilters({ search: '', category: 'all', source: 'my', sort: 'catalog' });
    setView('console');
  }, []);

  const switchView = useCallback((next) => {
    if (next === 'import' && !draft) setDraft(blankDraft());
    if (next === 'settings') setSettingsId(library.selectedId);
    setView(next);
  }, [draft, library.selectedId]);

  const applySkin = useCallback(async () => {
    const theme = selectedTheme;
    if (!theme || applyBusy) return;

    if (theme.video && !theme.videoSrc && !theme.videoFile) {
      showToast('这个视频主题需要重新选择视频文件');
      return;
    }

    if (!native) {
      await performApply(theme);
      return;
    }

    setApplyBusy(true);
    try {
      const detected = await bridge.request('host.detect');
      if (!detected.ok) {
        showToast('宿主检测失败：' + (detected.error?.message || detected.error?.code || '未知错误'));
        return;
      }

      const info = detected.data;
      applyHostInfo(info);

      if (info?.safeToInject) {
        await performApply(theme);
        return;
      }

      const canRestart = !!info?.installed && (!info?.running || (info.running && !info.portOpen));
      if (canRestart) {
        setRestartPrompt({ themeId: theme.id, running: !!info.running });
        return;
      }

      showToast('无法应用：' + (info?.reason || '宿主不可用'));
    } finally {
      setApplyBusy(false);
    }
  }, [selectedTheme, applyBusy, native, bridge, applyHostInfo, performApply, showToast]);

  const pauseSkin = useCallback(async () => {
    if (!runningTheme) return;

    const nextPaused = !paused;
    setPaused(nextPaused);

    const result = await callKernel(nextPaused ? 'theme.pause' : 'theme.resume');
    if (!result.ok) {
      setPaused(!nextPaused);
      showToast('操作失败：' + (result.error?.message || result.error?.code || '未知错误'));
      return;
    }

    showToast(nextPaused ? '皮肤已暂停' : '皮肤已继续');
  }, [runningTheme, paused, callKernel, showToast]);

  const resetSkin = useCallback(async () => {
    if (!runningTheme) return;

    resetThemeParams(runningTheme);
    const result = await callKernel('theme.reset', { themeId: runningTheme.id });
    showToast(result.ok
      ? '已重置主题参数'
      : '重置失败：' + (result.error?.message || result.error?.code || '未知错误'));
  }, [runningTheme, resetThemeParams, callKernel, showToast]);

  const restoreSkin = useCallback(async () => {
    const previousId = runningTheme?.id || null;
    const wasPaused = paused;
    setRunningId(null);
    setPaused(false);
    const result = await callKernel('theme.restore');
    if (!result.ok) {
      setRunningId(previousId);
      setPaused(wasPaused);
      showToast('恢复失败：' + (result.error?.message || result.error?.code || '未知错误'));
      return;
    }
    showToast(result.data?.verified === false ? '已撤注入，但页面校验未通过' : '已恢复原貌');
  }, [runningTheme, paused, callKernel, showToast]);

  const saveSettings = useCallback(async (form) => {
    if (!settingsTheme) return;

    const { name: nextName, startup, ...params } = form;
    const resolvedName = settingsTheme.builtin
      ? settingsTheme.name
      : String(nextName || settingsTheme.name).slice(0, 24);

    if (native && !settingsTheme.builtin) {
      const saved = await callKernel('theme.save', {
        id: settingsTheme.id,
        name: resolvedName,
        tags: settingsTheme.tags,
        params,
        startup: {
          enabled: startup?.enabled === true,
          preset: startup?.preset || 'zcode-pop',
          holdMs: startup?.holdMs || 900,
          media: startup?.media || null
        }
      });
      if (!saved.ok) {
        showToast('保存失败：' + (saved.error?.message || saved.error?.code || '未知错误'));
        return;
      }
      await refreshThemes();
    } else {
      setThemeParams(settingsTheme, params);
    }

    if (runningId === settingsTheme.id) {
      const result = await callKernel('theme.apply', {
        themeId: settingsTheme.id,
        name: resolvedName,
        params
      });
      if (!result.ok) {
        showToast('参数已保存，但应用失败：' + (result.error?.message || result.error?.code || '未知错误'));
        return;
      }
    }

    showToast('已保存主题设置');
  }, [settingsTheme, setThemeParams, runningId, callKernel, showToast, native, refreshThemes]);

  const handleDraft = useCallback((patch) => {
    setDraft((current) => ({ ...(current || blankDraft()), ...patch }));
  }, []);

  const handleDraftParams = useCallback((patch) => {
    setDraft((current) => {
      const base = current || blankDraft();
      return { ...base, params: { ...base.params, ...patch } };
    });
  }, []);

  const toggleDraftTag = useCallback((tag, checked) => {
    setDraft((current) => {
      const base = current || blankDraft();
      const tags = checked
        ? [...new Set([...base.tags, tag])]
        : base.tags.filter((item) => item !== tag);
      return { ...base, tags };
    });
  }, []);

  const handleDraftFile = useCallback((file) => {
    if (!file) return;

    const isVideo = (file.type || '').startsWith('video/');
    const isImage = (file.type || '').startsWith('image/');
    if (!isVideo && !isImage) {
      showToast('请选择图片或视频文件');
      return;
    }

    const src = URL.createObjectURL(file);
    setDraft((current) => {
      const base = current || blankDraft();
      return {
        ...base,
        src,
        isVideo,
        name: base.name || file.name.replace(/\.[^.]+$/, '').slice(0, 24)
      };
    });

    showToast(isVideo ? '已载入视频，保存后仅在本次会话可用' : '已载入图片');
  }, [showToast]);

  const pickMedia = useCallback(async () => {
    const picked = await callKernel('file.pick', { kind: 'media', mode: 'open' });
    if (!picked.ok) {
      showToast('选择文件失败：' + (picked.error?.message || picked.error?.code || '未知错误'));
      return;
    }
    if (picked.data?.canceled) return;

    const info = picked.data;
    if (info.kind !== 'image' && info.kind !== 'video') {
      showToast('请选择图片或视频文件');
      return;
    }

    setDraft((current) => {
      const base = current || blankDraft();
      return {
        ...base,
        path: info.path,
        token: info.token || '',
        src: info.previewUrl || '',
        isVideo: info.kind === 'video',
        name: base.name || String(info.name || '').replace(/\.[^.]+$/, '').slice(0, 24)
      };
    });
    showToast(info.previewSkipped
      ? '已载入素材（文件较大，跳过预览，可直接保存）'
      : (info.kind === 'video' ? '已载入视频' : '已载入图片'));
  }, [callKernel, showToast]);

  const saveDraft = useCallback(async () => {
    const current = draft;
    if (!current || (!current.src && !current.path)) {
      showToast('先选择一张图片或视频');
      return;
    }

    const tags = current.tags.length ? current.tags : ['艺术'];

    if (native) {
      if (!current.path) {
        showToast('请通过“选择文件”重新选择素材');
        return;
      }
      const result = await callKernel('theme.import', {
        name: current.name || '我的主题',
        tags,
        params: normalizeParams(current.params),
        token: current.token || undefined,
        path: current.path,
        kind: current.isVideo ? 'video' : 'image'
      });
      if (!result.ok) {
        showToast('保存失败：' + (result.error?.message || result.error?.code || '未知错误'));
        return;
      }
      const theme = result.data.theme;
      await refreshThemes();
      setLibrary((currentLibrary) => ({ ...currentLibrary, selectedId: theme.id }));
      setSettingsId(theme.id);
      setFilters({ search: '', category: 'all', source: 'my', sort: 'catalog' });
      setView('console');
      setDraft(null);
      if (native) bridge.request('settings.set', { settings: { selectedThemeId: theme.id } });
      showToast('已保存主题：' + theme.name);
      return;
    }

    const now = Date.now();
    let image = '';

    if (!current.isVideo) {
      try {
        image = await downscaleImage(current.src);
      } catch {
        showToast('图片无法读取，换一张试试');
        return;
      }
    }

    const theme = {
      id: 'my-' + now.toString(36),
      name: (current.name || '我的主题 ' + (library.my.length + 1)).slice(0, 24),
      tags,
      dot: current.params.accent,
      builtin: false,
      bg: '',
      image,
      video: current.isVideo,
      videoSrc: current.isVideo ? current.src : '',
      needsFile: false,
      params: normalizeParams(current.params),
      at: now
    };

    addTheme(theme);
    setDraft(null);
    showToast('已保存主题：' + theme.name);
  }, [draft, library.my.length, addTheme, showToast, native, callKernel, refreshThemes, bridge]);

  const deleteTheme = useCallback(async () => {
    const theme = selectedTheme;
    if (!theme) return;

    if (!deleteConfirm) {
      setDeleteConfirm(true);
      showToast('再点一次确认删除');
      return;
    }

    if (native && !theme.builtin) {
      const result = await callKernel('theme.remove', { themeId: theme.id });
      if (!result.ok) {
        setDeleteConfirm(false);
        showToast('删除失败：' + (result.error?.message || result.error?.code || '未知错误'));
        return;
      }
      const restoreFailed = result.data?.restoreFailed;
      if (runningId === theme.id) {
        setRunningId(null);
        setPaused(false);
      }
      const themes = await refreshThemes();
      const remaining = themes.filter((item) => item.id !== theme.id);
      const nextId = remaining[0]?.id || 'forest';
      setLibrary((current) => ({ ...current, selectedId: nextId }));
      setSettingsId(nextId);
      bridge.request('settings.set', { settings: { selectedThemeId: nextId } });
      setDeleteConfirm(false);
      showToast(restoreFailed
        ? '主题已删除，但宿主注入未撤销；重新应用任意主题即可覆盖'
        : '已删除主题');
      return;
    }

    const remaining = allThemes.filter((item) => item.id !== theme.id);

    setLibrary((current) => {
      const my = theme.builtin ? current.my : current.my.filter((item) => item.id !== theme.id);
      const hidden = theme.builtin ? [...current.hidden, theme.id] : current.hidden;
      return {
        ...current,
        my,
        hidden,
        selectedId: remaining[0]?.id || 'forest'
      };
    });

    if (runningId === theme.id) {
      setRunningId(null);
      setPaused(false);
      await callKernel('theme.restore');
    }

    const nextId = remaining[0]?.id || 'forest';
    setSettingsId(nextId);
    if (native) bridge.request('settings.set', { settings: { selectedThemeId: nextId } });
    setDeleteConfirm(false);
    showToast(theme.builtin ? '已删除内置主题' : '已删除主题');
  }, [selectedTheme, deleteConfirm, allThemes, runningId, callKernel, showToast, native, refreshThemes, bridge]);

  const importPack = useCallback(async (file) => {
    try {
      const pack = JSON.parse(await file.text());
      if (!pack || !pack.name) throw new Error('bad pack');

      const tags = Array.isArray(pack.tags) ? pack.tags.filter((tag) => TAG_LIST.includes(tag)) : [];
      const bg = typeof pack.bg === 'string' ? pack.bg : '';
      const image = typeof pack.image === 'string' ? pack.image : '';
      const video = !!pack.video;
      if (!bg && !image && !video) throw new Error('no visual');

      const theme = {
        id: 'my-' + Date.now().toString(36),
        name: String(pack.name).slice(0, 24),
        tags: tags.length ? tags : ['艺术'],
        dot: pack.params?.accent || '#6F9275',
        builtin: false,
        bg,
        image,
        video,
        videoSrc: '',
        needsFile: video,
        params: normalizeParams(pack.params),
        at: Date.now()
      };

      addTheme(theme);
      showToast('已导入主题包：' + theme.name);
    } catch {
      showToast('主题包格式不正确');
    }
  }, [addTheme, showToast]);

  const pickPack = useCallback(async () => {
    const picked = await callKernel('file.pick', { kind: 'pack', mode: 'open' });
    if (!picked.ok) {
      showToast('选择主题包失败：' + (picked.error?.message || picked.error?.code || '未知错误'));
      return;
    }
    if (picked.data?.canceled) return;

    const result = await callKernel('theme.import', { token: picked.data.token });
    if (!result.ok) {
      showToast('主题包导入失败：' + (result.error?.message || result.error?.code || '未知错误'));
      return;
    }

    const theme = result.data.theme;
    await refreshThemes();
    setLibrary((current) => ({ ...current, selectedId: theme.id }));
    setSettingsId(theme.id);
    setFilters({ search: '', category: 'all', source: 'my', sort: 'catalog' });
    setView('console');
    bridge.request('settings.set', { settings: { selectedThemeId: theme.id } });
    showToast('已导入主题包：' + theme.name);
  }, [callKernel, refreshThemes, bridge, showToast]);

  const exportNative = useCallback(async (suggestedName, kind = 'pack') => {
    const picked = await callKernel('file.pick', {
      kind,
      mode: 'save',
      suggestedName
    });
    if (!picked.ok) {
      showToast('导出失败：' + (picked.error?.message || picked.error?.code || '未知错误'));
      return;
    }
    if (picked.data?.canceled) return;

    const result = await callKernel('theme.export', {
      themeId: selectedTheme.id,
      token: picked.data.token
    });
    if (!result.ok) {
      showToast('导出失败：' + (result.error?.message || result.error?.code || '未知错误'));
      return;
    }
    // 内核按扩展名分派导出格式，未知扩展名已经直接报错；这里兜的是
    // 用户在“下载素材”里选了 .bbskin / .json 的情况——导出会成功，但拿到的不是素材。
    if (kind === 'media' && result.data?.format !== 'media') {
      showToast('导出失败：这个文件名不是素材格式，请改用 .jpg / .png / .mp4 等素材后缀');
      return;
    }
    showToast((kind === 'media' ? '已下载素材：' : '已导出主题包：') + (picked.data.name || picked.data.path));
  }, [selectedTheme, callKernel, showToast]);

  const exportTheme = useCallback(async () => {
    if (!selectedTheme) return;
    if (native) {
      await exportNative(`${selectedTheme.name || 'theme'}.bbskin`);
      return;
    }
    downloadJson(themePack(selectedTheme, themeParams(selectedTheme)), selectedTheme.name + '.bbtheme.json');
    showToast('已导出主题：' + selectedTheme.name);
  }, [selectedTheme, themeParams, showToast, native, exportNative]);

  const exportAssets = useCallback(async () => {
    if (!selectedTheme) return;

    if (native) {
      const file = selectedTheme.media?.file || '';
      if (!file) {
        showToast('这个主题没有可下载的素材');
        return;
      }
      const dot = file.lastIndexOf('.');
      const extension = dot >= 0 ? file.slice(dot) : '';
      await exportNative(`${selectedTheme.name || 'theme'}${extension}`, 'media');
      return;
    }

    if (selectedTheme.image && selectedTheme.image.startsWith('data:')) {
      const mime = selectedTheme.image.slice(5, selectedTheme.image.indexOf(';')).toLowerCase();
      const extension = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : mime === 'image/gif' ? '.gif' : '.jpg';
      downloadDataUrl(selectedTheme.image, selectedTheme.name + extension);
      showToast('已下载素材');
      return;
    }

    downloadJson(themePack(selectedTheme, themeParams(selectedTheme)), selectedTheme.name + '.bbtheme.json');
    showToast(selectedTheme.video ? '已导出主题配置（视频素材不随包导出）' : '已导出主题配置（本地素材不重复下载）');
  }, [selectedTheme, themeParams, showToast, native, exportNative]);

  const refreshLibrary = useCallback(async () => {
    const result = await callKernel('host.detect');
    if (result.ok) applyHostInfo(result.data);
    if (native) await refreshThemes();
    showToast('主题库已刷新');
  }, [callKernel, showToast, native, refreshThemes, applyHostInfo]);

  const recoveryNotice = recovery && recovery.attention && recoveryDismissed !== recovery.verdict
    ? recovery
    : null;

  const handleRecoveryAction = useCallback(async () => {
    if (!recovery) return;

    if (recovery.action === 'restore') {
      await restoreSkin();
      setRecovery(null);
      return;
    }

    if (recovery.action === 'reapply' && recovery.themeId) {
      const result = await callKernel('theme.apply', { themeId: recovery.themeId });
      if (result.ok) {
        setRunningId(recovery.themeId);
        setPaused(false);
        setRecovery(null);
        showToast('已重新应用「' + (result.data?.name || recovery.themeId) + '」');
      } else {
        showToast('重新应用失败：' + (result.error?.message || result.error?.code || '未知错误'));
      }
      return;
    }

    if (recovery.action === 'redetect') {
      const detected = await callKernel('host.detect');
      if (detected.ok) {
        applyHostInfo(detected.data);
        setRecovery(detected.data.recovery || null);
      } else {
        showToast('重新检测失败：' + (detected.error?.message || detected.error?.code || '未知错误'));
      }
    }
  }, [recovery, restoreSkin, callKernel, showToast, applyHostInfo]);

  const dismissRecovery = useCallback(() => {
    setRecoveryDismissed(recovery ? recovery.verdict : null);
  }, [recovery]);

  useEffect(() => {
    window.__bb = {
      snapshot: () => ({
        view,
        selectedId: library.selectedId,
        runningId,
        paused,
        total: allThemes.length,
        native,
        host: host.status,
        kernel: kernel.status,
        capabilities: kernel.capabilities || []
      }),
      actions: { switchView, selectTheme, applySkin, pauseSkin, resetSkin, restoreSkin, saveDraft, importPack, pickPack, pickMedia, confirmRestartApply }
    };
  });

  const runState = runningTheme
    ? { text: paused ? '已暂停' : '运行中', cls: paused ? 'paused' : 'running' }
    : { text: '未运行', cls: '' };

  const promptTheme = restartPrompt ? findTheme(restartPrompt.themeId) : null;
  const promptName = promptTheme?.name || selectedTheme?.name || '主题';

  return (
    <div className="app">
      <TopBar
        view={view}
        onChange={switchView}
        runState={runState}
        onCheckUpdate={() => showToast('当前版本 v' + __APP_VERSION__ + ' · 本地构建，不会联网检查更新')}
      />

      <main className="main">
        {view === 'console' ? (
          <ConsoleView
            themes={visibleThemes}
            selectedTheme={selectedTheme}
            selectedId={selectedTheme?.id || ''}
            runningTheme={runningTheme}
            paused={paused}
            params={selectedParams}
            filters={filters}
            deleteConfirm={deleteConfirm}
            onFilter={setFiltersSafe}
            onSelect={selectTheme}
            onApply={applySkin}
            onPause={pauseSkin}
            onReset={resetSkin}
            onRestore={restoreSkin}
            native={native}
            applyBusy={applyBusy}
            hosts={hostList}
            activeHost={activeHost}
            hostSwitching={hostSwitching}
            hostName={activeHostName}
            onSwitchHost={switchActiveHost}
            onOpenHostWizard={() => setView('host')}
            onAddImage={() => { setDraft(blankDraft()); setView('import'); }}
            onImportPack={importPack}
            onPickPack={pickPack}
            onExportTheme={exportTheme}
            onExportAssets={exportAssets}
            onDelete={deleteTheme}
            onEditParams={() => { setSettingsId(library.selectedId); setView('settings'); }}
            onRefresh={refreshLibrary}
            recovery={recoveryNotice}
            onRecoveryAction={handleRecoveryAction}
            onDismissRecovery={dismissRecovery}
          />
        ) : null}

        {view === 'import' && draft ? (
          <ImportView
            draft={draft}
            native={native}
            onDraft={handleDraft}
            onParams={handleDraftParams}
            onToggleTag={toggleDraftTag}
            onFile={handleDraftFile}
            onPick={pickMedia}
            onSave={saveDraft}
            onCancel={() => { setDraft(null); setView('console'); }}
          />
        ) : null}

        {view === 'host' ? (
          <HostWizard bridge={bridge} native={native} />
        ) : null}

        {view === 'settings' && settingsTheme ? (
          <SettingsView
            key={settingsTheme.id}
            themes={allThemes}
            themeId={settingsTheme.id}
            params={settingsParams}
            native={native}
            bridge={bridge}
            minimizeToTray={shellSettings.minimizeToTray}
            onMinimizeToTray={setMinimizeToTray}
            prefs={prefs}
            onPreference={setPreference}
            onHostStartup={() => setHostStartupConfirm(true)}
            activeHostName={activeHostName}
            onSaveHostPath={saveZcodePath}
            schedule={schedule}
            onSaveRule={saveRule}
            onRemoveRule={removeRule}
            onSelect={(id) => setSettingsId(id)}
            onSave={saveSettings}
            onCancel={() => showToast('已取消修改')}
          />
        ) : null}
      </main>

      <Footer total={allThemes.length} host={host} kernel={kernel} onRefresh={refreshLibrary} />

      {restartPrompt ? (
        <ConfirmDialog
          testId="restart-confirm"
          title={restartPrompt.running ? `需要重启 ${activeHostName}` : `需要启动 ${activeHostName}`}
          message={restartPrompt.running
            ? `应用「${promptName}」需要 ${activeHostName} 开放调试端口。将关闭当前 ${activeHostName} 窗口并自动重启，完成后自动应用这张壁纸；不会修改 ${activeHostName} 的安装文件。`
            : `应用「${promptName}」需要先启动 ${activeHostName} 并开放调试端口。将自动启动 ${activeHostName}，完成后自动应用这张壁纸；不会修改 ${activeHostName} 的安装文件。`}
          confirmLabel={restartPrompt.running ? '重启并应用' : '启动并应用'}
          busy={applyBusy}
          onConfirm={confirmRestartApply}
          onCancel={() => { if (!applyBusy) setRestartPrompt(null); }}
        />
      ) : null}

      {hostStartupConfirm ? (
        <ConfirmDialog
          testId="host-startup-confirm"
          title={`启动 / 重启 ${activeHostName}`}
          message={`将关闭当前 ${activeHostName} 窗口并通过 BackdropBuddy 重新启动，恢复正在使用的皮肤${selectedTheme?.startup?.enabled ? `，并显示「${selectedTheme.name}」的启动动画` : ''}。请保存宿主中未完成的内容；不会修改宿主安装文件。`}
          confirmLabel="确认启动 / 重启"
          busy={hostStartupBusy}
          onConfirm={confirmHostStartup}
          onCancel={() => { if (!hostStartupBusy) setHostStartupConfirm(false); }}
        />
      ) : null}

      <Toast toast={toast} />
    </div>
  );
}
