using System;
using System.Diagnostics;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Threading;
using BackdropBuddy.Shell.Infrastructure;

namespace BackdropBuddy.Shell
{
    /// <summary>
    /// 事件驱动的启动窗：壳在五个真实里程碑上推进度（内核进程 → 内核 hello → WebView2 →
    /// 页面导航 → UI 就绪），动画不决定时长；交接条件是 UI 就绪且已展示 MinShownMs。
    /// 同一里程碑停留超过 PhaseStallMs 才切"等待"文案；ui.ready 信号超时则回退到导航完成即交接。
    /// </summary>
    public partial class SplashWindow : Window
    {
        public const int PhaseKernel = 1;      // 内核进程已拉起
        public const int PhaseHello = 2;       // 内核 hello 应答（含 ZCode 发现，主题库可用）
        public const int PhaseWebview = 3;     // WebView2 环境就绪
        public const int PhaseNavigated = 4;   // 页面导航完成
        public const int PhaseUiReady = 5;     // UI 真正可交互（React 完成首屏数据）

        private const int MinShownMs = 700;             // 最短展示：再快也让人看清品牌帧
        private const int HandoffFadeMs = 180;          // 交接淡出
        private const int PhaseStallMs = 1500;          // 里程碑停留多久后切等待文案
        private const int UiReadyFallbackMs = 6000;     // ui.ready 迟到多久后按导航完成交接

        private static readonly string[] PhaseZh =
            { null, "正在启动内核", "正在准备主题库", "正在启动界面", "正在渲染界面", "准备就绪" };
        private static readonly string[] PhaseEn =
            { null, "STARTING KERNEL", "PREPARING THEMES", "LOADING INTERFACE", "RENDERING INTERFACE", "READY" };

        private static readonly Brush Ink = Frozen(Color.FromRgb(0x4B, 0x54, 0x5F));
        private static readonly Brush Ink2 = Frozen(Color.FromRgb(0x7D, 0x89, 0x95));
        private static readonly FontFamily ZhFont = new FontFamily("Microsoft YaHei");
        private static readonly FontFamily MonoFont = new FontFamily("Consolas");

        private readonly Stopwatch _shown = new Stopwatch();
        private readonly Stopwatch _phaseSince = new Stopwatch();
        private DispatcherTimer _stallTimer;
        private bool _attached;
        private bool _closed;
        private bool _aborted;
        private bool _reduced;
        private bool _finalizing;
        private bool _skipping;
        private bool _stalled;
        private int _phase;

        public SplashWindow()
        {
            InitializeComponent();
            Loaded += OnLoaded;
            Closed += OnClosed;
            SizeChanged += (sender, args) => ApplyLayout();
            PreviewKeyDown += OnPreviewKeyDown;
            MouseLeftButtonDown += OnWindowMouseDown;
            Skip.MouseLeftButtonDown += OnSkipMouseDown;
        }

        public void AttachTo(Window owner)
        {
            if (owner == null || _attached || _closed) return;

            try
            {
                _attached = true;
                Owner = owner;
                Topmost = false;
                WindowStartupLocation = WindowStartupLocation.Manual;
                FollowOwner(owner);
                owner.LocationChanged += OnOwnerBoundsChanged;
                owner.SizeChanged += OnOwnerBoundsChanged;
                owner.StateChanged += OnOwnerBoundsChanged;
                Logs.Shell.Write("INFO", "splash attached to owner window");
            }
            catch (Exception error)
            {
                Logs.Shell.Write("WARN", "splash attach failed: " + error.Message);
            }
        }

        /// <summary>里程碑推进（1–5）。可以任意线程调用；只前进不后退。</summary>
        public void NotifyPhase(int phase)
        {
            Run(() =>
            {
                if (_closed || _aborted || _finalizing) return;
                if (phase < PhaseKernel || phase > PhaseUiReady || phase <= _phase) return;
                _phase = phase;
                _phaseSince.Restart();
                ClearStall();
                ApplyPhase(phase);
                Logs.Shell.Write("INFO", "splash phase " + phase);
            });
        }

