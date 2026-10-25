using System;
using System.Collections.Generic;

namespace BackdropBuddy.Shell.Infrastructure
{
    internal sealed class PathTokenStore
    {
        private const int MaxTokens = 64;
        private static readonly TimeSpan Lifetime = TimeSpan.FromMinutes(10);

        private sealed class Entry
        {
            public string Path;
            public DateTime ExpiresAt;
        }

        private readonly object _gate = new object();
        private readonly Dictionary<string, Entry> _tokens = new Dictionary<string, Entry>(StringComparer.Ordinal);

        public string Register(string path)
        {
            if (string.IsNullOrWhiteSpace(path)) return null;

            lock (_gate)
            {
                Prune();

                if (_tokens.Count >= MaxTokens)
                {
                    string oldest = null;
                    DateTime oldestExpiry = DateTime.MaxValue;
                    foreach (KeyValuePair<string, Entry> pair in _tokens)
                    {
                        if (pair.Value.ExpiresAt < oldestExpiry)
                        {
                            oldestExpiry = pair.Value.ExpiresAt;
                            oldest = pair.Key;
                        }
                    }
                    if (oldest != null) _tokens.Remove(oldest);
                }

                string token = "fp-" + Guid.NewGuid().ToString("n");
                _tokens[token] = new Entry { Path = path, ExpiresAt = DateTime.UtcNow + Lifetime };
                return token;
            }
        }

        public bool TryResolve(string token, out string path)
        {
            path = null;
            if (string.IsNullOrEmpty(token)) return false;

            lock (_gate)
            {
                Prune();
                Entry entry;
                if (!_tokens.TryGetValue(token, out entry)) return false;
                _tokens.Remove(token);
                path = entry.Path;
                return true;
            }
        }

        private void Prune()
        {
            DateTime now = DateTime.UtcNow;
            List<string> expired = null;
            foreach (KeyValuePair<string, Entry> pair in _tokens)
            {
                if (pair.Value.ExpiresAt <= now)
                {
                    if (expired == null) expired = new List<string>();
                    expired.Add(pair.Key);
                }
            }
            if (expired == null) return;
            foreach (string key in expired) _tokens.Remove(key);
        }
    }
}
