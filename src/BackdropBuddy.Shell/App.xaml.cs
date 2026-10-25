using System;
using System.Windows;
using System.Windows.Threading;
using BackdropBuddy.Shell.Infrastructure;

namespace BackdropBuddy.Shell
{
    public partial class App : Application
    {
        private SingleInstance _instance;

        protected override void OnStartup(StartupEventArgs e)
        {
            base.OnStartup(e);

            AppPaths.Resolve();
            AppPaths.EnsureDirectories();
            Logs.Init(AppPaths.LogsRoot);
            Logs.Shell.Write("INFO", "shell starting root=" + AppPaths.AppRoot + " kernelFound=" + AppPaths.KernelFound);

            DispatcherUnhandledException += OnDispatcherUnhandledException;
            AppDomain.CurrentDomain.UnhandledException += OnDomainUnhandledException;

            string pipeName = SingleInstance.PipeNameFor(AppPaths.AppRoot);
            _instance = SingleInstance.TryCreate(pipeName, ActivateExistingWindow);

            if (_instance == null)
            {
                bool signalled = SingleInstance.Signal(pipeName);
                Logs.Shell.Write("INFO", signalled
                    ? "second instance handed off to the running window"
                    : "second instance could not reach the running window");
                Shutdown(signalled ? 0 : 1);
                return;
            }

            SplashWindow splash = null;
            try
            {
                splash = new SplashWindow();
            }
            catch (Exception error)
            {
                Logs.Shell.Write("WARN", "splash window failed: " + error.Message);
                splash = null;
            }

            MainWindow window;
            try
            {
                window = new MainWindow(splash);
                MainWindow = window;
                window.Show();
            }
            catch
            {
                if (splash != null)
                {
                    try { splash.Close(); } catch { /* best effort */ }
                }
                throw;
            }

            if (splash != null)
            {
                try
                {
                    splash.AttachTo(window);
                    splash.Show();
                }
                catch (Exception error)
                {
                    Logs.Shell.Write("WARN", "splash show failed: " + error.Message);
                    try { splash.Close(); } catch { /* best effort */ }
                }
            }
        }

        private void ActivateExistingWindow()
        {
            Dispatcher.BeginInvoke(new Action(() =>
            {
                var window = MainWindow as MainWindow;
                if (window != null) window.ActivateFromSecondInstance();
            }));
        }

        protected override void OnExit(ExitEventArgs e)
        {
            if (_instance != null)
            {
                _instance.Dispose();
                _instance = null;
            }

            Logs.Shell.Write("INFO", "shell exited code=" + e.ApplicationExitCode);
            Logs.Shutdown();
            base.OnExit(e);
        }

        private static void OnDispatcherUnhandledException(object sender, DispatcherUnhandledExceptionEventArgs e)
        {
            Logs.Shell.Write("ERROR", "unhandled UI exception: " + e.Exception);
            MessageBox.Show(
                "BackdropBuddy 遇到错误：" + e.Exception.Message,
                "BackdropBuddy",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            e.Handled = true;
        }

        private static void OnDomainUnhandledException(object sender, UnhandledExceptionEventArgs e)
        {
            Logs.Shell.Write("ERROR", "unhandled domain exception: " + e.ExceptionObject);
        }
    }
}
