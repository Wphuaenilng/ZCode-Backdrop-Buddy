using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Web.Script.Serialization;
using System.Windows;
using System.Windows.Input;
using BackdropBuddy.Shell.Infrastructure;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace BackdropBuddy.Shell
{
    public partial class MainWindow : Window
    {
        private const string ManagerHost = "manager.backdropbuddy.invalid";
        private const string MediaHost = "media.backdropbuddy.invalid";
        private const string PreviewHost = "preview.backdropbuddy.invalid";
        private const long PreviewMaxBytes = 64L * 1024 * 1024;

        private KernelProcess _kernel;
        private ProtocolBridge _bridge;
        private SchedulePump _schedule;
        private readonly PathTokenStore _pathTokens = new PathTokenStore();
        private readonly SplashWindow _splash;
        private bool _initialized;
        private System.Windows.Forms.NotifyIcon _tray;
        private System.Windows.Forms.ContextMenuStrip _trayMenu;
        private System.Windows.Forms.ToolStripMenuItem _trayStateItem;
        private System.Windows.Forms.ToolStripMenuItem _trayPauseItem;
        private System.Windows.Forms.ToolStripMenuItem _trayRestoreItem;
        private System.Drawing.Icon _trayIcon;
        private bool _trayRunning;
        private bool _trayPaused;
        private bool _trayCanRestore;
        private string _trayThemeName;
        private bool _minimizeToTray;
        private bool _allowExit;

        public MainWindow(SplashWindow splash)
        {
            _splash = splash;
            InitializeComponent();
            WebView.DefaultBackgroundColor = System.Drawing.Color.FromArgb(0xF1, 0xF2, 0xF6);
            FitToWorkArea();
            RestoreWindowState();
            FitToWorkArea();
            UpdateTray();
            Loaded += OnLoaded;
            Closing += OnClosing;
            PreviewKeyDown += OnPreviewKeyDown;
            Application.Current.SessionEnding += (sender, args) => { _allowExit = true; };
        }

        private void OnPreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape && _splash != null)
            {
                _splash.SkipNow();
                e.Handled = true;
            }
        }

        public void ActivateFromSecondInstance()
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
                Show();
                Activate();
                Topmost = true;
                Topmost = false;
                Focus();
            }));
        }

        private async void OnLoaded(object sender, RoutedEventArgs e)
        {
            if (_initialized) return;
            _initialized = true;

            // Let the splash window render its first frames before the kernel and WebView2 start competing for the UI thread.
            await System.Windows.Threading.Dispatcher.Yield(System.Windows.Threading.DispatcherPriority.ApplicationIdle);

            try
            {
                await InitializeAsync();
            }
            catch (WebView2RuntimeNotFoundException)
            {
                Logs.Shell.Write("ERROR", "webview2 runtime missing");
                ShowError("未检测到 WebView2 Runtime。请先安装 Microsoft Edge WebView2 Runtime 后再启动 BackdropBuddy。");
            }
            catch (Exception error)
            {
                Logs.Shell.Write("ERROR", "initialization failed: " + error);
                ShowError("界面初始化失败：" + error.Message);
            }
        }

        private async System.Threading.Tasks.Task InitializeAsync()
        {
            StartKernel();

            string indexPath = Path.Combine(AppPaths.UiRoot, "index.html");
            if (!File.Exists(indexPath))
            {
                ShowError("UI 资源缺失：" + indexPath + "。请先构建 ui（Vite 输出到 ui/dist）。");
                return;
            }

            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(
                null,
                AppPaths.WebView2Data,
                null);

            await WebView.EnsureCoreWebView2Async(environment);
            if (_splash != null) _splash.NotifyPhase(SplashWindow.PhaseWebview);

            CoreWebView2 core = WebView.CoreWebView2;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.AreDefaultContextMenusEnabled = false;
#if DEBUG
            core.Settings.AreDevToolsEnabled = true;
#else
            core.Settings.AreDevToolsEnabled = IsDevToolsEnabledByEnv();
#endif
            core.Settings.IsZoomControlEnabled = false;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.IsGeneralAutofillEnabled = false;
            core.Settings.IsPasswordAutosaveEnabled = false;

            core.SetVirtualHostNameToFolderMapping(
                ManagerHost,
                AppPaths.UiRoot,
                CoreWebView2HostResourceAccessKind.Allow);
            core.SetVirtualHostNameToFolderMapping(
                MediaHost,
                AppPaths.ThemesRoot,
                CoreWebView2HostResourceAccessKind.Allow);
            core.SetVirtualHostNameToFolderMapping(
                PreviewHost,
                AppPaths.PreviewRoot,
                CoreWebView2HostResourceAccessKind.Allow);

            core.WebMessageReceived += OnWebMessageReceived;
            core.NavigationCompleted += OnNavigationCompleted;
            core.NewWindowRequested += (sender, args) => { args.Handled = true; };

            WebView.Visibility = Visibility.Visible;

            Logs.Shell.Write("INFO", "webview2 ready version=" + environment.BrowserVersionString + " ui=" + AppPaths.UiRoot);
            core.Navigate("https://" + ManagerHost + "/index.html");
        }

        private void StartKernel()
        {
            _kernel = new KernelProcess(AppPaths.NodeExe, AppPaths.KernelMain, AppPaths.AppRoot);
            _bridge = new ProtocolBridge(_kernel, SendToUi, _pathTokens, AppPaths.ExportsRoot);
            _bridge.LocalRequestHandler = HandleLocalRequest;
            _kernel.FrameReceived += frame => _bridge.FromKernel(frame);
            // 规则一变就重新计时：不然新规则要等下一次自检才被壳注意到
            _kernel.FrameReceived += frame =>
            {
                if (!string.IsNullOrEmpty(frame) && frame.Contains("schedule.updated"))
                {
                    var pump = _schedule;
                    if (pump != null) pump.MarkChanged();
                }
            };

            try
            {
                _kernel.Start();
                if (_splash != null) _splash.NotifyPhase(SplashWindow.PhaseKernel);
                // 托盘动作用的是同一个内核会话，先握一次手，避免 UI 尚未就绪时被 HANDSHAKE_REQUIRED 挡住
                _bridge.Request("system.hello", null, result =>
                {
                    if (IsOkResult(result) && _splash != null) _splash.NotifyPhase(SplashWindow.PhaseHello);
                });
                RefreshTrayState();
                _schedule = new SchedulePump(_bridge);
                _schedule.Start();
            }
            catch (Exception error)
            {
                Logs.Shell.Write("ERROR", "kernel start failed: " + error.Message);
            }
        }

        private static bool IsOkResult(Dictionary<string, object> result)
        {
            return result != null && result.TryGetValue("ok", out var ok) && true.Equals(ok);
        }

        private void OnWebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            string json = e.WebMessageAsJson;
            // UI 首屏数据就绪的自定义信号（非协议帧），只发给启动窗，不进协议桥
            if (!string.IsNullOrEmpty(json) && json.IndexOf("ui.ready", StringComparison.Ordinal) >= 0)
            {
                if (_splash != null) _splash.NotifyUiReady();
                return;
            }
            if (_bridge == null) return;
            _bridge.FromUi(json);
        }

        private void OnNavigationCompleted(object sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess)
            {
                Logs.Shell.Write("INFO", "ui navigation completed");
                if (_splash != null) _splash.NotifyPhase(SplashWindow.PhaseNavigated);
                return;
            }

            Logs.Shell.Write("ERROR", "navigation failed: " + e.WebErrorStatus);
            ShowError("界面加载失败（" + e.WebErrorStatus + "）。日志中有详细信息。");
        }

        private void SendToUi(string json)
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                try
                {
                    CoreWebView2 core = WebView.CoreWebView2;
                    if (core != null) core.PostWebMessageAsJson(json);
                }
                catch (Exception error)
                {
                    Logs.Shell.Write("WARN", "post to UI failed: " + error.Message);
                }
            }));
        }

        private void ShowError(string message)
        {
            WebView.Visibility = Visibility.Collapsed;
            ErrorText.Text = message;
            ErrorPanel.Visibility = Visibility.Visible;
            if (_splash != null) _splash.Abort();
        }

        private Dictionary<string, object> HandleLocalRequest(Dictionary<string, object> message)
        {
            string method = GetString(message, "method");
            var parameters = message.ContainsKey("params") ? message["params"] as Dictionary<string, object> : null;

            switch (method)
            {
                case "shell.settings.get":
                    return ShellSettings();
                case "shell.settings.set":
                    return ApplyShellSettings(parameters);
                case "file.pick":
                    break;
                default:
                    throw new InvalidOperationException("unsupported local method: " + method);
            }

            string mode = GetString(parameters, "mode") ?? "open";
            string kind = GetString(parameters, "kind") ?? "any";
            string suggestedName = GetString(parameters, "suggestedName");

            return string.Equals(mode, "save", StringComparison.Ordinal)
                ? PickSave(kind, suggestedName)
                : PickOpen(kind);
        }

        private Dictionary<string, object> ShellSettings()
        {
            return new Dictionary<string, object> { { "minimizeToTray", _minimizeToTray } };
        }

        private Dictionary<string, object> ApplyShellSettings(Dictionary<string, object> parameters)
        {
            bool minimizeToTray = ToBool(parameters, "minimizeToTray", _minimizeToTray);
            if (minimizeToTray != _minimizeToTray)
            {
                _minimizeToTray = minimizeToTray;
                UpdateTray();
                SaveWindowState();
                Logs.Shell.Write("INFO", "minimizeToTray=" + _minimizeToTray);
            }

            return ShellSettings();
        }

        private void UpdateTray()
        {
            if (_minimizeToTray) EnsureTray();
            else RemoveTray();
        }

        private void EnsureTray()
        {
            if (_tray != null) return;

            _trayIcon = LoadTrayIcon();
            _trayMenu = CreateTrayMenu();

            _tray = new System.Windows.Forms.NotifyIcon
            {
                Icon = _trayIcon,
                Text = "BackdropBuddy",
                Visible = true,
                ContextMenuStrip = _trayMenu
            };
            _tray.MouseClick += (sender, args) =>
            {
                if (args.Button == System.Windows.Forms.MouseButtons.Left) ActivateFromSecondInstance();
            };
            Logs.Shell.Write("INFO", "tray icon created");
            RefreshTrayState();
        }

        private void RefreshTrayState()
        {
            if (_bridge == null) return;

            _bridge.Request("status.get", null, response => Dispatcher.BeginInvoke(new Action(() =>
            {
                if (!IsOk(response))
                {
                    // BUSY/超时都会落到这里，保留上一次的标签比误报"未运行"安全
                    Logs.Shell.Write("WARN", "tray status refresh failed: " + DescribeError(response));
                    return;
                }

                var data = response["data"] as Dictionary<string, object>;
                var theme = data != null && data.ContainsKey("theme") ? data["theme"] as Dictionary<string, object> : null;
                bool running = theme != null;
                bool paused = data != null && data.ContainsKey("paused") && data["paused"] is bool && (bool)data["paused"];
                string name = theme != null && theme.ContainsKey("name") ? theme["name"] as string : null;

                bool canRestore = running;
                if (!canRestore)
                {
                    var host = data != null && data.ContainsKey("host") ? data["host"] as Dictionary<string, object> : null;
                    var recovery = host != null && host.ContainsKey("recovery") ? host["recovery"] as Dictionary<string, object> : null;
                    canRestore = recovery != null && string.Equals(GetString(recovery, "action"), "restore", StringComparison.Ordinal);
                }

                ApplyTrayLabels(running, paused, name, canRestore);
            })));
        }

        private void ApplyTrayLabels(bool running, bool paused, string name, bool canRestore)
        {
            _trayRunning = running;
            _trayPaused = paused;
            _trayCanRestore = canRestore;
            _trayThemeName = name;

            if (_trayStateItem != null)
            {
                string label = running
                    ? (paused ? "已暂停 · " : "运行中 · ") + (string.IsNullOrEmpty(name) ? "主题" : name)
                    : "未运行";
                _trayStateItem.Text = label.Length > 48 ? label.Substring(0, 47) + "…" : label;
                Logs.Shell.Write("INFO", "tray state " + _trayStateItem.Text + " restore=" + canRestore);
            }

            if (_trayPauseItem != null)
            {
                _trayPauseItem.Text = paused ? "继续皮肤" : "暂停皮肤";
                _trayPauseItem.Enabled = running;
            }

            if (_trayRestoreItem != null) _trayRestoreItem.Enabled = canRestore;
        }

        private void TrayPauseResume()
        {
            if (!_trayRunning || _bridge == null) return;

            string method = _trayPaused ? "theme.resume" : "theme.pause";
            _bridge.Request(method, null, response => Dispatcher.BeginInvoke(new Action(() =>
            {
                if (!IsOk(response)) Logs.Shell.Write("WARN", "tray " + method + " failed: " + DescribeError(response));
                RefreshTrayState();
            })));
        }

        private void TrayRestore()
        {
            if (_bridge == null) return;

            _bridge.Request("theme.restore", null, response => Dispatcher.BeginInvoke(new Action(() =>
            {
                if (!IsOk(response)) Logs.Shell.Write("WARN", "tray restore failed: " + DescribeError(response));
                RefreshTrayState();
            })));
        }

        private static bool IsOk(Dictionary<string, object> response)
        {
            object value;
            return response != null && response.TryGetValue("ok", out value) && value is bool && (bool)value;
        }

        private static string DescribeError(Dictionary<string, object> response)
        {
            var error = response != null && response.ContainsKey("error")
                ? response["error"] as Dictionary<string, object>
                : null;
            string code = error != null ? GetString(error, "code") : null;
            string message = error != null ? GetString(error, "message") : null;
            if (string.IsNullOrEmpty(message)) return code ?? "unknown";
            return string.IsNullOrEmpty(code) ? message : code + ": " + message;
        }

        private System.Windows.Forms.ContextMenuStrip CreateTrayMenu()
        {
            var background = System.Drawing.ColorTranslator.FromHtml("#FCFBF8");
            var text = System.Drawing.ColorTranslator.FromHtml("#2B2A26");

            var menu = new System.Windows.Forms.ContextMenuStrip
            {
                Renderer = new TrayMenuRenderer(new TrayMenuColorTable()),
                ShowImageMargin = true,
                ShowCheckMargin = false,
                Font = new System.Drawing.Font("Microsoft YaHei UI", 9F),
                BackColor = background,
                ForeColor = text,
                Padding = new System.Windows.Forms.Padding(6),
                ImageScalingSize = new System.Drawing.Size(12, 12),
                DropShadowEnabled = true
            };

            System.Windows.Forms.ToolStripMenuItem Item(string label, string dot)
            {
                return new System.Windows.Forms.ToolStripMenuItem(label, dot == null ? null : CreateMenuDot(dot))
                {
                    ForeColor = text,
                    Padding = new System.Windows.Forms.Padding(6, 6, 18, 6),
                    ImageAlign = System.Drawing.ContentAlignment.MiddleCenter,
                    TextAlign = System.Drawing.ContentAlignment.MiddleLeft
                };
            }

            System.Windows.Forms.ToolStripSeparator Divider()
            {
                return new System.Windows.Forms.ToolStripSeparator
                {
                    Margin = new System.Windows.Forms.Padding(8, 4, 8, 4)
                };
            }

            _trayStateItem = Item("未运行", null);
            _trayStateItem.Enabled = false;

            var open = Item("打开主界面", "#C6A15B");
            open.Click += (sender, args) => ActivateFromSecondInstance();

            _trayPauseItem = Item("暂停皮肤", "#C9A227");
            _trayPauseItem.Enabled = false;
            _trayPauseItem.Click += (sender, args) => TrayPauseResume();

            _trayRestoreItem = Item("恢复原貌", "#B4705E");
            _trayRestoreItem.Enabled = false;
            _trayRestoreItem.Click += (sender, args) => TrayRestore();

            var exit = Item("退出", "#8A8F98");
            exit.Click += (sender, args) => ExitApplication();

            menu.Items.Add(_trayStateItem);
            menu.Items.Add(Divider());
            menu.Items.Add(open);
            menu.Items.Add(_trayPauseItem);
            menu.Items.Add(_trayRestoreItem);
            menu.Items.Add(Divider());
            menu.Items.Add(exit);
            menu.Opened += (sender, args) =>
            {
                Logs.Shell.Write("INFO", "tray menu opened");
                RefreshTrayState();
                RoundTrayMenu(menu);
            };
            return menu;
        }

        private static System.Drawing.Image CreateMenuDot(string color)
        {
            var bitmap = new System.Drawing.Bitmap(12, 12);
            using (var graphics = System.Drawing.Graphics.FromImage(bitmap))
            {
                graphics.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                graphics.Clear(System.Drawing.Color.Transparent);
                using (var brush = new System.Drawing.SolidBrush(System.Drawing.ColorTranslator.FromHtml(color)))
                {
                    graphics.FillEllipse(brush, 2, 2, 8, 8);
                }
            }
            return bitmap;
        }

        private static void RoundTrayMenu(System.Windows.Forms.ContextMenuStrip menu)
        {
            int radius = 10;
            int width = menu.Width;
            int height = menu.Height;
            using (var path = new System.Drawing.Drawing2D.GraphicsPath())
            {
                path.AddArc(0, 0, radius, radius, 180, 90);
                path.AddArc(width - radius - 1, 0, radius, radius, 270, 90);
                path.AddArc(width - radius - 1, height - radius - 1, radius, radius, 0, 90);
                path.AddArc(0, height - radius - 1, radius, radius, 90, 90);
                path.CloseFigure();
                menu.Region = new System.Drawing.Region(path);
            }
        }

        private sealed class TrayMenuRenderer : System.Windows.Forms.ToolStripProfessionalRenderer
        {
            private static readonly System.Drawing.Color HoverColor = System.Drawing.ColorTranslator.FromHtml("#F0EDE5");
            private static readonly System.Drawing.Color PressedColor = System.Drawing.ColorTranslator.FromHtml("#E7E2D6");
            private static readonly System.Drawing.Color DisabledText = System.Drawing.ColorTranslator.FromHtml("#A7A39A");

            public TrayMenuRenderer(System.Windows.Forms.ProfessionalColorTable table) : base(table) { }

            protected override void OnRenderMenuItemBackground(System.Windows.Forms.ToolStripItemRenderEventArgs e)
            {
                if (!e.Item.Selected && !e.Item.Pressed) return;

                var color = e.Item.Pressed ? PressedColor : HoverColor;
                var rect = new System.Drawing.Rectangle(4, 1, e.Item.Width - 8, e.Item.Height - 2);
                using (var path = RoundedRectangle(rect, 6))
                using (var brush = new System.Drawing.SolidBrush(color))
                {
                    e.Graphics.FillPath(brush, path);
                }
            }

            protected override void OnRenderItemImage(System.Windows.Forms.ToolStripItemImageRenderEventArgs e)
            {
                if (e.Image == null) return;

                var bounds = e.ImageRectangle;
                int x = bounds.Left + (bounds.Width - e.Image.Width) / 2;
                int y = (e.Item.Height - e.Image.Height) / 2;
                e.Graphics.DrawImage(e.Image, new System.Drawing.Rectangle(x, y, e.Image.Width, e.Image.Height));
            }

            protected override void OnRenderItemText(System.Windows.Forms.ToolStripItemTextRenderEventArgs e)
            {
                var rect = new System.Drawing.Rectangle(
                    e.TextRectangle.Left,
                    0,
                    e.TextRectangle.Width,
                    e.Item.Height);

                var flags = System.Windows.Forms.TextFormatFlags.Left
                    | System.Windows.Forms.TextFormatFlags.VerticalCenter
                    | System.Windows.Forms.TextFormatFlags.NoPrefix
                    | System.Windows.Forms.TextFormatFlags.NoPadding;

                var color = e.Item.Enabled ? e.Item.ForeColor : DisabledText;
                System.Windows.Forms.TextRenderer.DrawText(e.Graphics, e.Text, e.TextFont, rect, color, flags);
            }

            private static System.Drawing.Drawing2D.GraphicsPath RoundedRectangle(System.Drawing.Rectangle rect, int radius)
            {
                var path = new System.Drawing.Drawing2D.GraphicsPath();
                int diameter = radius * 2;
                path.AddArc(rect.Left, rect.Top, diameter, diameter, 180, 90);
                path.AddArc(rect.Right - diameter, rect.Top, diameter, diameter, 270, 90);
                path.AddArc(rect.Right - diameter, rect.Bottom - diameter, diameter, diameter, 0, 90);
                path.AddArc(rect.Left, rect.Bottom - diameter, diameter, diameter, 90, 90);
                path.CloseFigure();
                return path;
            }
        }

        private sealed class TrayMenuColorTable : System.Windows.Forms.ProfessionalColorTable
        {
            private static readonly System.Drawing.Color Background = System.Drawing.ColorTranslator.FromHtml("#FCFBF8");
            private static readonly System.Drawing.Color Hover = System.Drawing.ColorTranslator.FromHtml("#F0EDE5");
            private static readonly System.Drawing.Color Pressed = System.Drawing.ColorTranslator.FromHtml("#E7E2D6");
            private static readonly System.Drawing.Color Border = System.Drawing.ColorTranslator.FromHtml("#E4DFD4");
            private static readonly System.Drawing.Color Divider = System.Drawing.ColorTranslator.FromHtml("#ECE8DF");

            public override System.Drawing.Color ToolStripDropDownBackground { get { return Background; } }
            public override System.Drawing.Color ImageMarginGradientBegin { get { return Background; } }
            public override System.Drawing.Color ImageMarginGradientMiddle { get { return Background; } }
            public override System.Drawing.Color ImageMarginGradientEnd { get { return Background; } }
            public override System.Drawing.Color MenuBorder { get { return Border; } }
            public override System.Drawing.Color MenuItemBorder { get { return Hover; } }
            public override System.Drawing.Color MenuItemSelected { get { return Hover; } }
            public override System.Drawing.Color MenuItemSelectedGradientBegin { get { return Hover; } }
            public override System.Drawing.Color MenuItemSelectedGradientEnd { get { return Hover; } }
            public override System.Drawing.Color MenuItemPressedGradientBegin { get { return Pressed; } }
            public override System.Drawing.Color MenuItemPressedGradientEnd { get { return Pressed; } }
            public override System.Drawing.Color SeparatorDark { get { return Divider; } }
            public override System.Drawing.Color SeparatorLight { get { return Divider; } }
        }

        private void RemoveTray()
        {
            if (_tray != null)
            {
                _tray.ContextMenuStrip = null;
                _tray.Visible = false;
                _tray.Dispose();
                _tray = null;
            }

            if (_trayMenu != null)
            {
                _trayMenu.Dispose();
                _trayMenu = null;
            }

            if (_trayIcon != null)
            {
                if (!ReferenceEquals(_trayIcon, System.Drawing.SystemIcons.Application)) _trayIcon.Dispose();
                _trayIcon = null;
            }
        }

        [System.Runtime.InteropServices.DllImport("shell32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)]
        private static extern int ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, int count);

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        private static extern bool DestroyIcon(IntPtr handle);

        private static System.Drawing.Icon LoadTrayIcon()
        {
            // 托盘是 16px，直接取 EXE 内嵌图标组的 16px 帧，比把 32px 缩下去清楚。
            try
            {
                string exe = System.Reflection.Assembly.GetEntryAssembly().Location;
                var small = new IntPtr[1];
                int count = ExtractIconEx(exe, 0, null, small, 1);
                if (count > 0 && small[0] != IntPtr.Zero)
                {
                    try
                    {
                        using (var handleIcon = System.Drawing.Icon.FromHandle(small[0]))
                        {
                            var icon = (System.Drawing.Icon)handleIcon.Clone();
                            Logs.Shell.Write("INFO", "tray icon loaded from exe 16px frame " + icon.Width + "x" + icon.Height);
                            return icon;
                        }
                    }
                    finally
                    {
                        DestroyIcon(small[0]);
                    }
                }
            }
            catch (Exception error)
            {
                Logs.Shell.Write("WARN", "16px tray icon extract failed: " + error.Message);
            }

            try
            {
                string exe = System.Reflection.Assembly.GetEntryAssembly().Location;
                System.Drawing.Icon icon = System.Drawing.Icon.ExtractAssociatedIcon(exe);
                if (icon != null) return icon;
            }
            catch (Exception error)
            {
                Logs.Shell.Write("WARN", "tray icon load failed: " + error.Message);
            }

            return System.Drawing.SystemIcons.Application;
        }

        private void ExitApplication()
        {
            _allowExit = true;
            Close();
        }

        private Dictionary<string, object> PickOpen(string kind)
        {
            var dialog = new OpenFileDialog
            {
                Title = "选择主题素材",
                CheckFileExists = true,
                Multiselect = false,
                Filter = FilterFor(kind),
                InitialDirectory = string.Equals(kind, "pack", StringComparison.Ordinal) ? AppPaths.ExportsRoot : string.Empty
            };

            if (dialog.ShowDialog(this) != true)
                return new Dictionary<string, object> { { "canceled", true } };

            string path = dialog.FileName;
            var info = new FileInfo(path);
            string detected = DetectKind(path);
            var result = new Dictionary<string, object>
            {
                { "canceled", false },
                { "path", path },
                { "token", _pathTokens.Register(path) },
                { "name", info.Name },
                { "kind", detected },
                { "bytes", info.Length }
            };

            if ((detected == "image" || detected == "video") && info.Length <= PreviewMaxBytes)
                result["previewUrl"] = CreatePreview(path);
            else if (detected == "image" || detected == "video")
                result["previewSkipped"] = true;

            return result;
        }

        private static bool IsDevToolsEnabledByEnv()
        {
            return string.Equals(
                Environment.GetEnvironmentVariable("BACKDROPBUDDY_DEVTOOLS"),
                "1",
                StringComparison.Ordinal);
        }

        private static string SanitizeFileName(string value)
        {
            string name = Path.GetFileName(value ?? string.Empty);
            if (string.IsNullOrWhiteSpace(name))
                return string.Empty;

            foreach (char invalid in Path.GetInvalidFileNameChars())
                name = name.Replace(invalid.ToString(), string.Empty);

            name = name.Trim().Trim('.');
            if (name.Length == 0)
                return string.Empty;
            return name.Length > 120 ? name.Substring(0, 120) : name;
        }

        private Dictionary<string, object> PickSave(string kind, string suggestedName)
        {
            string safeName = SanitizeFileName(suggestedName);
            bool media = string.Equals(kind, "media", StringComparison.Ordinal);
            var dialog = new SaveFileDialog
            {
                Title = media ? "下载素材" : "导出主题包",
                AddExtension = true,
                OverwritePrompt = true,
                Filter = FilterFor(kind),
                DefaultExt = DefaultExtension(kind, safeName),
                FileName = safeName.Length == 0 ? (media ? "theme" : "theme.bbskin") : safeName,
                InitialDirectory = AppPaths.ExportsRoot
            };

            if (dialog.ShowDialog(this) != true)
                return new Dictionary<string, object> { { "canceled", true } };

            return new Dictionary<string, object>
            {
                { "canceled", false },
                { "path", dialog.FileName },
                { "token", _pathTokens.Register(dialog.FileName) },
                { "name", Path.GetFileName(dialog.FileName) }
            };
        }

        private static string DetectKind(string path)
        {
            string extension = Path.GetExtension(path).ToLowerInvariant();
            if (new[] { ".jpg", ".jpeg", ".png", ".webp", ".gif" }.Contains(extension)) return "image";
            if (new[] { ".mp4", ".webm", ".mov", ".m4v" }.Contains(extension)) return "video";
            if (new[] { ".bbskin", ".zip", ".json" }.Contains(extension)) return "pack";
            return "any";
        }

        private static string FilterFor(string kind)
        {
            switch (kind)
            {
                case "image":
                    return "图片|*.jpg;*.jpeg;*.png;*.webp;*.gif|所有文件|*.*";
                case "video":
                    return "视频|*.mp4;*.webm;*.mov;*.m4v|所有文件|*.*";
                case "media":
                    return "图片和视频|*.jpg;*.jpeg;*.png;*.webp;*.gif;*.mp4;*.webm;*.mov;*.m4v|所有文件|*.*";
                case "pack":
                    return "BackdropBuddy 主题包|*.bbskin;*.zip;*.json|所有文件|*.*";
                default:
                    return "所有文件|*.*";
            }
        }

        // SaveFileDialog 的 AddExtension 只在 DefaultExt 非空时补全；素材可能是
        // jpg 也可能是 mp4，所以从建议文件名已带的扩展名推导，不写死格式。
        private static string DefaultExtension(string kind, string safeName)
        {
            if (string.Equals(kind, "pack", StringComparison.Ordinal)) return ".bbskin";
            if (!string.Equals(kind, "media", StringComparison.Ordinal)) return string.Empty;

            string extension = Path.GetExtension(safeName);
            return extension.Length > 1 ? extension : string.Empty;
        }

        private static string CreatePreview(string source)
        {
            string token = Guid.NewGuid().ToString("n");
            string directory = Path.Combine(AppPaths.PreviewRoot, token);
            Directory.CreateDirectory(directory);
            string name = Path.GetFileName(source);
            File.Copy(source, Path.Combine(directory, name), true);
            PrunePreviews(8);
            return "https://" + PreviewHost + "/" + token + "/" + Uri.EscapeDataString(name);
        }

        private static void PrunePreviews(int keep)
        {
            try
            {
                foreach (var directory in new DirectoryInfo(AppPaths.PreviewRoot)
                    .GetDirectories()
                    .OrderByDescending((item) => item.LastWriteTimeUtc)
                    .Skip(keep))
                {
                    try { directory.Delete(true); } catch { /* best effort */ }
                }
            }
            catch { /* best effort */ }
        }

        private void FitToWorkArea()
        {
            Rect area = SystemParameters.WorkArea;
            double maxWidth = Math.Max(640, area.Width - 24);
            double maxHeight = Math.Max(480, area.Height - 24);

            if (MinWidth > maxWidth) MinWidth = maxWidth;
            if (MinHeight > maxHeight) MinHeight = maxHeight;
            if (WindowState != WindowState.Normal) return;

            if (Width > maxWidth) Width = maxWidth;
            if (Height > maxHeight) Height = maxHeight;

            double virtualLeft = SystemParameters.VirtualScreenLeft;
            double virtualTop = SystemParameters.VirtualScreenTop;
            double virtualRight = virtualLeft + SystemParameters.VirtualScreenWidth;
            double virtualBottom = virtualTop + SystemParameters.VirtualScreenHeight;

            if (!double.IsNaN(Left) && !double.IsNaN(Top))
            {
                if (Left < virtualLeft) Left = virtualLeft;
                if (Top < virtualTop) Top = virtualTop;
                if (Left + Width > virtualRight) Left = Math.Max(virtualLeft, virtualRight - Width);
                if (Top + Height > virtualBottom) Top = Math.Max(virtualTop, virtualBottom - Height);
            }

            Logs.Shell.Write("INFO", "window fit workArea=" + area.Width + "x" + area.Height + " size=" + Width + "x" + Height);
        }

        private void RestoreWindowState()
        {
            try
            {
                if (!File.Exists(AppPaths.WindowStateFile)) return;
                var data = new JavaScriptSerializer().Deserialize<Dictionary<string, object>>(
                    File.ReadAllText(AppPaths.WindowStateFile, Encoding.UTF8));
                if (data == null) return;

                double width = ToDouble(data, "width", Width);
                double height = ToDouble(data, "height", Height);
                if (width >= MinWidth && height >= MinHeight)
                {
                    Width = width;
                    Height = height;
                }

                bool hasPosition = data.ContainsKey("left") && data.ContainsKey("top");
                double left = ToDouble(data, "left", Left);
                double top = ToDouble(data, "top", Top);
                if (hasPosition && IsOnScreen(left, top, Width, Height))
                {
                    WindowStartupLocation = WindowStartupLocation.Manual;
                    Left = left;
                    Top = top;
                }

                if (string.Equals(GetString(data, "windowState"), "maximized", StringComparison.Ordinal))
                    WindowState = WindowState.Maximized;

                _minimizeToTray = ToBool(data, "minimizeToTray", false);

                Logs.Shell.Write("INFO", "window state restored width=" + Width + " height=" + Height);
            }
            catch (Exception error)
            {
                Logs.Shell.Write("WARN", "window state restore failed: " + error.Message);
            }
        }

        private void SaveWindowState()
        {
            try
            {
                Rect bounds = WindowState == WindowState.Normal
                    ? new Rect(Left, Top, Width, Height)
                    : RestoreBounds;
                var data = new Dictionary<string, object>
                {
                    { "width", bounds.Width },
                    { "height", bounds.Height },
                    { "left", bounds.Left },
                    { "top", bounds.Top },
                    { "windowState", WindowState == WindowState.Maximized ? "maximized" : "normal" },
                    { "minimizeToTray", _minimizeToTray }
                };

                string json = new JavaScriptSerializer().Serialize(data);
                string temp = AppPaths.WindowStateFile + ".tmp";
                File.WriteAllText(temp, json, new UTF8Encoding(false));
                File.Copy(temp, AppPaths.WindowStateFile, true);
                File.Delete(temp);
            }
            catch (Exception error)
            {
                Logs.Shell.Write("WARN", "window state save failed: " + error.Message);
            }
        }

        private static bool IsOnScreen(double left, double top, double width, double height)
        {
            double screenLeft = SystemParameters.VirtualScreenLeft;
            double screenTop = SystemParameters.VirtualScreenTop;
            double screenRight = screenLeft + SystemParameters.VirtualScreenWidth;
            double screenBottom = screenTop + SystemParameters.VirtualScreenHeight;
            return left + width > screenLeft + 40
                && left < screenRight - 40
                && top + height > screenTop + 40
                && top < screenBottom - 40;
        }

        private static double ToDouble(Dictionary<string, object> data, string key, double fallback)
        {
            object value;
            if (!data.TryGetValue(key, out value) || value == null) return fallback;
            try { return Convert.ToDouble(value); } catch { return fallback; }
        }

        private static bool ToBool(Dictionary<string, object> data, string key, bool fallback)
        {
            object value;
            if (data == null || !data.TryGetValue(key, out value) || value == null) return fallback;
            if (value is bool) return (bool)value;
            try { return Convert.ToBoolean(value); } catch { return fallback; }
        }

        private static string GetString(Dictionary<string, object> data, string key)
        {
            if (data == null) return null;
            object value;
            if (!data.TryGetValue(key, out value)) return null;
            return value as string;
        }

        private void OnClosing(object sender, System.ComponentModel.CancelEventArgs e)
        {
            if (!_allowExit && _minimizeToTray)
            {
                e.Cancel = true;
                SaveWindowState();
                Hide();
                return;
            }

            RemoveTray();
            SaveWindowState();
            if (_schedule != null)
            {
                _schedule.Dispose();
                _schedule = null;
            }
            if (_kernel != null)
            {
                _kernel.Dispose();
                _kernel = null;
            }
        }
    }
}
