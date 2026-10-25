using System;
using System.IO;
using System.Text;
using System.Threading;

namespace BackdropBuddy.Shell.Infrastructure
{
    internal sealed class LogFile
    {
        private static readonly Mutex CrossProcess = new Mutex(false, @"Local\BackdropBuddy.Log");

        private readonly object _gate = new object();
        private readonly string _path;
        private FileStream _stream;
        private StreamWriter _writer;

        public LogFile(string path)
        {
            _path = path;
        }

        public void Write(string level, string message)
        {
            lock (_gate)
            {
                bool owned = false;
                try
                {
                    try { owned = CrossProcess.WaitOne(2000); }
                    catch (AbandonedMutexException) { owned = true; }
                    catch { }

                    WriteLocked(level, message);
                }
                finally
                {
                    if (owned)
                    {
                        try { CrossProcess.ReleaseMutex(); } catch { }
                    }
                }
            }
        }

        private void WriteLocked(string level, string message)
        {
            try
            {
                if (_writer == null)
                {
                    Directory.CreateDirectory(Path.GetDirectoryName(_path));
                    _stream = new FileStream(_path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite);
                    _writer = new StreamWriter(_stream, new UTF8Encoding(false)) { AutoFlush = true };
                }

                // Append handles opened by two processes can hold a stale position; seek under the mutex.
                _stream.Seek(0, SeekOrigin.End);
                _writer.WriteLine(DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss.fff") + " [" + level + "] " + message);
            }
            catch
            {
                // Logging must never take the shell down.
            }
        }

        public void Dispose()
        {
            lock (_gate)
            {
                if (_writer == null) return;
                try { _writer.Dispose(); } catch { }
                try { _stream.Dispose(); } catch { }
                _writer = null;
                _stream = null;
            }
        }
    }

    internal static class Logs
    {
        public static LogFile Shell { get; private set; }
        public static LogFile Kernel { get; private set; }

        public static void Init(string logsRoot)
        {
            Shell = new LogFile(Path.Combine(logsRoot, "shell.log"));
            Kernel = new LogFile(Path.Combine(logsRoot, "kernel.log"));
        }

        public static void Shutdown()
        {
            if (Shell != null) Shell.Dispose();
            if (Kernel != null) Kernel.Dispose();
        }
    }
}
