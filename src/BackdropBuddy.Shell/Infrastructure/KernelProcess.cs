using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace BackdropBuddy.Shell.Infrastructure
{
    internal sealed class KernelProcess : IDisposable
    {
        private const string ProtocolVersion = "dreamskin.manager/1";
        private const int MaxLineBytes = 1024 * 1024;

        private readonly string _nodeExe;
        private readonly string _kernelMain;
        private readonly string _workingDirectory;
        private readonly object _gate = new object();

        private Process _process;
        private StreamWriter _stdin;
        private volatile bool _stopping;
        private int _restartCount;

        public event Action<string> FrameReceived;

        public KernelProcess(string nodeExe, string kernelMain, string workingDirectory)
        {
            _nodeExe = nodeExe;
            _kernelMain = kernelMain;
            _workingDirectory = workingDirectory;
        }

        public bool IsRunning
        {
            get
            {
                Process process = _process;
                try { return process != null && !process.HasExited; }
                catch { return false; }
            }
        }

        public void Start()
        {
            StartInternal(false);
            EmitState("started", 0, null);
        }

        public bool Send(string json)
        {
            lock (_gate)
            {
                if (_stdin == null) return false;

                try
                {
                    _stdin.WriteLine(json);
                    _stdin.Flush();
                    return true;
                }
                catch (Exception error)
                {
                    Logs.Shell.Write("ERROR", "kernel stdin write failed: " + error.Message);
                    return false;
                }
            }
        }

        private void StartInternal(bool isRestart)
        {
            if (!File.Exists(_nodeExe))
                throw new FileNotFoundException("Node runtime not found: " + _nodeExe);
            if (!File.Exists(_kernelMain))
                throw new FileNotFoundException("Kernel entry not found: " + _kernelMain);

            var startInfo = new ProcessStartInfo(_nodeExe)
            {
                Arguments = "\"" + _kernelMain + "\" --mode manager",
                WorkingDirectory = _workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = new UTF8Encoding(false),
                StandardErrorEncoding = new UTF8Encoding(false)
            };

            var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            Process previous = null;
            StreamWriter previousStdin = null;

            lock (_gate)
            {
                previous = _process;
                previousStdin = _stdin;
                _process = process;
                _stdin = null;
            }

            if (previousStdin != null)
            {
                try { previousStdin.Dispose(); } catch { }
            }

            if (previous != null)
            {
                try
                {
                    if (!previous.HasExited) previous.Kill();
                    previous.Dispose();
                }
                catch { }
            }

            process.Exited += OnProcessExited;
            process.Start();

            lock (_gate)
            {
                _stdin = new StreamWriter(process.StandardInput.BaseStream, new UTF8Encoding(false))
                {
                    AutoFlush = true
                };
            }

            Logs.Shell.Write("INFO", "kernel started pid=" + process.Id + (isRestart ? " (restart)" : string.Empty));
            Task.Run((Func<Task>)(() => PumpStdoutAsync(process)));
            Task.Run((Func<Task>)(() => PumpStderrAsync(process)));
        }

        private void OnProcessExited(object sender, EventArgs e)
        {
            var process = (Process)sender;
            int pid = SafePid(process);
            int exitCode = -1;
            try { exitCode = process.ExitCode; } catch { }

            Logs.Shell.Write(
                _stopping ? "INFO" : "WARN",
                _stopping ? "kernel process ended pid=" + pid : "kernel exited code=" + exitCode + " pid=" + pid);

            Process current;
            lock (_gate)
            {
                current = _process;
                if (ReferenceEquals(current, process))
                {
                    _stdin = null;
                    _process = null;
                }
            }

            if (_stopping || !ReferenceEquals(current, process))
            {
                try { process.Dispose(); } catch { }
                return;
            }

            int attempt = Interlocked.Increment(ref _restartCount);
            if (attempt <= 1)
            {
                EmitState("restarting", exitCode, "kernel exited; restarting once");
                Task.Run(async () =>
                {
                    await Task.Delay(400).ConfigureAwait(false);
                    if (_stopping) return;
                    try
                    {
                        StartInternal(true);
                        EmitState("restarted", exitCode, null);
                    }
                    catch (Exception error)
                    {
                        Logs.Shell.Write("ERROR", "kernel restart failed: " + error.Message);
                        EmitState("stopped", exitCode, "kernel restart failed: " + error.Message);
                    }
                });
            }
            else
            {
                EmitState("stopped", exitCode, "kernel exited twice; not restarting");
            }

            try { process.Dispose(); } catch { }
        }

        private async Task PumpStdoutAsync(Process process)
        {
            var reader = process.StandardOutput;
            var buffer = new char[8192];
            var line = new StringBuilder();
            int lineBytes = 0;
            bool overflow = false;

            try
            {
                while (true)
                {
                    int read = await reader.ReadAsync(buffer, 0, buffer.Length).ConfigureAwait(false);
                    if (read <= 0) break;

                    for (int i = 0; i < read; i++)
                    {
                        char c = buffer[i];
                        if (c == '\n')
                        {
                            if (overflow)
                            {
                                Logs.Kernel.Write("WARN", "kernel line exceeded 1 MiB; dropped");
                                overflow = false;
                            }
                            else
                            {
                                string frame = line.ToString();
                                if (frame.EndsWith("\r", StringComparison.Ordinal))
                                    frame = frame.Substring(0, frame.Length - 1);
                                if (frame.Length > 0) Deliver(frame);
                            }

                            line.Clear();
                            lineBytes = 0;
                            continue;
                        }

                        if (overflow) continue;

                        lineBytes += Utf8Bytes(c);
                        if (lineBytes > MaxLineBytes)
                        {
                            overflow = true;
                            line.Clear();
                            continue;
                        }

                        line.Append(c);
                    }
                }
            }
            catch (Exception error)
            {
                if (!_stopping) Logs.Kernel.Write("WARN", "stdout pump: " + error.Message);
            }

            if (overflow) Logs.Kernel.Write("WARN", "kernel line exceeded 1 MiB at EOF; dropped");
        }

        private async Task PumpStderrAsync(Process process)
        {
            var reader = process.StandardError;
            try
            {
                string line;
                while ((line = await reader.ReadLineAsync().ConfigureAwait(false)) != null)
                {
                    Logs.Kernel.Write("STDERR", line);
                }
            }
            catch (Exception error)
            {
                if (!_stopping) Logs.Kernel.Write("WARN", "stderr pump: " + error.Message);
            }
        }

        private void Deliver(string frame)
        {
            Action<string> handler = FrameReceived;
            if (handler == null) return;

            try
            {
                handler(frame);
            }
            catch (Exception error)
            {
                Logs.Shell.Write("ERROR", "frame handler failed: " + error.Message);
            }
        }

        private void EmitState(string state, int exitCode, string reason)
        {
            if (!string.Equals(state, "started", StringComparison.Ordinal))
            {
                Logs.Shell.Write(
                    string.Equals(state, "stopped", StringComparison.Ordinal) ? "ERROR" : "INFO",
                    "kernel state=" + state + " exit=" + exitCode + (reason == null ? string.Empty : " reason=" + reason));
            }

            string reasonPart = reason == null ? "null" : Quote(reason);
            string frame = "{\"v\":\"" + ProtocolVersion + "\",\"type\":\"event\",\"event\":\"system.kernel\",\"data\":{"
                + "\"state\":" + Quote(state)
                + ",\"exitCode\":" + exitCode
                + ",\"reason\":" + reasonPart
                + ",\"pid\":" + (_process != null ? SafePid(_process) : 0)
                + "}}";
            Deliver(frame);
        }

        private static int SafePid(Process process)
        {
            try { return process.Id; } catch { return 0; }
        }

        private static string Quote(string value)
        {
            var builder = new StringBuilder("\"");
            foreach (char c in value)
            {
                switch (c)
                {
                    case '"': builder.Append("\\\""); break;
                    case '\\': builder.Append("\\\\"); break;
                    case '\n': builder.Append("\\n"); break;
                    case '\r': builder.Append("\\r"); break;
                    case '\t': builder.Append("\\t"); break;
                    default:
                        if (c < 0x20) builder.Append("\\u").Append(((int)c).ToString("x4"));
                        else builder.Append(c);
                        break;
                }
            }
            return builder.Append('"').ToString();
        }

        private static int Utf8Bytes(char c)
        {
            if (char.IsSurrogate(c)) return 2;
            if (c < 0x80) return 1;
            if (c < 0x800) return 2;
            return 3;
        }

        public void Dispose()
        {
            _stopping = true;

            Process process;
            StreamWriter stdin;
            lock (_gate)
            {
                process = _process;
                stdin = _stdin;
                _process = null;
                _stdin = null;
            }

            if (stdin != null)
            {
                try { stdin.Dispose(); } catch { }
            }

            if (process == null) return;

            try
            {
                if (!process.WaitForExit(1500)) process.Kill();
                process.WaitForExit(2000);
            }
            catch { }

            try { process.Dispose(); } catch { }
            Logs.Shell.Write("INFO", "kernel stopped");
        }
    }
}
