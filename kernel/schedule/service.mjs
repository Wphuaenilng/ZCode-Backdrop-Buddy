import { evaluate } from './engine.mjs';
import { applyThemeState } from '../handlers/theme-state.mjs';

// 宿主明暗要靠定期看一眼；系统明暗由壳订阅 Windows 事件后随 tick 上报，不需要轮询。
export const HOST_MODE_POLL_MS = 30 * 1000;

function hasKind(rules, kind) {
  return rules.some((rule) => rule && rule.enabled !== false && rule.when && rule.when.kind === kind);
}

export function summarize({ rules = [], state = {}, now = new Date(), hostDark = null, systemDark = null } = {}) {
  const result = evaluate({ rules, state, now, hostDark, systemDark });
  const wakeCandidates = [];
  if (result.nextTriggerAt) wakeCandidates.push(new Date(result.nextTriggerAt).getTime());
  if (hasKind(rules, 'hostTheme')) wakeCandidates.push(now.getTime() + HOST_MODE_POLL_MS);
  const wakeAt = wakeCandidates.length ? new Date(Math.min(...wakeCandidates)).toISOString() : null;
  return {
    rules,
    due: result.due,
    nextState: result.state,
    nextTriggerAt: result.nextTriggerAt,
    wakeAt
  };
}

export async function runSchedule(ctx, { reason = 'tick', systemDark = null, hostDark = undefined } = {}) {
  const config = ctx.config.get();
  const rules = Array.isArray(config.schedules) ? config.schedules : [];
  const state = config.scheduleState && typeof config.scheduleState === 'object' ? config.scheduleState : {};

  if (!rules.length) {
    return { reason, rules, fired: [], nextTriggerAt: null, wakeAt: null, hostDark: null, systemDark };
  }

  let observedHost = hostDark;
  if (observedHost === undefined) {
    observedHost = hasKind(rules, 'hostTheme') && typeof ctx.host.observeMode === 'function'
      ? await ctx.host.observeMode()
      : null;
  }

  const plan = summarize({
    rules,
    state,
    now: new Date(),
    hostDark: observedHost === undefined ? null : observedHost,
    systemDark: systemDark === undefined ? null : systemDark
  });

  try {
    ctx.config.set({ scheduleState: plan.nextState });
  } catch (error) {
    ctx.logger?.warn('schedule state persist failed', { message: error.message });
  }

  const fired = [];
  for (const rule of plan.due) {
    if (!ctx.library.get(rule.themeId)) {
      fired.push({ ruleId: rule.id, themeId: rule.themeId, skipped: '主题已不存在' });
      ctx.logger?.warn('schedule rule skipped', { ruleId: rule.id, themeId: rule.themeId, reason: 'theme missing' });
      continue;
    }
    try {
      await applyThemeState(ctx, { themeId: rule.themeId });
      fired.push({ ruleId: rule.id, themeId: rule.themeId, applied: true });
      ctx.bus.emit('schedule.fired', { ruleId: rule.id, themeId: rule.themeId, kind: rule.when.kind, reason });
      ctx.logger?.info('schedule applied', { ruleId: rule.id, themeId: rule.themeId, kind: rule.when.kind, reason });
    } catch (error) {
      fired.push({ ruleId: rule.id, themeId: rule.themeId, applied: false, error: error.message });
      ctx.logger?.warn('schedule apply failed', { ruleId: rule.id, themeId: rule.themeId, message: error.message });
    }
  }

  return {
    reason,
    rules,
    fired,
    nextTriggerAt: plan.nextTriggerAt,
    wakeAt: plan.wakeAt,
    hostDark: observedHost === undefined ? null : observedHost,
    systemDark: systemDark === undefined ? null : systemDark
  };
}
