import test from 'node:test';
import assert from 'node:assert/strict';
import { METHODS } from '../../shared/protocol/constants.mjs';
import { openWorld } from './helpers/fake-host.mjs';
import {
  evaluate,
  isValidAt,
  lastOccurrence,
  nextTriggerAt,
  normalizeRule,
  slotKey,
  validateRule
} from '../../kernel/schedule/engine.mjs';

const at = (iso) => new Date(iso);

test('调度：时刻规则每天只命中一次', () => {
  const rules = [{ id: 'r1', enabled: true, themeId: 'moon', when: { kind: 'time', at: '22:30' } }];

  const first = evaluate({ rules, state: {}, now: at('2026-10-24T22:35:00') });
  assert.equal(first.due.length, 1, '过了 22:30 应触发一次');
  assert.equal(first.state.slots.r1, '2026-10-24@22:30');

  const again = evaluate({ rules, state: first.state, now: at('2026-10-24T23:59:00') });
  assert.equal(again.due.length, 0, '同一个时间槽不能重复触发');

  const nextDay = evaluate({ rules, state: again.state, now: at('2026-10-25T22:31:00') });
  assert.equal(nextDay.due.length, 1, '第二天到点再触发一次');
  assert.equal(nextDay.state.slots.r1, '2026-10-25@22:30');
});

test('调度：还没到点时不触发，但要报出下次触发时间', () => {
  const rules = [{ id: 'r1', enabled: true, themeId: 'moon', when: { kind: 'time', at: '22:30' } }];
  const now = at('2026-10-24T09:00:00');

  const result = evaluate({ rules, state: {}, now });
  assert.equal(result.due.length, 0);
  assert.equal(result.nextTriggerAt, new Date(2026, 9, 24, 22, 30, 0, 0).toISOString(), '今天 22:30');

  const late = evaluate({ rules, state: {}, now: at('2026-10-24T23:00:00') });
  assert.equal(late.nextTriggerAt, new Date(2026, 9, 25, 22, 30, 0, 0).toISOString(), '已过今天则报明天');
});

test('调度：明暗规则只在看着它变化时触发', () => {
  const rules = [
    { id: 'dark-rule', enabled: true, themeId: 'moon', when: { kind: 'hostTheme', dark: true } },
    { id: 'light-rule', enabled: true, themeId: 'paper', when: { kind: 'hostTheme', dark: false } }
  ];

  const boot = evaluate({ rules, state: {}, now: at('2026-10-24T10:00:00'), hostDark: true });
  assert.equal(boot.due.length, 0, '启动时宿主已经是深色，不算一次切换');
  assert.equal(boot.state.hostDark, true, '但要把观测值记下来');

  const flipped = evaluate({ rules, state: boot.state, now: at('2026-10-24T10:05:00'), hostDark: false });
  assert.deepEqual(flipped.due.map((rule) => rule.id), ['light-rule'], '切到浅色只触发浅色的那条');

  const steady = evaluate({ rules, state: flipped.state, now: at('2026-10-24T10:06:00'), hostDark: false });
  assert.equal(steady.due.length, 0, '模式没变就不再触发');

  const back = evaluate({ rules, state: steady.state, now: at('2026-10-24T10:10:00'), hostDark: true });
  assert.deepEqual(back.due.map((rule) => rule.id), ['dark-rule']);
});

test('调度：系统明暗与宿主明暗各记各的，禁用的规则不参与', () => {
  const rules = [
    { id: 'sys-dark', enabled: true, themeId: 'moon', when: { kind: 'systemTheme', dark: true } },
    { id: 'sys-light', enabled: true, themeId: 'paper', when: { kind: 'systemTheme', dark: false } },
    { id: 'off', enabled: false, themeId: 'sakura', when: { kind: 'time', at: '00:00' } }
  ];

  const first = evaluate({ rules, state: {}, now: at('2026-10-24T10:00:00'), hostDark: false, systemDark: true });
  assert.equal(first.due.length, 0, '首次观测只记录，不触发');
  assert.equal(first.state.systemDark, true);
  assert.equal(first.state.hostDark, false);

  const second = evaluate({ rules, state: first.state, now: at('2026-10-24T10:01:00'), hostDark: true, systemDark: false });
  assert.deepEqual(second.due.map((rule) => rule.id), ['sys-light'], '系统切到浅色只命中系统浅色的那条，宿主的明暗变化不算');
  assert.equal(second.state.hostDark, true);
});

test('调度：时间解析与规则归一', () => {
  assert.equal(isValidAt('09:05'), true);
  assert.equal(isValidAt('24:00'), false);
  assert.equal(isValidAt('9:5'), false);
  assert.equal(lastOccurrence('07:00', at('2026-10-24T06:00:00')).getDate(), 23, '没过今天的点就算昨天');
  assert.equal(slotKey('07:00', at('2026-10-24T08:00:00')), '2026-10-24@07:00');
  assert.equal(nextTriggerAt('坏值', new Date()), null);

  const rule = normalizeRule({ when: { kind: 'nonsense', at: '25:00' }, themeId: '', name: '' });
  assert.equal(rule.when.kind, 'time');
  assert.equal(rule.when.at, '22:00', '非法值要回落到可用的默认');
  assert.equal(rule.enabled, true);
  assert.ok(rule.id);
  assert.deepEqual(validateRule(rule), ['请选择要切换的主题']);

  const mode = normalizeRule({ when: { kind: 'hostTheme', dark: 'yes' } });
  assert.equal(mode.when.dark, true, '认不出的明暗值按深色处理');
});

