using System;
using System.Collections.Generic;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

namespace BackdropBuddy.Shell.Infrastructure
{
    internal sealed class ProtocolBridge
    {
        private const string ProtocolVersion = "dreamskin.manager/1";
        private const int MaxMessageBytes = 1024 * 1024;
        private const int MaxPending = 1024;
        private const int RequestTimeoutMs = 30000;

        private static readonly HashSet<string> LocalMethods = new HashSet<string>(StringComparer.Ordinal)
        {
            "file.pick",
            "shell.settings.get",
            "shell.settings.set"
        };

        private static readonly HashSet<string> PathMethods = new HashSet<string>(StringComparer.Ordinal)
        {
            "theme.import",
            "theme.export",
            "file.validate"
        };

        private sealed class Pending
        {
            public Timer Timer;
        }

        private sealed class ShellPending
        {
            public Action<Dictionary<string, object>> Callback;
            public Timer Timer;
        }

        private readonly KernelProcess _kernel;
        private readonly Action<string> _toUi;
        private readonly PathTokenStore _pathTokens;
        private readonly string _exportsRoot;
        private readonly JavaScriptSerializer _json = new JavaScriptSerializer { MaxJsonLength = MaxMessageBytes * 2 };
        private readonly object _gate = new object();
        private readonly Dictionary<string, Pending> _pending = new Dictionary<string, Pending>(StringComparer.Ordinal);
        private readonly Dictionary<string, ShellPending> _shellPending = new Dictionary<string, ShellPending>(StringComparer.Ordinal);
        private readonly object _shellGate = new object();

        public ProtocolBridge(KernelProcess kernel, Action<string> toUi, PathTokenStore pathTokens = null, string exportsRoot = null)
        {
            _kernel = kernel;
            _toUi = toUi;
            _pathTokens = pathTokens;
            _exportsRoot = exportsRoot;
        }

        public Func<Dictionary<string, object>, Dictionary<string, object>> LocalRequestHandler { get; set; }

        public int PendingCount
        {
            get { lock (_gate) { return _pending.Count; } }
        }

        public void FromUi(string messageJson)
        {
            if (string.IsNullOrEmpty(messageJson)) return;

            if (Encoding.UTF8.GetByteCount(messageJson) > MaxMessageBytes)
            {
                Logs.Shell.Write("WARN", "rejected UI message over 1 MiB");
                SendError(null, "MESSAGE_TOO_LARGE", "message exceeds 1048576 bytes", false);
                return;
            }

            object parsed;
            try
            {
                parsed = _json.DeserializeObject(messageJson);
            }
            catch (Exception error)
            {
                Logs.Shell.Write("WARN", "invalid UI JSON: " + error.Message);
                SendError(null, "BAD_ENVELOPE", "invalid JSON", false);
                return;
            }

            string wire = messageJson;
            string nested = parsed as string;
            if (nested != null)
            {
                wire = nested;
                if (Encoding.UTF8.GetByteCount(wire) > MaxMessageBytes)
                {
                    SendError(null, "MESSAGE_TOO_LARGE", "message exceeds 1048576 bytes", false);
                    return;
                }

                try { parsed = _json.DeserializeObject(wire); }
                catch (Exception)
                {
                    SendError(null, "BAD_ENVELOPE", "invalid JSON", false);
                    return;
                }
            }

            var message = parsed as Dictionary<string, object>;
            if (message == null)
            {
                SendError(null, "BAD_ENVELOPE", "message must be a JSON object", false);
                return;
            }

            string type = GetString(message, "type");
            string id = GetString(message, "id");
            string method = GetString(message, "method");

            if (!string.Equals(type, "request", StringComparison.Ordinal))
            {
                SendError(id, "BAD_ENVELOPE", "only request messages are accepted from the UI", false);
                return;
            }

            if (string.IsNullOrEmpty(id) || string.IsNullOrEmpty(method))
            {
                SendError(id, "BAD_ENVELOPE", "id and method must be non-empty strings", false);
                return;
            }

            if (LocalMethods.Contains(method) && LocalRequestHandler != null)
            {
                Dictionary<string, object> data;
                try
                {
                    data = LocalRequestHandler(message);
                }
                catch (Exception error)
                {
                    Logs.Shell.Write("ERROR", method + " failed: " + error);
                    SendError(id, "LOCAL_REQUEST_FAILED", error.Message, false);
                    return;
                }

                var envelope = new Dictionary<string, object>
                {
                    { "v", ProtocolVersion },
                    { "id", id },
                    { "type", "response" },
                    { "ok", true },
                    { "data", data }
                };
                _toUi(_json.Serialize(envelope));
                return;
            }

            wire = ApplyPathPolicy(wire, message, id, method);
            if (wire == null) return;

            lock (_gate)
            {
                if (_pending.Count >= MaxPending)
                {
                    SendError(id, "BUSY", "too many in-flight requests", true);
                    return;
                }

                Pending previous;
                if (_pending.TryGetValue(id, out previous))
                {
                    previous.Timer.Dispose();
                    _pending.Remove(id);
                }

                var pending = new Pending();
                pending.Timer = new Timer(OnTimeout, id, RequestTimeoutMs, Timeout.Infinite);
                _pending[id] = pending;
            }

            if (!_kernel.Send(wire))
            {
                Complete(id);
                SendError(id, "KERNEL_UNAVAILABLE", "kernel process is not running", true);
            }
        }

