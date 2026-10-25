using System;
using System.IO;

namespace BackdropBuddy.Shell.Infrastructure
{
    internal static class AppPaths
    {
        public static string AppRoot { get; private set; }
        public static string NodeExe { get; private set; }
        public static string KernelMain { get; private set; }
        public static string UiRoot { get; private set; }
        public static string AssetsRoot { get; private set; }

        public static string DataRoot { get; private set; }
        public static string ThemesRoot { get; private set; }
        public static string ThemesBuiltin { get; private set; }
        public static string ThemesUser { get; private set; }
        public static string ThemesStaging { get; private set; }
        public static string BackupRoot { get; private set; }
        public static string LogsRoot { get; private set; }
        public static string CacheRoot { get; private set; }
        public static string PreviewRoot { get; private set; }
        public static string ExportsRoot { get; private set; }
        public static string WindowStateFile { get; private set; }
        public static string WebView2Data { get; private set; }

        public static bool KernelFound { get; private set; }

        public static void Resolve()
        {
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string root = baseDir;
            string dir = baseDir;

            for (int depth = 0; depth < 8 && !string.IsNullOrEmpty(dir); depth++)
            {
                string node = Path.Combine(dir, "runtime", "node", "node.exe");
                string kernel = Path.Combine(dir, "kernel", "main.mjs");
                if (File.Exists(node) && File.Exists(kernel))
                {
                    root = dir;
                    KernelFound = true;
                    break;
                }

                DirectoryInfo parent = Directory.GetParent(dir);
                dir = parent == null ? null : parent.FullName;
            }

            AppRoot = root;
            NodeExe = Path.Combine(root, "runtime", "node", "node.exe");
            KernelMain = Path.Combine(root, "kernel", "main.mjs");
            UiRoot = Path.Combine(root, "ui", "dist");
            AssetsRoot = Path.Combine(root, "assets");

            string configuredData = Environment.GetEnvironmentVariable("BACKDROPBUDDY_DATA_DIR");
            DataRoot = !string.IsNullOrWhiteSpace(configuredData)
                ? Path.GetFullPath(configuredData)
                : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BackdropBuddy");
            ThemesRoot = Path.Combine(DataRoot, "themes");
            ThemesBuiltin = Path.Combine(ThemesRoot, "builtin");
            ThemesUser = Path.Combine(ThemesRoot, "user");
            ThemesStaging = Path.Combine(ThemesRoot, "staging");
            BackupRoot = Path.Combine(DataRoot, "backup");
            LogsRoot = Path.Combine(DataRoot, "logs");
            CacheRoot = Path.Combine(DataRoot, "cache");
            PreviewRoot = Path.Combine(CacheRoot, "preview");
            ExportsRoot = Path.Combine(DataRoot, "exports");
            WindowStateFile = Path.Combine(DataRoot, "window.json");
            WebView2Data = Path.Combine(DataRoot, "WebView2");
        }

        public static void EnsureDirectories()
        {
            Directory.CreateDirectory(DataRoot);
            Directory.CreateDirectory(ThemesRoot);
            Directory.CreateDirectory(ThemesBuiltin);
            Directory.CreateDirectory(ThemesUser);
            Directory.CreateDirectory(ThemesStaging);
            Directory.CreateDirectory(BackupRoot);
            Directory.CreateDirectory(LogsRoot);
            Directory.CreateDirectory(CacheRoot);
            Directory.CreateDirectory(PreviewRoot);
            Directory.CreateDirectory(ExportsRoot);
            Directory.CreateDirectory(WebView2Data);
        }
    }
}
