using System;
using System.IO;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace BackdropBuddy.Shell.Infrastructure
{
    internal sealed class SingleInstance : IDisposable
    {
        private const string ActivateCommand = "activate";

        private readonly string _name;
        private readonly Action _onActivate;
        private readonly CancellationTokenSource _cts = new CancellationTokenSource();
        private NamedPipeServerStream _server;
        private Task _loop;

        private SingleInstance(string name, Action onActivate)
        {
            _name = name;
            _onActivate = onActivate;
        }

        public static string PipeNameFor(string appRoot)
        {
            string seed = Environment.UserName.ToLowerInvariant() + "|" + (appRoot ?? string.Empty).ToLowerInvariant();
            using (SHA256 sha = SHA256.Create())
            {
                byte[] hash = sha.ComputeHash(Encoding.UTF8.GetBytes(seed));
                var tail = new StringBuilder();
                for (int i = 0; i < 12; i++) tail.Append(hash[i].ToString("x2"));
                return "BackdropBuddy.Instance." + tail;
            }
        }

        public static SingleInstance TryCreate(string name, Action onActivate)
        {
            var instance = new SingleInstance(name, onActivate);
            try
            {
                instance._server = CreateServer(name);
            }
            catch (Exception error) when (error is IOException || error is UnauthorizedAccessException)
            {
                Logs.Shell.Write("INFO", "single-instance pipe already owned: " + error.Message);
                return null;
            }

            instance._loop = Task.Run((Func<Task>)instance.ListenAsync);
            return instance;
        }

        public static bool Signal(string name, int timeoutMs = 2500)
        {
            try
            {
                using (var client = new NamedPipeClientStream(".", name, PipeDirection.Out))
                {
                    client.Connect(timeoutMs);
                    using (var writer = new StreamWriter(client, new UTF8Encoding(false)) { AutoFlush = true })
                    {
                        writer.WriteLine(ActivateCommand);
                    }
                }
                return true;
            }
            catch (Exception error)
            {
                Logs.Shell.Write("WARN", "failed to activate running instance: " + error.Message);
                return false;
            }
        }

        private static NamedPipeServerStream CreateServer(string name)
        {
            return new NamedPipeServerStream(
                name,
                PipeDirection.In,
                1,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous);
        }

        private async Task<NamedPipeServerStream> CreateServerWithRetryAsync(CancellationToken token)
        {
            for (int attempt = 0; attempt < 40; attempt++)
            {
                token.ThrowIfCancellationRequested();
                try
                {
                    return CreateServer(_name);
                }
                catch (IOException error)
                {
                    Logs.Shell.Write("WARN", "pipe still busy; retrying: " + error.Message);
                    await Task.Delay(150, token).ConfigureAwait(false);
                }
            }

            throw new IOException("could not recreate single-instance pipe: " + _name);
        }

        private async Task ListenAsync()
        {
            NamedPipeServerStream server = _server;

            while (!_cts.IsCancellationRequested)
            {
                try
                {
                    await server.WaitForConnectionAsync(_cts.Token).ConfigureAwait(false);

                    string line;
                    using (var reader = new StreamReader(server, new UTF8Encoding(false), false, 1024, true))
                    {
                        line = await reader.ReadLineAsync().ConfigureAwait(false);
                    }

                    server.Dispose();

                    if (string.Equals(line, ActivateCommand, StringComparison.Ordinal))
                    {
                        Logs.Shell.Write("INFO", "activate requested by second instance");
                        _onActivate();
                    }

                    server = await CreateServerWithRetryAsync(_cts.Token).ConfigureAwait(false);
                    _server = server;
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
                catch (Exception error)
                {
                    Logs.Shell.Write("WARN", "single-instance pipe: " + error.Message);
                    try { server.Dispose(); } catch { }
                    try
                    {
                        await Task.Delay(250, _cts.Token).ConfigureAwait(false);
                        server = CreateServer(_name);
                        _server = server;
                    }
                    catch (Exception)
                    {
                        break;
                    }
                }
            }
        }

        public void Dispose()
        {
            _cts.Cancel();
            try
            {
                if (_server != null) _server.Dispose();
            }
            catch { }

            try
            {
                if (_loop != null) _loop.Wait(1000);
            }
            catch { }

            _cts.Dispose();
        }
    }
}