        // 外壳（托盘等）直接向内核发请求；这类回包由外壳消费，不再转发给 UI。
        public void Request(string method, Dictionary<string, object> parameters, Action<Dictionary<string, object>> callback, int timeoutMs = 20000)
        {
            if (string.IsNullOrEmpty(method) || _kernel == null)
            {
                InvokeShellCallback(callback, ErrorResult("KERNEL_UNAVAILABLE", "kernel process is not running"));
                return;
            }

            string id = "shell-" + Guid.NewGuid().ToString("n");
            var envelope = new Dictionary<string, object>
            {
                { "v", ProtocolVersion },
                { "id", id },
                { "type", "request" },
                { "method", method },
                { "params", parameters ?? new Dictionary<string, object>() }
            };

            var pending = new ShellPending { Callback = callback };
            lock (_shellGate)
            {
                _shellPending[id] = pending;
                pending.Timer = new Timer(OnShellTimeout, id, Math.Max(1000, timeoutMs), Timeout.Infinite);
            }

            if (!_kernel.Send(_json.Serialize(envelope)))
            {
                ShellPending removed = null;
                lock (_shellGate)
                {
                    if (_shellPending.TryGetValue(id, out removed)) _shellPending.Remove(id);
                }
                if (removed != null && removed.Timer != null) removed.Timer.Dispose();
                InvokeShellCallback(callback, ErrorResult("KERNEL_UNAVAILABLE", "kernel process is not running"));
            }
        }

        private static Dictionary<string, object> ErrorResult(string code, string message)
        {
            return new Dictionary<string, object>
            {
                { "ok", false },
                {
                    "error", new Dictionary<string, object>
                    {
                        { "code", code },
                        { "message", message },
                        { "retryable", true }
                    }
                }
            };
        }

        private static void InvokeShellCallback(Action<Dictionary<string, object>> callback, Dictionary<string, object> result)
        {
            if (callback == null) return;
            try
            {
                callback(result);
            }
            catch (Exception error)
            {
                Logs.Shell.Write("WARN", "shell request callback failed: " + error.Message);
            }
        }

        private void OnShellTimeout(object state)
        {
            string id = (string)state;
            ShellPending pending;
            lock (_shellGate)
            {
                if (!_shellPending.TryGetValue(id, out pending)) return;
                _shellPending.Remove(id);
            }

            if (pending.Timer != null) pending.Timer.Dispose();
            Logs.Shell.Write("WARN", "shell request timed out id=" + id);
            InvokeShellCallback(pending.Callback, ErrorResult("TIMEOUT", "kernel did not respond in time"));
        }