        /// <summary>UI 真正可用（React 完成首屏数据）。满足最短展示后立即交接。</summary>
        public void NotifyUiReady()
        {
            Run(() =>
            {
                if (_closed || _aborted || _finalizing) return;
                NotifyPhase(PhaseUiReady);
                if (_reduced)
                {
                    ExitReduced();
                    return;
                }
                int wait = (int)(MinShownMs - _shown.ElapsedMilliseconds);
                if (wait <= 0) BeginHandoff();
                else _ = HandoffAfterAsync(wait);
            });
        }

        public void SkipNow()
        {
            Run(RequestSkip);
        }

        public void Abort()
        {
            Run(AbortNow);
        }

        private void Run(Action action)
        {
            if (Dispatcher.CheckAccess()) action();
            else Dispatcher.BeginInvoke(action);
        }

        private void OnOwnerBoundsChanged(object sender, EventArgs e)
        {
            Window owner = Owner;
            if (owner != null) FollowOwner(owner);
        }

        private void FollowOwner(Window owner)
        {
            if (!_attached || _closed) return;
            Left = owner.Left;
            Top = owner.Top;
            Width = Math.Max(1, owner.ActualWidth);
            Height = Math.Max(1, owner.ActualHeight);
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            _shown.Start();
            ApplyLayout();

            _reduced = !SystemParameters.ClientAreaAnimation ||
                string.Equals(Environment.GetEnvironmentVariable("BACKDROPBUDDY_REDUCED_MOTION"), "1", StringComparison.Ordinal);

            _phase = PhaseKernel;
            _phaseSince.Start();

            if (_reduced)
            {
                ApplyPhase(PhaseKernel);
                Logs.Shell.Write("INFO", "splash shown reducedMotion=true");
                return;
            }

            StartBrandMotion();
            ApplyPhase(PhaseKernel);
            StartStallTimer();
            Logs.Shell.Write("INFO", "splash shown");
        }

        private void StartBrandMotion()
        {
            var easeOut = new CubicEase { EasingMode = EasingMode.EaseOut };
            var easeInOut = new CubicEase { EasingMode = EasingMode.EaseInOut };

            MarkRoot.Opacity = 0;
            MarkRoot.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(480))
                {
                    EasingFunction = easeOut
                });

            IconScale.ScaleX = 0.94;
            IconScale.ScaleY = 0.94;
            IconScale.BeginAnimation(ScaleTransform.ScaleXProperty,
                new DoubleAnimation(0.94, 1, TimeSpan.FromMilliseconds(600))
                {
                    EasingFunction = easeOut
                });
            IconScale.BeginAnimation(ScaleTransform.ScaleYProperty,
                new DoubleAnimation(0.94, 1, TimeSpan.FromMilliseconds(600))
                {
                    EasingFunction = easeOut
                });

