const TIME_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

// 到点后允许补放的时间窗：壳的定时器按时唤醒，正常都在几秒内命中
export const FIRE_GRACE_MS = 30 * 60 * 1000;

export function isValidAt(value) {
  return TIME_RE.test(String(value || ''));
}

function atMinutes(value) {
  const match = TIME_RE.exec(String(value || ''));
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function dayKey(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// 今天（或昨天）那个 HH:MM 已经过去的时刻；每天最多命中一次
export function lastOccurrence(at, now = new Date()) {
  const minutes = atMinutes(at);
  if (minutes === null) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const candidate = new Date(today.getTime() + minutes * 60000);
  if (candidate.getTime() <= now.getTime()) return candidate;
  return new Date(candidate.getTime() - 24 * 60 * 60000);
}

export function nextTriggerAt(at, now = new Date()) {
  const minutes = atMinutes(at);
  if (minutes === null) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const candidate = new Date(today.getTime() + minutes * 60000);
  return candidate.getTime() > now.getTime() ? candidate : new Date(candidate.getTime() + 24 * 60 * 60000);
}

export function slotKey(at, now) {
  const occurred = lastOccurrence(at, now);
  return occurred ? `${dayKey(occurred)}@${at}` : null;
}

export function normalizeRule(input, existing) {
  const rule = { ...(existing || {}), ...(input || {}) };
  if (!rule.id) rule.id = `sch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  rule.name = String(rule.name || '').slice(0, 40) || '未命名规则';
  rule.enabled = rule.enabled !== false;
  const when = rule.when || {};
  const kind = ['time', 'hostTheme', 'systemTheme'].includes(when.kind) ? when.kind : 'time';
  rule.when = { kind };
  if (kind === 'time') rule.when.at = isValidAt(when.at) ? when.at : '22:00';
  else rule.when.dark = when.dark === true ? true : (when.dark === false ? false : true);
  rule.themeId = String(rule.themeId || '').slice(0, 64) || null;
  return rule;
}

export function validateRule(rule) {
  const errors = [];
  if (!rule.themeId) errors.push('请选择要切换的主题');
  if (rule.when.kind === 'time' && !isValidAt(rule.when.at)) errors.push('时间格式要是 HH:MM');
  if (rule.when.kind !== 'time' && typeof rule.when.dark !== 'boolean') errors.push('要指定深色还是浅色');
  return errors;
}

// 纯函数：给定规则、上次记录到的状态与此刻的明暗观测，算出该触发什么、下次什么时候。
export function evaluate({ rules = [], state = {}, now = new Date(), hostDark = null, systemDark = null } = {}) {
  const slots = { ...(state.slots || {}) };
  const due = [];
  let next = null;

  for (const rule of rules) {
    if (!rule || rule.enabled === false || !rule.themeId) continue;

    if (rule.when.kind === 'time') {
      const occurred = lastOccurrence(rule.when.at, now);
      const key = occurred ? `${dayKey(occurred)}@${rule.when.at}` : null;
      const upcoming = nextTriggerAt(rule.when.at, now);
      if (upcoming && (next === null || upcoming.getTime() < next.getTime())) next = upcoming;
      if (!key) continue;
      if (slots[rule.id] === key) continue;
      slots[rule.id] = key;
      // 只认"刚刚到点"，不补放：应用关了三天，开机时不该半夜的规则立刻响一次
      if (now.getTime() - occurred.getTime() <= FIRE_GRACE_MS) due.push(rule);
      continue;
    }

    const observed = rule.when.kind === 'hostTheme' ? hostDark : systemDark;
    const memoryKey = rule.when.kind === 'hostTheme' ? 'hostDark' : 'systemDark';
    const previous = state[memoryKey];
    // 只在"看着它变了"的时候触发：启动时宿主本来就是深色，不算一次切换
    const changed = previous !== null && previous !== undefined && previous !== observed;
    if (changed && observed === rule.when.dark) {
      due.push(rule);
    }
  }

  return {
    due,
    nextTriggerAt: next ? next.toISOString() : null,
    state: {
      slots,
      hostDark: hostDark === undefined ? (state.hostDark ?? null) : hostDark,
      systemDark: systemDark === undefined ? (state.systemDark ?? null) : systemDark
    }
  };
}
