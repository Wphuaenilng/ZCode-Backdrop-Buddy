import test from 'node:test';
import assert from 'node:assert/strict';
import { METHODS } from '../../shared/protocol/constants.mjs';
import { pickPrimary } from '../../kernel/host/detect.mjs';
import { blockValue, openWorld } from './helpers/fake-host.mjs';

test('多窗口：没加载完的新窗口不能把宿主判成未就绪', () => {
  const unready = { target: { id: 'a' }, page: { ready: false, loading: true } };
  const ready = { target: { id: 'b' }, page: { ready: true, loading: false } };

  assert.equal(pickPrimary([unready, ready])[0].target.id, 'b', '就绪的那个才是主目标');
  assert.deepEqual(pickPrimary([ready, unready]).map((entry) => entry.target.id), ['b', 'a'], '未就绪的留在后面当附加窗口');
  assert.deepEqual(pickPrimary([unready, { target: { id: 'c' }, page: null }]).map((entry) => entry.target.id), ['a', 'c'], '全都没就绪时保持原顺序');
  assert.deepEqual(pickPrimary([]), []);
});

test('多窗口：一个未就绪窗口在场时，应用与状态仍然正常', async (t) => {
  const { kernel, world, call } = await openWorld(t, { windows: [{ dark: false }, { dark: true, ready: false }] });
  t.after(() => kernel.close());

  const status = await kernel.ctx.host.detect({ force: true });
  assert.equal(status.ready, true, '宿主整体仍然算就绪');
  assert.equal(status.target.id, 'win-1', '主目标是那个已就绪的窗口');
  assert.equal(status.targets.length, 2);

  const saved = await call(METHODS.THEME_SAVE, { name: '带未就绪窗口' });
  const applied = await call(METHODS.THEME_APPLY, { themeId: saved.data.theme.id });
  assert.equal(applied.ok, true, JSON.stringify(applied.error || {}));
  assert.ok(world.list().every((win) => win.themeId === saved.data.theme.id), '两个窗口都打上皮（含还没加载完的那个）');
});

test('多窗口：一次应用同时打在每个渲染窗口上', async (t) => {
  const { kernel, world, call } = await openWorld(t, { windows: [{ dark: false }, { dark: true }] });
  t.after(() => kernel.close());

  const saved = await call(METHODS.THEME_SAVE, { name: '多窗口主题' });
  const applied = await call(METHODS.THEME_APPLY, { themeId: saved.data.theme.id });
  assert.equal(applied.ok, true, JSON.stringify(applied.error || {}));

  const windows = world.list();
  assert.equal(windows.length, 2);
  assert.ok(windows.every((win) => win.themeId === saved.data.theme.id), '两个窗口都要有本主题图层');
  // 两个窗口一浅一深：拿到的是同一份双模式 CSS，各自的块才校验得过
  assert.equal(windows[0].css, windows[1].css, '两个窗口收到的是同一份双模式 CSS');
  assert.ok(blockValue(windows[0].css, '--color-background', false), '浅色块存在');
  assert.ok(blockValue(windows[0].css, '--color-background', true), '深色块存在');
  assert.notEqual(blockValue(windows[0].css, '--color-background', false), blockValue(windows[0].css, '--color-background', true));

  const paused = await call(METHODS.THEME_PAUSE);
  assert.equal(paused.ok, true, JSON.stringify(paused.error || {}));
  assert.equal(paused.data.verified, true, '混合明暗下暂停也要按各自模式判定');
  assert.ok(world.list().every((win) => win.paused === true), '每个窗口都要真的暂停');

  const resumed = await call(METHODS.THEME_RESUME);
  assert.equal(resumed.ok, true, JSON.stringify(resumed.error || {}));
  assert.equal(resumed.data.verified, true);
  assert.ok(world.list().every((win) => win.paused === false));

  const restored = await call(METHODS.THEME_RESTORE);
  assert.equal(restored.ok, true, JSON.stringify(restored.error || {}));
  assert.ok(world.list().every((win) => win.themeId === null), '恢复时每个窗口都要清干净');
});

test('多窗口：新开的窗口在下次审计时自动补上皮，不用重新应用', async (t) => {
  const { kernel, world, call } = await openWorld(t, { windows: [{ dark: false }] });
  t.after(() => kernel.close());

  const saved = await call(METHODS.THEME_SAVE, { name: '补打主题' });
  const applied = await call(METHODS.THEME_APPLY, { themeId: saved.data.theme.id });
  assert.equal(applied.ok, true, JSON.stringify(applied.error || {}));
  assert.equal(world.list().length, 1);

  world.openWindow({ dark: true });
  const verdict = await kernel.ctx.host.audit({
    pointerValue: kernel.ctx.pointer.read(),
    adoption: null
  });
  const fresh = world.list().find((win) => win.id !== 'win-1');
  assert.equal(fresh.themeId, saved.data.theme.id, '新窗口应被补上同一个主题');
  assert.equal(verdict.windows.synced.length, 1, '审计结果要如实报告补打了一个窗口');
  assert.equal(verdict.windows.total, 2);
  assert.equal(kernel.ctx.host.status().applied.windows, 2, '状态里记录两个窗口');

  const restored = await call(METHODS.THEME_RESTORE);
  assert.equal(restored.ok, true, JSON.stringify(restored.error || {}));
  assert.ok(world.list().every((win) => win.themeId === null), '恢复要覆盖补打过的窗口');
});

test('多窗口：任一窗口注入失败时全部回滚', async (t) => {
  const { kernel, world, call } = await openWorld(t, { windows: [{ dark: false }, { dark: false, reject: true }] });
  t.after(() => kernel.close());

  const saved = await call(METHODS.THEME_SAVE, { name: '失败回滚' });
  const applied = await call(METHODS.THEME_APPLY, { themeId: saved.data.theme.id });
  assert.equal(applied.ok, false, '有一个窗口注入失败就整体失败');
  assert.equal(applied.error.code, 'HOST_INJECTION_REJECTED');
  assert.ok(world.list().every((win) => win.themeId === null), '已经打上的那个窗口也必须回滚干净');
  assert.equal(kernel.ctx.pointer.read().activeThemeId, null, '不留指针');
});
