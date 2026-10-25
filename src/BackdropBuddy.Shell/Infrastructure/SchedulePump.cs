using System;
using System.Collections.Generic;
using System.Globalization;
using System.Threading;
using Microsoft.Win32;

namespace BackdropBuddy.Shell.Infrastructure
{
    // 调度触发泵。内核只负责算「下次什么时候该看一眼」，这里据此装配一枚一次性定时器，
    // 到点发 schedule.tick 并拿回新的 wakeAt 再装配下一次；Windows 明暗偏好变化时也补一次。
    // 没有任何常驻轮询线程；规则清空后退化成一次很便宜的自检。
    internal sealed class SchedulePump : IDisposable
    {
        private static readonly TimeSpan IdleRecheck = TimeSpan.FromMinutes(5);
        private static readonly TimeSpan MinDelay = TimeSpan.FromSeconds(5);
        private static readonly TimeSpan MaxDelay = TimeSpan.FromHours(25);

        private readonly ProtocolBridge _bridge;
        private readonly object _gate = new object();
        private Timer _timer;
        private DateTime _lastPreference = DateTime.MinValue;
        private bool _disposed;

        public SchedulePump(ProtocolBridge bridge)
        {
            _bridge = bridge;
        }

        public void Start()
        {
            if (_disposed || _bridge == null) return;
            SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
            // 内核启动时自己已经评估过一轮；这里等握手落地后再要一次 wakeAt
            Arm(TimeSpan.FromSeconds(3));
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;
            SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
            Arm(null);
        }

        // 内核播报规则增删改：稍等片刻再要一次 wakeAt，让保存先落库
        public void MarkChanged()
        {
            if (_disposed) return;
            Arm(TimeSpan.FromMilliseconds(400));
        }

        private void OnUserPreferenceChanged(object sender, UserPreferenceChangedEventArgs e)
        {
            // 明暗偏好走 Personalize 注册表树，但 Windows 用哪个 category 报它并不稳定，
            // 所以任何偏好变更都读一次：代价是一趟注册表 + 一次内核调用，
            // 值没变时内核只会安静地更新观测记录，不会重复换主题。
            var now = DateTime.UtcNow;
            lock (_gate)
            {
                if ((now - _lastPreference).TotalMilliseconds < 700) return;
                _lastPreference = now;
            }

            Tick("preference");
        }

        private void Tick(string reason)
        {
            if (_disposed || _bridge == null) return;

            var parameters = new Dictionary<string, object> { { "reason", reason } };
            var dark = ReadSystemDark();
            if (dark.HasValue) parameters["systemDark"] = dark.Value;

            try
            {
                _bridge.Request("schedule.tick", parameters, OnTick, 20000);
            }
            catch (Exception error)
            {
                Logs.Shell.Write("WARN", "schedule tick failed: " + error.Message);
            }
        }

        private void OnTick(Dictionary<string, object> response)
        {
            if (_disposed) return;

            object ok;
            if (response == null || !response.TryGetValue("ok", out ok) || !(ok is bool) || !(bool)ok)
            {
                // 内核忙或未就绪：按空闲间隔重试，别把定时器丢掉
                Arm(IdleRecheck);
                return;
            }

            object dataBoxed;
            var data = response.TryGetValue("data", out dataBoxed) ? dataBoxed as Dictionary<string, object> : null;
            if (data == null)
            {
                Arm(IdleRecheck);
                return;
            }

            object wakeBoxed;
            var wakeAt = data.TryGetValue("wakeAt", out wakeBoxed) ? wakeBoxed as string : null;
            if (string.IsNullOrEmpty(wakeAt))
            {
                // 没有时刻型规则：留着一次便宜的自检，好接住用户刚保存的新规则
                Arm(IdleRecheck);
                return;
            }

            DateTime when;
            if (!DateTime.TryParse(wakeAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out when))
            {
                Arm(IdleRecheck);
                return;
            }

            var delay = when.ToUniversalTime() - DateTime.UtcNow;
            if (delay < MinDelay) delay = MinDelay;
            if (delay > MaxDelay) delay = MaxDelay;

            object firedBoxed;
            var fired = data.TryGetValue("fired", out firedBoxed) ? firedBoxed as System.Collections.IEnumerable : null;
            if (fired != null)
            {
                var count = 0;
                foreach (var entry in fired) count++;
                if (count > 0) Logs.Shell.Write("INFO", "schedule fired " + count + " rule(s), wakeAt=" + wakeAt);
            }

            Arm(delay);
        }

        private void Arm(TimeSpan? delay)
        {
            lock (_gate)
            {
                if (_timer != null)
                {
                    _timer.Dispose();
                    _timer = null;
                }
                if (delay == null || _disposed) return;
                _timer = new Timer(_ => Tick("timer"), null, delay.Value, Timeout.InfiniteTimeSpan);
            }
        }

        private static bool? ReadSystemDark()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(
                    @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize"))
                {
                    if (key == null) return null;
                    var value = key.GetValue("AppsUseLightTheme");
                    if (value == null) return null;
                    return Convert.ToInt32(value, CultureInfo.InvariantCulture) == 0;
                }
            }
            catch (Exception error)
            {
                Logs.Shell.Write("WARN", "system color mode read failed: " + error.Message);
                return null;
            }
        }
    }
}