        private string ApplyPathPolicy(string wire, Dictionary<string, object> message, string id, string method)
        {
            if (!PathMethods.Contains(method)) return wire;

            var parameters = message.ContainsKey("params") ? message["params"] as Dictionary<string, object> : null;
            if (parameters == null) return wire;

            string field = string.Equals(method, "theme.export", StringComparison.Ordinal) ? "destPath" : "path";

            string token = parameters.ContainsKey("token") ? parameters["token"] as string : null;
            if (!string.IsNullOrEmpty(token))
            {
                string resolved;
                if (_pathTokens == null || !_pathTokens.TryResolve(token, out resolved))
                {
                    Logs.Shell.Write("WARN", "rejected unknown or reused path token for " + method);
                    SendError(id, "PATH_TOKEN_INVALID", "文件选择令牌无效或已使用，请重新选择", false);
                    return null;
                }

                parameters.Remove("token");
                parameters[field] = resolved;
                message["params"] = parameters;
                return _json.Serialize(message);
            }

            if (AllowRawPaths()) return wire;

            string rawPath = parameters.ContainsKey(field) ? parameters[field] as string : null;
            if (!IsAllowedRawPath(rawPath))
            {
                Logs.Shell.Write("WARN", "rejected raw path for " + method + ": " + (rawPath ?? "(none)"));
                SendError(id, "PATH_OUT_OF_POLICY", "未授权的文件路径，请通过文件选择器重新选择", false);
                return null;
            }

            return wire;
        }

        private static bool AllowRawPaths()
        {
            return string.Equals(Environment.GetEnvironmentVariable("BACKDROPBUDDY_ALLOW_RAW_PATH"), "1", StringComparison.Ordinal);
        }

        private bool IsAllowedRawPath(string path)
        {
            if (string.IsNullOrWhiteSpace(path) || string.IsNullOrWhiteSpace(_exportsRoot)) return false;

            try
            {
                string root = System.IO.Path.GetFullPath(_exportsRoot)
                    .TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar);
                string full = System.IO.Path.GetFullPath(path);
                return full.StartsWith(root + System.IO.Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
            }
            catch (Exception)
            {
                return false;
            }
        }

        public void FromKernel(string frame)
        {
            if (string.IsNullOrEmpty(frame)) return;

            Dictionary<string, object> message = null;
            try
            {
                message = _json.DeserializeObject(frame) as Dictionary<string, object>;
            }
            catch (Exception error)
            {
                Logs.Shell.Write("WARN", "invalid kernel JSON: " + error.Message);
            }

            if (message == null) return;

            if (string.Equals(GetString(message, "type"), "response", StringComparison.Ordinal))
            {
                string id = GetString(message, "id");
                if (!string.IsNullOrEmpty(id))
                {
                    ShellPending shellPending = null;
                    lock (_shellGate)
                    {
                        if (_shellPending.TryGetValue(id, out shellPending)) _shellPending.Remove(id);
                    }

                    if (shellPending != null)
                    {
                        if (shellPending.Timer != null) shellPending.Timer.Dispose();
                        InvokeShellCallback(shellPending.Callback, message);
                        return;
                    }

                    Complete(id);
                }
            }

            _toUi(frame);
        }

        private void OnTimeout(object state)
        {
            string id = (string)state;
            bool removed;
            lock (_gate)
            {
                removed = _pending.Remove(id);
            }

            if (!removed) return;
            Logs.Shell.Write("WARN", "kernel request timed out id=" + id);
            SendError(id, "TIMEOUT", "kernel did not respond within " + RequestTimeoutMs + " ms", true);
        }

        private void Complete(string id)
        {
            Pending pending;
            lock (_gate)
            {
                if (!_pending.TryGetValue(id, out pending)) return;
                _pending.Remove(id);
            }

            pending.Timer.Dispose();
        }

        private void SendError(string id, string code, string message, bool retryable)
        {
            var error = new Dictionary<string, object>
            {
                { "code", code },
                { "message", message },
                { "retryable", retryable }
            };
            var envelope = new Dictionary<string, object>
            {
                { "v", ProtocolVersion },
                { "id", id },
                { "type", "response" },
                { "ok", false },
                { "error", error }
            };

            _toUi(_json.Serialize(envelope));
        }

        private static string GetString(Dictionary<string, object> message, string key)
        {
            object value;
            if (!message.TryGetValue(key, out value)) return null;
            return value as string;
        }
    }
}
