using System;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Interop;

namespace BackdropBuddy.Shell.Infrastructure
{
    // Win11 对 WindowChrome 自绘边框的窗口默认不给圆角，需要显式向 DWM 申请。
    // 旧系统没有该属性时调用失败即保持方角，不当作错误。
    public static class Win11Corners
    {
        private const int DWMWA_WINDOW_CORNER_PREFERENCE = 33;
        private const int DWMWCP_ROUND = 2;

        public static void Apply(Window window)
        {
            if (window == null) return;
            try
            {
                var source = new WindowInteropHelper(window);
                if (source.Handle == IntPtr.Zero) return;
                int preference = DWMWCP_ROUND;
                DwmSetWindowAttribute(source.Handle, DWMWA_WINDOW_CORNER_PREFERENCE, ref preference, sizeof(int));
            }
            catch (Exception error)
            {
                Logs.Shell.Write("INFO", "round corners skipped: " + error.Message);
            }
        }

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
    }
}
