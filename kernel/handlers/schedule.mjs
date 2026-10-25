import { METHODS } from '../../shared/protocol/constants.mjs';
import { METHOD_SCHEMAS } from '../schema/methods.mjs';
import { AppError } from '../protocol/errors.mjs';
import { normalizeRule, validateRule } from '../schedule/engine.mjs';
import { runSchedule, summarize } from '../schedule/service.mjs';

function readRules(ctx) {
  const config = ctx.config.get();
  return {
    rules: Array.isArray(config.schedules) ? config.schedules : [],
    state: config.scheduleState && typeof config.scheduleState === 'object' ? config.scheduleState : {}
  };
}

function planOf({ rules, state }) {
  const plan = summarize({ rules, state, now: new Date(), hostDark: null, systemDark: null });
  return { nextTriggerAt: plan.nextTriggerAt, wakeAt: plan.wakeAt };
}

export default function register(registry, ctx) {
  registry.register(METHODS.SCHEDULE_LIST, METHOD_SCHEMAS[METHODS.SCHEDULE_LIST], async () => {
    const snapshot = readRules(ctx);
    return { rules: snapshot.rules, state: snapshot.state, ...planOf(snapshot) };
  });

  registry.register(METHODS.SCHEDULE_SAVE, METHOD_SCHEMAS[METHODS.SCHEDULE_SAVE], async ({ rule }) => {
    const snapshot = readRules(ctx);
    const existing = rule.id ? snapshot.rules.find((entry) => entry.id === rule.id) : null;
    const incoming = normalizeRule(rule, existing);
    const errors = validateRule(incoming);
    if (errors.length) throw new AppError('BAD_PARAMS', errors.join('；'));
    if (!ctx.library.get(incoming.themeId)) {
      throw new AppError('THEME_NOT_FOUND', `主题不存在：${incoming.themeId}`);
    }

    const rules = snapshot.rules.slice();
    const index = rules.findIndex((entry) => entry.id === incoming.id);
    if (index >= 0) rules[index] = incoming;
    else rules.push(incoming);

    // 改规则等于重新计时：把它的时间槽清掉，避免带着旧规则的命中记录
    const slots = { ...(snapshot.state.slots || {}) };
    if (existing && existing.when && existing.when.at !== incoming.when.at) delete slots[incoming.id];
    ctx.config.set({ schedules: rules, scheduleState: { ...snapshot.state, slots } });
    const plan = planOf({ rules, state: snapshot.state });
    ctx.bus.emit('schedule.updated', { action: 'save', ruleId: incoming.id, count: rules.length, wakeAt: plan.wakeAt });
    return { rules, saved: incoming, ...plan };
  });

  registry.register(METHODS.SCHEDULE_REMOVE, METHOD_SCHEMAS[METHODS.SCHEDULE_REMOVE], async ({ id }) => {
    const snapshot = readRules(ctx);
    const rules = snapshot.rules.filter((entry) => entry.id !== id);
    if (rules.length === snapshot.rules.length) throw new AppError('BAD_PARAMS', `没有这条规则：${id}`);
    const slots = { ...(snapshot.state.slots || {}) };
    delete slots[id];
    ctx.config.set({ schedules: rules, scheduleState: { ...snapshot.state, slots } });
    const plan = planOf({ rules, state: snapshot.state });
    ctx.bus.emit('schedule.updated', { action: 'remove', ruleId: id, count: rules.length, wakeAt: plan.wakeAt });
    return { rules, removed: id, ...plan };
  });

  registry.register(METHODS.SCHEDULE_TICK, METHOD_SCHEMAS[METHODS.SCHEDULE_TICK], async ({ systemDark = null, reason = 'tick' } = {}) => {
    const result = await runSchedule(ctx, { reason, systemDark });
    return {
      fired: result.fired,
      nextTriggerAt: result.nextTriggerAt,
      wakeAt: result.wakeAt,
      hostDark: result.hostDark,
      systemDark: result.systemDark
    };
  });
}