            BrandCopy.Opacity = 0;
            BrandCopyShift.Y = 6;
            BrandCopy.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(460))
                {
                    BeginTime = TimeSpan.FromMilliseconds(100),
                    EasingFunction = easeOut
                });
            BrandCopyShift.BeginAnimation(TranslateTransform.YProperty,
                new DoubleAnimation(6, 0, TimeSpan.FromMilliseconds(500))
                {
                    BeginTime = TimeSpan.FromMilliseconds(100),
                    EasingFunction = easeOut
                });

            OrbitArtwork.Opacity = 0;
            OrbitScale.ScaleX = 0.96;
            OrbitScale.ScaleY = 0.96;
            OrbitArtwork.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(520))
                {
                    BeginTime = TimeSpan.FromMilliseconds(60),
                    EasingFunction = easeOut
                });
            OrbitScale.BeginAnimation(ScaleTransform.ScaleXProperty,
                new DoubleAnimation(0.96, 1, TimeSpan.FromMilliseconds(640))
                {
                    BeginTime = TimeSpan.FromMilliseconds(60),
                    EasingFunction = easeOut
                });
            OrbitScale.BeginAnimation(ScaleTransform.ScaleYProperty,
                new DoubleAnimation(0.96, 1, TimeSpan.FromMilliseconds(640))
                {
                    BeginTime = TimeSpan.FromMilliseconds(60),
                    EasingFunction = easeOut
                });

            AnimateCardEntrance(LightCard, LightCardEntrance, 8, 140);
            AnimateCardEntrance(DarkCard, DarkCardEntrance, -8, 220);

            LightCardFloat.BeginAnimation(TranslateTransform.YProperty,
                new DoubleAnimation(0, -2.5, TimeSpan.FromMilliseconds(3200))
                {
                    BeginTime = TimeSpan.FromMilliseconds(700),
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = easeInOut
                });
            DarkCardFloat.BeginAnimation(TranslateTransform.YProperty,
                new DoubleAnimation(0, 2.5, TimeSpan.FromMilliseconds(3700))
                {
                    BeginTime = TimeSpan.FromMilliseconds(850),
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = easeInOut
                });

            MarkGlow.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0.55, 0.85, TimeSpan.FromMilliseconds(3000))
                {
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = easeInOut
                });
            BlueArc.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0.58, 1, TimeSpan.FromMilliseconds(3600))
                {
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = easeInOut
                });
            LightArc.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0.48, 0.85, TimeSpan.FromMilliseconds(3800))
                {
                    BeginTime = TimeSpan.FromMilliseconds(400),
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = easeInOut
                });
            GoldArc.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0.55, 0.9, TimeSpan.FromMilliseconds(4200))
                {
                    BeginTime = TimeSpan.FromMilliseconds(900),
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = easeInOut
                });

            StartOrbitDot(BlueDotTranslate, 38, 11.5, true);
            StartOrbitDot(GoldDotTranslate, 229, 16, false);

            StatusDot.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0.35, 1, TimeSpan.FromMilliseconds(1100))
                {
                    AutoReverse = true,
                    RepeatBehavior = RepeatBehavior.Forever,
                    EasingFunction = easeInOut
                });
        }

        private static void AnimateCardEntrance(UIElement card, TranslateTransform shift,
            double fromY, int delayMs)
        {
            var ease = new CubicEase { EasingMode = EasingMode.EaseOut };
            card.Opacity = 0;
            shift.Y = fromY;
            card.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(460))
                {
                    BeginTime = TimeSpan.FromMilliseconds(delayMs),
                    EasingFunction = ease
                });
            shift.BeginAnimation(TranslateTransform.YProperty,
                new DoubleAnimation(fromY, 0, TimeSpan.FromMilliseconds(540))
                {
                    BeginTime = TimeSpan.FromMilliseconds(delayMs),
                    EasingFunction = ease
                });
        }

        private static void StartOrbitDot(TranslateTransform dot, double startAngle,
            double seconds, bool clockwise)
        {
            var path = BuildOrbitPath(startAngle, clockwise);
            dot.BeginAnimation(TranslateTransform.XProperty,
                new DoubleAnimationUsingPath
                {
                    PathGeometry = path,
                    Source = PathAnimationSource.X,
                    Duration = new Duration(TimeSpan.FromSeconds(seconds)),
                    RepeatBehavior = RepeatBehavior.Forever
                });
            dot.BeginAnimation(TranslateTransform.YProperty,
                new DoubleAnimationUsingPath
                {
                    PathGeometry = path,
                    Source = PathAnimationSource.Y,
                    Duration = new Duration(TimeSpan.FromSeconds(seconds)),
                    RepeatBehavior = RepeatBehavior.Forever
                });
        }

        private static PathGeometry BuildOrbitPath(double startAngle, bool clockwise)
        {
            var figure = new PathFigure { StartPoint = OrbitPoint(startAngle) };
            double step = clockwise ? 90 : -90;
            for (int index = 1; index <= 4; index++)
            {
                figure.Segments.Add(new ArcSegment
                {
                    Point = OrbitPoint(startAngle + step * index),
                    Size = new Size(232, 123),
                    RotationAngle = -11,
                    IsLargeArc = false,
                    SweepDirection = clockwise ? SweepDirection.Clockwise : SweepDirection.Counterclockwise,
                    IsStroked = true
                });
            }

            var path = new PathGeometry();
            path.Figures.Add(figure);
            path.Freeze();
            return path;
        }

        private static Point OrbitPoint(double angle)
        {
            double theta = angle * Math.PI / 180;
            double tilt = -11 * Math.PI / 180;
            double x = 232 * Math.Cos(theta);
            double y = 123 * Math.Sin(theta);
            return new Point(
                320 + x * Math.Cos(tilt) - y * Math.Sin(tilt),
                203 + x * Math.Sin(tilt) + y * Math.Cos(tilt));
        }

        private void ApplyPhase(int phase)
        {
            FillStatus(PhaseZh[phase], PhaseEn[phase]);

            if (_reduced)
            {
                StatusDot.Opacity = 1;
                ProgressScale.ScaleX = phase >= PhaseUiReady ? 1.0 : 0.2 * phase;
                return;
            }

            if (phase >= PhaseUiReady)
            {
                StatusDot.BeginAnimation(UIElement.OpacityProperty, null);
                StatusDot.Opacity = 1;
            }

            StatusBlock.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0.25, 1, TimeSpan.FromMilliseconds(170))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            StatusShift.BeginAnimation(TranslateTransform.YProperty,
                new DoubleAnimation(3, 0, TimeSpan.FromMilliseconds(190))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });

            double target = phase >= PhaseUiReady ? 1.0 : 0.2 * phase;
            ProgressScale.BeginAnimation(ScaleTransform.ScaleXProperty,
                new DoubleAnimation(Math.Max(0.04, target),
                    TimeSpan.FromMilliseconds(phase >= PhaseUiReady ? 140 : 260))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
        }

        private void StartStallTimer()
        {
            _stallTimer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(250) };
            _stallTimer.Tick += (sender, args) =>
            {
                if (_closed || _aborted || _finalizing || _reduced) return;

                // ui.ready 迟到（旧界面/信号丢失）：按导航完成即交接，不让启动窗卡死
                if (_phase >= PhaseNavigated && _phaseSince.ElapsedMilliseconds >= UiReadyFallbackMs)
                {
                    Logs.Shell.Write("WARN", "splash ui-ready timeout, handing off at navigation");
                    NotifyUiReady();
                    return;
                }

                if (_stalled || _phaseSince.ElapsedMilliseconds <= PhaseStallMs) return;
                _stalled = true;
                FillStatus("仍在准备，请稍候", "STILL WORKING");
                StatusShift.BeginAnimation(TranslateTransform.YProperty,
                    new DoubleAnimation(2, 0, TimeSpan.FromMilliseconds(180))
                    {
                        EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                    });
                Logs.Shell.Write("INFO", "splash waiting in phase " + _phase);
            };
            _stallTimer.Start();
        }

        private void ClearStall()
        {
            _stalled = false;
            StatusBlock.BeginAnimation(UIElement.OpacityProperty, null);
            StatusBlock.Opacity = 1;
        }

        private async Task HandoffAfterAsync(int waitMs)
        {
            await Task.Delay(waitMs);
            if (_closed || _aborted || _finalizing) return;
            BeginHandoff();
        }

        private void BeginHandoff()
        {
            if (_finalizing || _closed || _aborted) return;
            _finalizing = true;
            StopStallTimer();
            TryActivateOwner();
            Logs.Shell.Write("INFO", "splash handoff elapsedMs=" + (int)_shown.ElapsedMilliseconds);

            ContentHost.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(HandoffFadeMs))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            LightOut.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(HandoffFadeMs + 40))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            CloseAfter(HandoffFadeMs + 60);
        }

        private void AbortNow()
        {
            if (_closed) return;
            _aborted = true;
            StopStallTimer();
            Logs.Shell.Write("INFO", "splash aborted");
            LightOut.Fill = new SolidColorBrush(Color.FromRgb(0x0F, 0x11, 0x15));
            LightOut.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(160))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            CloseAfter(190);
        }

        private async void ExitReduced()
        {
            if (_closed || _aborted) return;
            int wait = Math.Max(0, MinShownMs - (int)_shown.ElapsedMilliseconds);
            if (wait > 0) await Task.Delay(wait);
            if (_closed || _aborted) return;

            FillStatus(PhaseZh[PhaseUiReady], PhaseEn[PhaseUiReady]);
            ProgressScale.ScaleX = 1;
            Logs.Shell.Write("INFO", "splash handoff reduced elapsedMs=" + (int)_shown.ElapsedMilliseconds);

            LightOut.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(140))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            await Task.Delay(170);
            if (!_closed) Close();
        }

        private void RequestSkip()
        {
            if (_closed || _aborted || _skipping) return;
            if (_shown.ElapsedMilliseconds < 600) return;
            _skipping = true;
            StopStallTimer();
            Logs.Shell.Write("INFO", "splash skipped elapsedMs=" + (int)_shown.ElapsedMilliseconds);
            TryActivateOwner();

            ContentHost.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(ContentHost.Opacity, 0, TimeSpan.FromMilliseconds(220))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            LightOut.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(260))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            CloseAfter(300);
        }

        private void ApplyLayout()
        {
            double width = Math.Max(1, ActualWidth);
            double height = Math.Max(1, ActualHeight);
            // 视觉稿以 640 × 400 为基准；大窗口只温和放大，小窗口等比收缩。
            double scale = Math.Min(1.5, Math.Max(0.78, Math.Min(width / 640.0, height / 400.0)));
            ResponsiveScale.ScaleX = scale;
            ResponsiveScale.ScaleY = scale;
        }

        private void StopStallTimer()
        {
            if (_stallTimer != null)
            {
                _stallTimer.Stop();
                _stallTimer = null;
            }
        }

        private void TryActivateOwner()
        {
            try
            {
                Window owner = Owner;
                if (owner != null) owner.Activate();
            }
            catch
            {
                // best effort
            }
        }

        private void CloseAfter(int milliseconds)
        {
            var timer = new DispatcherTimer { Interval = TimeSpan.FromMilliseconds(milliseconds) };
            timer.Tick += (sender, args) =>
            {
                timer.Stop();
                if (!_closed) Close();
            };
            timer.Start();
        }

        private void FillStatus(string zh, string en)
        {
            StatusBlock.Opacity = 1;
            FillSpaced(StatusZh, zh, 11.2, Ink, 0.5, ZhFont);
            FillSpaced(StatusEn, en, 7.3, Ink2, 0.9, MonoFont);
        }

        private static void FillSpaced(StackPanel host, string text, double size, Brush brush, double spacing,
            FontFamily family)
        {
            host.Children.Clear();
            if (string.IsNullOrEmpty(text)) return;

            for (int i = 0; i < text.Length; i++)
            {
                var tb = new TextBlock
                {
                    Text = text[i] == ' ' ? "\u00A0" : text[i].ToString(),
                    FontSize = size,
                    FontFamily = family,
                    FontWeight = FontWeights.Normal,
                    Foreground = brush,
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(0, 0, i == text.Length - 1 ? 0 : spacing, 0)
                };
                TextOptions.SetTextRenderingMode(tb, TextRenderingMode.ClearType);
                TextOptions.SetTextFormattingMode(tb,
                    size < 14 ? TextFormattingMode.Display : TextFormattingMode.Ideal);
                host.Children.Add(tb);
            }
        }

        private void OnPreviewKeyDown(object sender, KeyEventArgs e)
        {
            if (e.Key == Key.Escape)
            {
                e.Handled = true;
                RequestSkip();
            }
        }

        private void OnWindowMouseDown(object sender, MouseButtonEventArgs e)
        {
            if (_shown.ElapsedMilliseconds < 600) return;
            RequestSkip();
        }

        private void OnSkipMouseDown(object sender, MouseButtonEventArgs e)
        {
            e.Handled = true;
            RequestSkip();
        }

        private void OnClosed(object sender, EventArgs e)
        {
            _closed = true;
            StopStallTimer();
            if (_attached)
            {
                Window owner = Owner;
                if (owner != null)
                {
                    owner.LocationChanged -= OnOwnerBoundsChanged;
                    owner.SizeChanged -= OnOwnerBoundsChanged;
                    owner.StateChanged -= OnOwnerBoundsChanged;
                }
            }
            Logs.Shell.Write("INFO", "splash closed elapsedMs=" +
                (int)(_shown.IsRunning ? _shown.Elapsed.TotalMilliseconds : 0));
        }

        private static Brush Frozen(Color color)
        {
            var brush = new SolidColorBrush(color);
            brush.Freeze();
            return brush;
        }
    }
}
