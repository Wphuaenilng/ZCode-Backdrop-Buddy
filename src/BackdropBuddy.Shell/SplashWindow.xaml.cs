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
    public partial class SplashWindow : Window
    {
        private static readonly Brush Ink = Frozen(Color.FromRgb(0x1E, 0x20, 0x24));
        private static readonly Brush Ink2 = Frozen(Color.FromRgb(0x4D, 0x53, 0x5B));
        private static readonly FontFamily ZhFont = new FontFamily("Microsoft YaHei");
        private static readonly FontFamily UiFont = new FontFamily("Segoe UI, Microsoft YaHei");

        private readonly Stopwatch _shown = new Stopwatch();
        private Storyboard _intro;
        private bool _attached;
        private bool _closed;
        private bool _aborted;
        private bool _ready;
        private bool _reduced;
        private bool _waiting;
        private bool _finalizing;
        private bool _skipping;

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

        public void NotifyReady()
        {
            if (_closed || _aborted) return;
            _ready = true;
            Logs.Shell.Write("INFO", "splash ready");

            if (_reduced)
            {
                ExitReduced();
                return;
            }
            if (_waiting && !_finalizing) _ = ReadyThenHandoffAsync();
        }

        public void SkipNow()
        {
            RequestSkip();
        }

        public void Abort()
        {
            if (_closed) return;
            _aborted = true;
            Logs.Shell.Write("INFO", "splash aborted");
            LightOut.Fill = new SolidColorBrush(Color.FromRgb(0x0F, 0x11, 0x15));
            LightOut.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(160))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            CloseAfter(190);
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

            if (_reduced)
            {
                ShowReduced();
                return;
            }

            _intro = (Storyboard)FindResource("IntroStoryboard");
            _intro.Begin(this, true);
            Logs.Shell.Write("INFO", "splash shown");
            _ = RunSequenceAsync();
        }

        private async Task RunSequenceAsync()
        {
            try
            {
                await Delay(1250);
                if (Stop()) return;

                ShowStatusTyped("正在启动本地主题引擎", "STARTING LOCAL THEME ENGINE");
                SetProgress(0.45);

                await Delay(650);
                if (Stop()) return;

                if (_ready) await ReadyThenHandoffAsync();
                else await ShowWaitingAsync();
            }
            catch (Exception error)
            {
                Logs.Shell.Write("ERROR", "splash sequence failed: " + error);
                Abort();
            }
        }

        private async Task ReadyThenHandoffAsync()
        {
            if (_finalizing || _closed || _aborted) return;
            _finalizing = true;
            Logs.Shell.Write("INFO", "splash ready state");

            await SwapStatusAsync("准备就绪", "READY");
            SetProgress(1.0);

            await Delay(320);
            if (Stop()) return;
            Handoff();
        }

        private async Task ShowWaitingAsync()
        {
            if (_closed || _aborted || _finalizing) return;
            Logs.Shell.Write("INFO", "splash waiting for renderer");
            await SwapStatusAsync("等待界面就绪", "WAITING FOR RENDERER");
            SetProgress(0.82);
            _waiting = true;
            if (_ready && !_finalizing) _ = ReadyThenHandoffAsync();
        }

        private void ShowStatusTyped(string zh, string en)
        {
            StatusBlock.Opacity = 1;
            FillSpaced(StatusZh, zh, 22, Ink, 3.5, ZhFont, FontWeights.Normal, 22, 220, true);
            FillSpaced(StatusEn, en, 11, Ink2, 2.6, UiFont, FontWeights.Normal, 4, 140, true);
        }

        private async Task SwapStatusAsync(string zh, string en)
        {
            StatusBlock.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, TimeSpan.FromMilliseconds(120))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            await Delay(130);
            if (Stop()) return;

            FillSpaced(StatusZh, zh, 22, Ink, 3.5, ZhFont, FontWeights.Normal, 0, 1, false);
            FillSpaced(StatusEn, en, 11, Ink2, 2.6, UiFont, FontWeights.Normal, 0, 1, false);
            StatusBlock.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(220))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            await Delay(230);
        }

        private void SetProgress(double value)
        {
            ProgressScale.BeginAnimation(ScaleTransform.ScaleXProperty,
                new DoubleAnimation(value, TimeSpan.FromMilliseconds(650))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseInOut }
                });
        }

        private async void Handoff()
        {
            if (_closed || _aborted) return;
            TryActivateOwner();
            Logs.Shell.Write("INFO", "splash handoff");

            ContentHost.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(1, 0, TimeSpan.FromMilliseconds(340))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseInOut }
                });
            LightOut.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(380))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseInOut }
                });

            await Delay(430);
            if (!_closed) Close();
        }

        private void ShowReduced()
        {
            ContentHost.Opacity = 1;
            MarkGlow.Opacity = 0.5;
            AppIcon.Opacity = 1;
            IconScale.ScaleX = 1;
            IconScale.ScaleY = 1;
            Reticle.Opacity = 0.55;
            RetRotate.Angle = 0;
            WordSub.Opacity = 1;
            WordSubShift.Y = 0;
            StatusBlock.Opacity = 1;
            FillSpaced(StatusZh, "正在启动本地主题引擎", 22, Ink, 3.5, ZhFont, FontWeights.Normal, 0, 1, false);
            FillSpaced(StatusEn, "STARTING LOCAL THEME ENGINE", 11, Ink2, 2.6, UiFont, FontWeights.Normal, 0, 1, false);
            ProgressScale.ScaleX = 0.5;

            Logs.Shell.Write("INFO", "splash shown reducedMotion=true");
        }

        private async void ExitReduced()
        {
            if (_closed || _aborted) return;
            int wait = Math.Max(0, 500 - (int)_shown.ElapsedMilliseconds);
            if (wait > 0) await Delay(wait);
            if (_closed || _aborted) return;

            FillSpaced(StatusZh, "准备就绪", 22, Ink, 3.5, ZhFont, FontWeights.Normal, 0, 1, false);
            FillSpaced(StatusEn, "READY", 11, Ink2, 2.6, UiFont, FontWeights.Normal, 0, 1, false);
            ProgressScale.ScaleX = 1;
            Logs.Shell.Write("INFO", "splash handoff reduced");

            LightOut.BeginAnimation(UIElement.OpacityProperty,
                new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(140))
                {
                    EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                });
            await Delay(170);
            if (!_closed) Close();
        }

        private void RequestSkip()
        {
            if (_closed || _aborted || _skipping) return;
            if (_shown.ElapsedMilliseconds < 600) return;
            _skipping = true;
            Logs.Shell.Write("INFO", "splash skipped");
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
            double reticle = Math.Max(360, Math.Min(width * 0.48, height * 0.78));
            IconStage.Width = reticle;
            IconStage.Height = reticle;
        }

        private bool Stop()
        {
            return _closed || _aborted;
        }

        private static Task Delay(int milliseconds)
        {
            return Task.Delay(milliseconds);
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

        private static void FillSpaced(StackPanel host, string text, double size, Brush brush, double spacing,
            FontFamily family, FontWeight weight, int staggerMs, int fadeMs, bool animate)
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
                    FontWeight = weight,
                    Foreground = brush,
                    VerticalAlignment = VerticalAlignment.Center,
                    Margin = new Thickness(0, 0, i == text.Length - 1 ? 0 : spacing, 0)
                };
                TextOptions.SetTextRenderingMode(tb, TextRenderingMode.ClearType);
                TextOptions.SetTextFormattingMode(tb,
                    size < 14 ? TextFormattingMode.Display : TextFormattingMode.Ideal);
                host.Children.Add(tb);

                if (!animate)
                {
                    tb.Opacity = 1;
                    continue;
                }

                tb.Opacity = 0;
                var shift = new TranslateTransform(0, size * 0.12);
                tb.RenderTransform = shift;
                TimeSpan begin = TimeSpan.FromMilliseconds(i * staggerMs);
                tb.BeginAnimation(UIElement.OpacityProperty,
                    new DoubleAnimation(0, 1, TimeSpan.FromMilliseconds(fadeMs))
                    {
                        BeginTime = begin,
                        EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                    });
                shift.BeginAnimation(TranslateTransform.YProperty,
                    new DoubleAnimation(size * 0.12, 0, TimeSpan.FromMilliseconds(fadeMs))
                    {
                        BeginTime = begin,
                        EasingFunction = new CubicEase { EasingMode = EasingMode.EaseOut }
                    });
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