test('调度接线：到点的规则真的换掉主题，同一时间槽不重复换', async (t) => {
  const { kernel, world, call } = await openWorld(t, { windows: [{ dark: false }] });
  t.after(() => kernel.close());

  const first = await call(METHODS.THEME_SAVE, { name: '白天主题' });
  const night = await call(METHODS.THEME_SAVE, { name: '夜间主题' });
  await call(METHODS.THEME_APPLY, { themeId: first.data.theme.id });

  const now = new Date();
  const minutes = ((now.getHours() * 60 + now.getMinutes() - 1) + 1440) % 1440;
  const at = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

  const saved = await call(METHODS.SCHEDULE_SAVE, {
    rule: { name: '夜里切主题', themeId: night.data.theme.id, when: { kind: 'time', at } }
  });
  assert.equal(saved.ok, true, JSON.stringify(saved.error || {}));
  assert.equal(saved.data.rules.length, 1);
  assert.ok(saved.data.nextTriggerAt, '要能报出下次触发时间');
  assert.ok(saved.data.wakeAt, '壳要按 wakeAt 装配一次性定时器');

  const tick = await call(METHODS.SCHEDULE_TICK, { reason: 'test' });
  assert.equal(tick.ok, true, JSON.stringify(tick.error || {}));
  assert.equal(tick.data.fired.length, 1);
  assert.equal(tick.data.fired[0].applied, true, JSON.stringify(tick.data.fired));
  assert.equal(world.list()[0].themeId, night.data.theme.id, '宿主上换成规则指定的主题');
  assert.equal(kernel.ctx.pointer.read().activeThemeId, night.data.theme.id);

  const again = await call(METHODS.SCHEDULE_TICK, { reason: 'test' });
  assert.equal(again.data.fired.length, 0, '同一个时间槽只触发一次');
  assert.equal(world.list()[0].themeId, night.data.theme.id);
});

test('调度接线：宿主切到深色时命中深色规则，首次观测不误触发', async (t) => {
  const { kernel, world, call } = await openWorld(t, { windows: [{ dark: false }] });
  t.after(() => kernel.close());

  const day = await call(METHODS.THEME_SAVE, { name: '浅色主题' });
  const night = await call(METHODS.THEME_SAVE, { name: '深色主题' });
  const winId = world.list()[0].id;

  const saved = await call(METHODS.SCHEDULE_SAVE, {
    rule: { name: '宿主深色时', themeId: night.data.theme.id, when: { kind: 'hostTheme', dark: true } }
  });
  assert.equal(saved.ok, true, JSON.stringify(saved.error || {}));

  // 保存后立刻 tick：此刻仍是浅色，不该有任何动作
  const warm = await call(METHODS.SCHEDULE_TICK, { reason: 'test' });
  assert.equal(warm.data.fired.length, 0);
  assert.equal(warm.data.hostDark, false, '内核自己读了页面此刻的明暗');

  world.setMode(winId, true);
  const flipped = await call(METHODS.SCHEDULE_TICK, { reason: 'test' });
  assert.equal(flipped.data.fired.length, 1, '看着它变深色才触发');
  assert.equal(flipped.data.fired[0].applied, true);
  assert.equal(world.list()[0].themeId, night.data.theme.id);

  const steady = await call(METHODS.SCHEDULE_TICK, { reason: 'test' });
  assert.equal(steady.data.fired.length, 0, '一直是深色就不再重复触发');
});

test('调度接线：非法规则被挡在门外，删掉的规则不再计时', async (t) => {
  const { kernel, call } = await openWorld(t, { windows: [{ dark: false }] });
  t.after(() => kernel.close());

  const missingTheme = await call(METHODS.SCHEDULE_SAVE, {
    rule: { name: '指向不存在的主题', themeId: 'no-such-theme', when: { kind: 'time', at: '07:00' } }
  });
  assert.equal(missingTheme.ok, false);
  assert.equal(missingTheme.error.code, 'THEME_NOT_FOUND');

  const noTheme = await call(METHODS.SCHEDULE_SAVE, {
    rule: { name: '没选主题', themeId: null, when: { kind: 'time', at: '07:00' } }
  });
  assert.equal(noTheme.ok, false, 'schema 允许 null，但业务上要挡下来');
  assert.equal(noTheme.error.code, 'BAD_PARAMS');

  const badTime = await call(METHODS.SCHEDULE_SAVE, {
    rule: { name: '时间非法', themeId: 'x', when: { kind: 'time', at: '25:00' } }
  });
  assert.equal(badTime.ok, false, '非法时间不能存');

  const saved = await call(METHODS.SCHEDULE_SAVE, {
    rule: { name: '早上', themeId: (await call(METHODS.THEME_SAVE, { name: '早上主题' })).data.theme.id, when: { kind: 'time', at: '07:00' } }
  });
  assert.equal(saved.ok, true, JSON.stringify(saved.error || {}));
  assert.equal(saved.data.rules.length, 1);

  const removed = await call(METHODS.SCHEDULE_REMOVE, { id: saved.data.saved.id });
  assert.equal(removed.ok, true, JSON.stringify(removed.error || {}));
  assert.equal(removed.data.rules.length, 0);
  assert.equal(removed.data.nextTriggerAt, null, '没有时刻规则就不报下次时间');
  assert.equal(removed.data.wakeAt, null);

  const ghost = await call(METHODS.SCHEDULE_REMOVE, { id: 'not-a-rule' });
  assert.equal(ghost.ok, false);
});
