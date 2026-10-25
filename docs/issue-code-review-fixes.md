# 代码审查问题修复清单（2026-10-22）

> **状态**：**已执行（2026-10-22）**。下方第 2–8 节保留为原始方案与判据记录；实际落地与偏差见「执行结果」。
>
> | 项 | 值 |
> | --- | --- |
> | 来源 | `/code-review-specialist` 全仓审查（`master` 尚无提交，按整仓快照审查，无 diff 归因） |
> | 版本基线 | 1.0.0（V1 已交付） |
> | 目标版本 | 1.0.1（P0 + P1）、1.0.2（P2） |
> | 问题数 | 原 15 项 + 复核新增 6 项（4.7、4.8、5.8、5.9、5.10、5.11） |
> | 本次实测 | 内核测试 **69/69**；UI 构建 208,049 B；Release 壳 115,200 B；完整 `build.ps1` 流水线通过 |

---

## 0. 执行结果（2026-10-22）

| 项 | 状态 | 落地位置 | 验证 |
| --- | --- | --- | --- |
| 3.1 删除时恢复未 await | 已修 | `kernel/handlers/theme-remove.mjs`（改 `await` + `restoreFailed`，并修正 `library.remove` 返回 Promise 的竞态） | `tests/kernel/theme-remove.test.mjs` 3 项 |
| 3.2 重启后暂停/继续/重置失效 | 已修（方案 A） | 新增 `kernel/store/runtime.mjs`；`adapter.adopt()`；`createKernel` 启动重采纳 | `tests/kernel/runtime-recovery.test.mjs` 2 项 |
| 4.1 全串行 + 背压未接通 | 已修 | `kernel/transport/stdio.mjs` 只读方法旁路；`LineWriter.onBackpressure` 接入 `input.pause/resume`；stdout 死亡释放 stdin | `tests/kernel/backpressure.test.mjs` 新增 3 项 |
| 4.2 同步大文件 I/O | 已修 | 包读取 `fs.promises` + `inflateRaw` 异步；`crc32` 用原生 `zlib.crc32`；导出异步原子写；视频复制异步 | 实测：导入 20.4 MB 视频 371 ms，期间 `status.get` 最大间隔 **24 ms** |
| 4.3 去重只按 id | 已修 | `RequestIdCache.keyFor(method, id)`；可重试失败不缓存；UI id 加会话前缀 | `router.test.mjs` 新增 3 项 |
| 4.4 卸载器信任环境变量 | 已修 | `build/setup.iss` `IsBackdropBuddyDataDir`；`install/data-policy.ps1` 形状校验 | `installer-data-policy.test.mjs` 4 项 |
| 4.5 DevTools + 任意路径 | 已修（**未改协议**） | Release 下 DevTools 仅认 `BACKDROPBUDDY_DEVTOOLS=1`；路径策略放在壳的信任边界（`Infrastructure/PathTokens.cs` + `ProtocolBridge` 令牌解析/`PATH_OUT_OF_POLICY`），内核协议字段不变 | Release 编译通过；令牌策略为编译级验证，**未做运行时自动化** |
| 4.6 缓存/备份/日志只增不减 | 已修 | 启动清 30 天缓存、backup 每类保留 40、`kernel.log` 8 MB 轮转 `.1`、`.old-*` 残留清理、`library.stats()` 60 s 缓存 | `maintenance.test.mjs` 6 项 |
| 4.7 冷启动不读 stdin | 已修 | `main.mjs` `deferSeeding` + 先 `attachStdio`；`theme.list` 等待播种 | 实测冷启动 `system.hello` **4,731 → 335 ms** |
| 4.8 预览副本无上限 | 已修 | 壳侧 64 MB 上限 + 先建后裁剪；大文件跳过预览并提示 | 代码级；无 UI 自动化 |
| 5.1 `file.pick` 能力表不一致 | 已修 | `buildCapabilities` 排除壳方法；hello 新增 `localMethods` | `kernel.test.mjs` 断言 |
| 5.2 README 与实现不一致 | 已修 | 设置页新增“我的主题”改名；README 的入口/改名/预留配置措辞对齐；PLAN 补 2026-10-22 现状注记 | UI 构建通过 |
| 5.3 遗留原型文案/版本 | 已修 | 删除 `ZCode 注入在 P4`；UI 版本改由 `build/version.json` 经 Vite `__APP_VERSION__` 注入；内核版本读 `VERSION`/`version.json` | 构建通过 |
| 5.4 导入边界与内容类型 | 已修 | JSON ≤ 1 MiB；包内媒体统一改写为 `media.<ext>`、缩略图 `thumb.<ext>` | `import-hardening.test.mjs` 2 项 |
| 5.5 主题 ID 碰撞 | 已修 | `allocateThemeId()` 生成后存在性检查、最多重试 5 次 | `import-hardening.test.mjs` 碰撞重试用例 |
| 5.6 内置主题参数只存 localStorage | 已修 | `config.builtinOverrides` + `settings.set` 白名单；UI 从 `settings.get` 读回 | 内核测试通过；无 UI 自动化 |
| 5.7 死代码与结构 | 部分完成 | 删除 `parseMediaUrl`、`PointerStore.snapshot()`、无人调用的 `backup/prune.ps1`；模块计数 78、脚本计数 30 | `modules.test.mjs`、`powershell.test.mjs` |
| 5.8 响应序列化异常丢包 | 已修 | `stdio.mjs` 序列化失败发 `INTERNAL` 失败信封；事件序列化失败只记日志 | 代码级 |
| 5.9 `suggestedName` 未净化 | 已修 | 壳 `SanitizeFileName`（取文件名 + 去非法字符 + 长度上限） | 代码级 |
| 5.10 删除后 `selectedThemeId` 悬空 | 已修 | `restoreThemeState` 与删除失败路径同时清 `selectedThemeId`/`lastAppliedThemeId` | `theme-remove.test.mjs` 断言 |
| 5.11 宿主重启后复用旧 `hostHash` | 已修 | `hostHash.targetId` + 仅同 target 复用；`snapshot` 随运行态持久化 | `runtime-recovery.test.mjs` 断言 |

**未做 / 明确偏差**

- **5.7 的结构性重构未做**：`adapter.apply` 拆分、壳拆三个类、内核/UI 双份主题目录合并。理由：无行为收益、回归面大，且当前没有 UI/壳自动化能兜住。留作独立重构。
- **5.12（壳/UI/桥的自动化测试骨架）不在原文档内**，本轮未引入测试框架；4.5、4.8、5.6、5.9 因此只有编译级验证，见上表。
- **4.5 未改协议**：令牌解析放在壳里，内核仍收 `path`/`destPath`。原文档第 8 节问题 2 按“不改协议”处理。
- 未做干净机验收、未重签安装包、未在真实 ZCode 上跑完整 UI 链路（仅内核级 fake host/CDP）。

**本轮真跑过的命令与读数**

| 命令 | 结果 |
| --- | --- |
| `node --test tests/kernel/*.test.mjs` | **69 pass / 0 fail**（约 9.5 s） |
| `npm run build`（ui） | `dist/index.html` **208,049 B** / 262,144 上限 |
| `MSBuild ... -p:Configuration=Release` | `BackdropBuddy.exe` **115,200 B** |
| `build/build.ps1 -OutputRoot build/out-verify` | 全流程通过：UI → 69/69 → MSBuild → stage（134 文件）→ layout → manifest → ZIP |
| 冷启动探针（`kernel/main.mjs` + `system.hello`） | 改前 4,731 ms / 改后 **335 ms**；`theme.list` 335+759 ms |
| 20.4 MB 视频导入探针 | 导入 371 ms、导出 43 ms、包回导 178 ms、`status.get` 最大间隔 **24 ms** |

> 注：`build/out/` 下的 1.0.0 交付物（含安装包 44,848,478 B）已按当前源码重新生成，时间戳 2026-10-22 20:29；`build/out-verify/` 是本次隔离验证构建（20:34）。两者都来自同一份工作区源码，未做签名。

---

## 1. 实测基线（写文档前真正跑过的）

| 命令 | 结果 |
| --- | --- |
| `node --test tests/kernel/*.test.mjs` | **44 pass / 0 fail / 5.5 s**（含 media、host、pack、powershell） |
| `platform/windows/backup/host-hash.ps1 -HostRoot F:\shop\ZCode` | **real 2.991 s**，`count=16`，其中 `resources/app.asar` 为 341,334,118 B |
| `platform/windows/host/detect.ps1 -ExePath ... -Port 9229` | **real 1.480 s**，返回 ZCode 3.16.2、PID、ownership |
| fake host 触发 `theme.remove` | 响应 `ok=true` 后内核进程因未处理拒绝崩溃（见 3.1） |
| 新建 `createHostAdapter` 后直接 `pause/resume/reset` | 三项均返回 `BAD_PARAMS: no theme is applied`（见 3.2） |
| 同一 `id` 先发 `system.hello` 再发 `system.ping` | 第二次返回 hello 的缓存结果，`ping` 未执行（见 4.3） |

未执行：对 ZCode 的真实注入/恢复（避免改动当前宿主状态）；壳与 UI 的端到端脚本。PLAN 中的宿主聚合哈希 `49297d8c…` / 总量 569,585,967 B 属历史文档记录，本次未复核。

---

## 2. 问题总览

| # | 严重 | 区域 | 一句话 | 验收方式 |
| --- | --- | --- | --- | --- |
| 3.1 | P0 | 内核/主题删除 | 删除运行中主题时恢复未 await，恢复失败即内核崩溃 | 新增单测 + 现有 44 项仍绿 |
| 3.2 | P0 | 内核/宿主状态 | 内核或壳重启后暂停、继续、重置全部报 `no theme is applied` | 新增重启回归测试 |
| 4.1 | P1 | 内核/传输 | 所有请求串行，`status.get` 旁路与背压实际未接通 | 单测证明旁路可并发 + 背压回调被触发 |
| 4.2 | P1 | 性能/资源 | 同步读写大文件与逐字节 CRC 阻塞整个内核 | 大文件用例期间 `status.get` 仍能返回 |
| 4.3 | P1 | 协议/正确性 | 去重只按 `id`，UI 重载后复用 id 拿到陈旧响应 | 新增单测（改前必失败） |
| 4.4 | P1 | 安装/数据安全 | 卸载器信任 `BACKDROPBUDDY_DATA_DIR` 并递归删除 | 脚本单测：非数据目录被拒绝 |
| 4.5 | P1 | 安全/加固 | 正式版开 DevTools + 内核接受任意路径 | 编译期开关 + 路径令牌用例 |
| 4.6 | P1 | 性能/运维 | 缩略图缓存、backup、日志只增不减 | 启动后计数对账（前后有数字） |
| 5.1 | P2 | 协议/一致性 | 内核 `file.pick` 是 `NOT_IMPLEMENTED` 却进能力表 | `system.hello` 能力表与实际一致 |
| 5.2 | P2 | 完成度/文档 | README 的"重命名"、设置页导入导出、`applyOnStart` 与实现不符 | 文案与代码二选一对齐 |
| 5.3 | P2 | UI 文案 | 遗留 `ZCode 注入在 P4`、`本地版 v0.2` | 版本号单一来源 |
| 5.4 | P2 | 健壮性 | `.json` 主题导入无大小上限；包内媒体保留原名落盘 | 超大/畸形包用例 |
| 5.5 | P2 | 健壮性 | 自动生成主题 ID 前不做存在性检查 | 冲突即重试的用例 |
| 5.6 | P2 | 数据一致性 | 内置主题参数改动只存 localStorage，不进内核 | 清 WebView2 数据后行为有明确定义 |
| 5.7 | P2 | 可维护性 | 死代码、重复主题目录、超大函数 | 删除清单 + 计数测试更新 |

---

## 3. P0 详述

### 3.1 删除运行中主题会让内核崩溃

**位置**
- `kernel/handlers/theme-remove.mjs:8` — `if (ctx.pointer.read().activeThemeId === themeId) restoreThemeState(ctx);`
- `kernel/handlers/theme-state.mjs:133` — `const result = await ctx.host.restore();`

**根因**：`restoreThemeState` 是 async 但既未 await 也未 catch。宿主页面未就绪、CDP 断开或恢复校验失败时，Promise 变成未处理拒绝；Node 22 默认行为是抛出并退出进程。删除结果已经返回，指针也已经指向被删主题，崩溃后状态无法自洽。

**复现**（写进测试前的手工验证）：注入一个 `host.restore` 抛错的 fake host，`theme.apply` 后 `theme.remove` → 响应 `ok=true`，紧接进程崩溃退出。

**修复方案**
1. `theme-remove.mjs` 改为 `await`，并把恢复结果并入响应：

```js
registry.register(METHODS.THEME_REMOVE, METHOD_SCHEMAS[METHODS.THEME_REMOVE], async ({ themeId }) => {
  const result = ctx.library.remove(themeId);
  const wasActive = ctx.pointer.read().activeThemeId === themeId;
  if (!wasActive) return result;
  try {
    return { ...result, restore: await restoreThemeState(ctx) };
  } catch (error) {
    return { ...result, restoreFailed: { code: error.code || 'INTERNAL', message: error.message, retryable: !!error.retryable } };
  }
});
```

2. `restoreThemeState` 内先 `ctx.pointer.clear()` 再做宿主恢复，保证"删除已发生"与"指针已清"不因宿主失败而脱节；失败信息只作为响应字段返回。
3. UI（`ui/src/App.jsx` `deleteTheme`）在 `restoreFailed` 时提示"主题已删除，但宿主注入未撤销，可再次点击恢复原貌"，而不是静默。

**验收判据**
- 新增 `tests/kernel/theme-remove.test.mjs`：fake host 的 `restore` 抛错时，`theme.remove` 返回 `ok=true` 且 `restoreFailed.code` 存在，测试进程不崩溃（无未处理拒绝）。
- 正常路径：删除活动主题后 `status.get` 的 `running` 为 `false`。
- `node --test tests/kernel/*.test.mjs` 全绿。

**风险**：删除响应耗时增加（宿主恢复串行）；与 4.1 的并发改造叠加时需注意别引入竞态，建议先做 3.1 再做 4.1。

---

### 3.2 内核重启后暂停 / 继续 / 重置失效

**位置**
- `kernel/host/adapter.mjs:356` — `state = { ... }`（仅内存）
- `kernel/host/adapter.mjs:408` — `if (!state) throw fail('BAD_PARAMS', 'no theme is applied');`（`setPaused`）
- `kernel/host/adapter.mjs:452` — 同样的守卫（`reset`）
- `kernel/handlers/status.mjs:17` — `running` 只看指针
- `kernel/host/adapter.mjs:278-288` — 重启后 `baseline` 只能重新抓取

**根因**：`pointer.json` 持久化了"哪个主题在活动、是否暂停"，但宿主适配器的运行态（`baseline`、`tokens`、`hostHash`、`targetId`、`cssPath`、`paused`）只在内存。壳重启、内核崩溃自动重启（`KernelProcess` 会重启一次）之后，`status.get` 说在运行，而 `pause/resume/reset` 全部 `BAD_PARAMS`。若此时重新应用，`takeBaseline` 会把已被注入的页面当成"注入前"，导致恢复的 `tokenMatch` 判定失真。

**复现**：对新建的 `createHostAdapter` 直接调用 `pause`/`resume`/`reset`，三项都返回 `BAD_PARAMS: no theme is applied`。现有 `tests/kernel/pack.test.mjs` 只断言重启后 `status.running === true`，没测控制能力，因此漏网。

**修复方案（推荐 A，需在审批时确认）**
- **A. 持久化运行态并在启动时重采纳**（推荐）
  1. 新增 `kernel/store/runtime.mjs`：`RuntimeStateStore`，写入 `<dataRoot>/themes/runtime.json`，字段 `themeId, params, tokens, tokensByMode, baseline, hostHash, targetId, targetFingerprint, cssPath, paused, appliedAt`，复用 `writeJsonAtomic`。
  2. `adapter.apply/pause/resume/reset/restore` 在改完内存 `state` 后落盘；`restore` 成功即删除该文件。
  3. `createKernel` 构造 adapter 后调用 `adapter.adopt(pointer)`：读 `runtime.json`；若缺失或 `targetFingerprint` 与当前页面不符且页面已无 `#backdropbuddy-theme`，直接清指针并返回；若页面仍有注入，恢复 `state`（含 baseline），使暂停/继续/重置/恢复可用。
  4. 快照文件（`backup/snapshot-*.json`）继续作为审计记录，运行态以 `runtime.json` 为唯一来源，避免双写歧义。
- **B. 启动即恢复原貌**（保守替代）：`createKernel` 发现指针活动但无内存 state 时，先 `restore()`，若 `applyOnStart` 为真再重新 apply。实现量小，但会打断"重启后皮肤还在"的既有产品语义。

**验收判据**
- 新增 `tests/kernel/runtime-recovery.test.mjs`：
  - 用 fake host + fake CDP 状态（`injected: true`）跑两个共享同一 `dataDir` 的 kernel 实例；第一个 apply 后关闭，第二个实例的 `theme.pause`、`theme.resume`、`theme.reset` 均成功，`status.get` 的 `host.applied.themeId` 与指针一致。
  - 页面已无注入（`injected: false`）时，第二个实例启动后 `status.get.running === false`，指针被清。
- 手工验证（需 ZCode 在线）：应用 → 完全退出 BackdropBuddy → 重新启动 → 暂停/继续/恢复各一次，`backup/restore-*.json` 的 `verification.tokenMatch` 不为 `false`。

**风险**：新增磁盘状态文件与删除逻辑，需同步更新 `docs/README.md` 的数据目录图；`runtime.json` 损坏时必须能安全降级为"无运行态"。

---

## 4. P1 详述

### 4.1 请求全串行，`status.get` 旁路与背压未接通

**位置**：`kernel/transport/stdio.mjs:12`（`let chain = Promise.resolve();`）、`kernel/transport/stdio.mjs:10`（`writer = new LineWriter()` 未传 `onBackpressure`）、`kernel/protocol/router.mjs:61-66`（`statusBusy`/`BUSY`）、`kernel/transport/line-writer.mjs:2`。

**问题**：`onLine` 把每条消息挂到同一条 Promise 链，任何时刻只有一个请求在飞。于是（1）一次 `theme.apply`（本机估算 5–9 s：detect 1.5 s + 4 次 PowerShell 往返 + 首次 host-hash 3.0 s + CDP）期间 `status.get`、`system.ping`、`log.tail` 全部排队；（2）`status.get` 的并发守卫分支在真实链路上不可达，只有直接调 `Router` 的单测能命中；（3）`LineWriter.onBackpressure` 从未被接进 `input.pause()/resume()`，PLAN 6.1 的"背压暂停 stdin"只在 `tests/kernel/backpressure.test.mjs` 的 mock stream 上成立。

**修复方案**
1. `stdio.mjs` 分双通道：只读方法（`status.get`、`system.ping`、`log.tail`、`host.status`、`media.url`）不进串行链，直接并发执行；写方法继续 `chain`。响应写出一律经 `LineWriter`，顺序不保证但对 UI 按 `id` 路由无影响。
2. `attachStdio` 构造 writer 时传入：

```js
const writer = new LineWriter({
  onBackpressure: (pressed) => { if (pressed) input.pause(); else input.resume(); }
});
```

3. `status.get` 去掉 `store: ctx.library.stats()` 的同步全盘扫描（见 4.6），改为内存计数 + 异步刷新。

**验收判据**
- 新增测试：一个延迟 200 ms 的 `theme.apply` 在飞时，通过 `attachStdio` 喂入两行 NDJSON，`status.get` 必须在 `theme.apply` 之前返回（证明旁路）。
- 背压测试改为经 `attachStdio` 装配：慢 stdout 时断言 `input.pause` 被调用、恢复后 `input.resume` 被调用。
- 现有 44 项不回归。

**风险**：并发后 `RequestIdCache`、`pointer`、`config` 的写入次序需复查；`KeyedMutex('themes')` 已覆盖主题目录写，但 `pointer.write` 目前无锁，建议在同一批里给它加锁。

---

### 4.2 同步大文件 I/O 阻塞事件循环

**位置**：`kernel/store/library.mjs:82`（`fs.readFileSync(packPath)`）、`kernel/store/library.mjs:125`（`fs.writeFileSync(stagedMedia, mediaBytes)`）、`kernel/store/atomic.mjs:253`（`inflateRawSync`）、`kernel/store/atomic.mjs:100`（逐字节 CRC32）、`kernel/media/video.mjs`（`fs.copyFileSync` 复制整个视频）。

**问题**：导出/导入 100 MB 级视频主题时，内核同步读全文件、同步 inflate、逐字节算 CRC、同步复制，期间整个 stdio 停摆（在 4.1 修复前连 `system.ping` 都无法响应），内存峰值可达文件大小的 2–3 倍。

**修复方案**
1. 媒体复制改 `fs.promises.copyFile`；包读取改 `fs.promises.readFile`（仍在总量上限内）或按条目流式解压。
2. CRC32 用表驱动的分块实现或直接 `zlib.crc32`（Node 22.2 起可用则采用，需先在本机确认存在；不存在则保留现实现但每 8 MB 让出一次事件循环）。
3. `createZip` 的 entries 在总大小超过阈值（建议 64 MB）时改为"逐条压缩 + 追加写文件"，不再一次性 `Buffer.concat`。

**验收判据**
- 新增测试：导入 ≥50 MB 素材（用 `assets/original.mp4` 复制放大或现有素材），期间并发 `status.get` 能在 500 ms 内返回。
- 记录改前/改后同一包的导入耗时与 RSS 峰值（两个数字都要打印，不能只说"更快"）。

---

### 4.3 去重只按 `id`，UI 重载后返回陈旧响应

**位置**：`kernel/protocol/router.mjs:49`、`ui/src/bridge.js:9` 与 `:41`（`let seq = 0` → `ui-${++seq}`）。

**已复现**：同一 Router 上 `id=ui-1` 先发 `system.hello` 再发 `system.ping`，第二次直接返回 hello 的缓存结果，`ping` 未执行。

**问题**：UI 每次页面加载都从 `ui-1` 重新计数，而内核 1024 窗口内的缓存跨重载存活（内核只在崩溃/关闭时才丢缓存）。WebView2 里刷新、崩溃恢复或调试器重载后，`theme.list` 可能返回旧列表、`theme.apply` 可能返回上一次操作的"成功"，属于静默假成功。

**修复方案（两处都做）**
1. UI：`bridge.js` 页面加载时生成会话前缀 `const session = Math.random().toString(36).slice(2, 8)`，ID 变成 `ui-<session>-<seq>`；协议字段形状不变。
2. 内核：`RequestIdCache` 的键改为 `id` + 方法（`method + '\u0000' + id`），或在 `Router` 层对同一 `id` 的不同 `method` 返回 `BAD_PARAMS: request id reused with different method`。建议方案前者（保持"重复 id 直接返回原结果"的既有语义）。

**验收判据**
- 新增单测：`id` 相同但 `method` 不同 → 第二个请求真正执行（改前该用例必须失败，作为回归证据）。
- 新增单测：`id` 与 `method` 都相同 → 仍返回缓存、handler 只调用一次。

---

### 4.4 卸载器对数据目录不做形状校验

**位置**：`build/setup.iss:143`（`GetEnv('BACKDROPBUDDY_DATA_DIR')`）、`:152` 与 `:168`（`DelTree(DataDir, True, True, True)`）。

**问题**：卸载时把环境变量指向的目录整体递归删除。若便携模式下用户把它设成盘符根、用户主目录或某个共享目录，`/PURGEDATA=1` 或点了"是"之后就是不可逆的数据丢失。

**修复方案**
1. 在 `DelTree` 前加 `IsBackdropBuddyDataDir(DataDir)`：要求目录内存在 `themes` 子目录**且**（`config.json` 或 `themes\pointer.json` 或 `themes\user`），并且不是盘符根（`GetCurDir`/去掉尾分隔符后仍含 `\`）、不是 `{localappdata}`、`{userdocs}`、`{src}` 等已知目录。
2. 校验失败时不删除，只写日志并弹一次提示："BACKDROPBUDDY_DATA_DIR 指向的目录不像 BackdropBuddy 数据目录，已保留：<path>"。
3. 同步收紧 `platform/windows/install/data-policy.ps1`：它已做 `StartsWith(root)` 检查，但没有形状校验；加同样的特征判断。

**验收判据**
- 新增 `tests/kernel/installer-data-policy.test.mjs`（PowerShell 侧）：对伪造的合法数据目录 → 允许；对盘符根 / 空目录 / 缺 `themes` 的目录 → 拒绝，输出 `ok=false` 与原因。
- Inno 脚本改动无法单测，需在 P7 复验清单里补一条手工用例：`BACKDROPBUDDY_DATA_DIR` 指向不含特征文件的目录，`/PURGEDATA=1` 卸载后目录仍在。

---

### 4.5 DevTools 与"内核接受任意路径"

**位置**：`src/BackdropBuddy.Shell/MainWindow.xaml.cs:94`、`:100-111`（三个虚拟域映射，`ThemesRoot` 整目录）、`kernel/store/library.mjs:369`（导入任意路径）、`:448`（导出到任意路径）、`kernel/handlers/file.mjs:10`（`file.validate` 任意路径）。

**问题**：正式版开着 DevTools，页面控制台可直接 `window.chrome.webview.postMessage` 发协议请求；内核侧 `theme.import` / `theme.export` / `file.validate` 完全信任 UI 传来的路径。今天没有远程攻击面（本地桌面、CSP 严格、无导航），但一旦 UI 出现脚本注入或有人调试，就从"页面执行"升级成"任意本地文件读/写"。属于纵深防御缺口。

**修复方案**
1. DevTools 用编译开关：`#if DEBUG core.Settings.AreDevToolsEnabled = true; #else ... = IsDevToolsAllowedByEnv();`，只认 `BACKDROPBUDDY_DEVTOOLS=1`；这样诊断场景仍可用，正式版默认关闭。
2. 文件令牌化：`file.pick` 成功后，壳把路径登记为一次性令牌（`fp-<guid>`，10 分钟有效，内存字典 + 记录数量上限），返回给 UI 的是 `{ token, name, kind, bytes, previewUrl }`；`theme.import` / `theme.export` / `file.validate` 接受 `token` 或 `path`，但只有当 `path` 位于 `<dataRoot>/exports` 或匹配某个未消费令牌时才放行。
3. 导出目标路径同样只接受 `save` 对话框返回的令牌，防止 UI 直接指定任意写路径。

**验收判据**
- Release 构建启动后按 F12/右键无 DevTools；带 `BACKDROPBUDDY_DEVTOOLS=1` 时可打开。
- 新增单测：`theme.import { path: 'C:/Windows/win.ini' }` 返回 `PATH_OUT_OF_POLICY`（新错误码）；经 `file.pick` 得到的 token 走同一流程成功；token 重复消费第二次失败。
- UI 三个调用点（`ui/src/App.jsx` 的 `pickMedia`、`pickPack`、`exportNative`）改为传 token。

**风险**：会改协议字段。需要在 `docs/PLAN.md` 3.3 方法表同步，并考虑对 `path` 保留一个兼容分支（`BACKDROPBUDDY_ALLOW_RAW_PATH=1`）便于手工脚本；默认关闭。

---

### 4.6 缓存、备份、日志只增不减

**位置**：`kernel/media/cache.mjs:13`（`cleanCache` 定义但无人调用）、`kernel/store/atomic.mjs:10`（`writeFileAtomic` 每次 apply 产生新 CSS 文件）、`platform/windows/backup/prune.ps1`（存在但内核未调用）、`kernel/util/logger.mjs:32`（`appendFileSync` 无轮转）、`kernel/store/stats.mjs:4-8`（`status.get` 每次全盘 `directorySize`）。

**问题**：每次应用写 `backup/apply-*.css`，每次 apply/restore 写快照与恢复报告；缩略图按 sha 永久留在 `cache/`；`kernel.log`/`shell.log` 无上限。长期用户的 `backup` 会出现成百上千小文件，`status.get` 又每次都遍历。

**修复方案**
1. `createKernel` 启动阶段（`library.init()` 同一处）调用 `cleanCache(paths.cache)`（保留 30 天）与 `cleanupStaging`，并对 `paths.backup` 做保留 N=40 的裁剪（复用 `prune.ps1` 语义，但用 Node 侧实现，避免多起一个 PowerShell 进程）。
2. `Logger` 加最大字节数（建议 8 MB）与一代归档（`kernel.log.1`）。
3. `status.get` 不再实时 `directorySize`：`storeStats` 结果按 60 s 缓存，或由后台 `setImmediate` 刷新；`theme.list` 复用同一份主题缓存。

**验收判据**
- 启动前后打印 `backup` 与 `cache` 的文件数与字节数（两个数都要有，作为"确实清过"的证据）。
- 新增单测：预置 60 个 `snapshot-*.json`，启动后只剩 40 个。
- 日志超过阈值后轮转，`log.tail` 仍返回内容。

---

## 5. P2 详述

### 5.1 `file.pick` 的内核桩与能力表不一致
`kernel/handlers/file.mjs:6` 注册后直接抛 `NOT_IMPLEMENTED`，而 `kernel/app/capabilities.mjs:1` 把注册表全部方法（除 `system.shutdown`）当能力广播。修：`buildCapabilities` 排除桩方法，或让内核 handler 返回 `LOCAL_ONLY` 并在 `system.hello` 里单列 `localMethods: ["file.pick","shell.settings.get","shell.settings.set"]`，UI 与文档按此判定。

### 5.2 文档与实现不一致
- `docs/README.md:13` 宣称"重命名"，但 `ui/src/components/SettingsView.jsx` 只有显示/取景参数，没有名称输入；内核 `theme.save` 其实支持改名。修：在设置页加名称字段（`maxLength=24`），或在 README 删掉"重命名"。
- `docs/README.md:64` 把主题包导入导出写在"设置"页，实际入口在控制台。
- `docs/README.md:127` 已承认 `applyOnStart`/`reducedMotion` 无 UI；若本轮不动设置页，`settings.set` 收到这两个键但无人读取（全仓无消费点），应在 `docs/PLAN.md` 9.2 明确"V1.1 实现"，否则属于可执行但无效的假配置。

### 5.3 遗留原型文案
`ui/src/App.jsx:383` 的"ZCode 注入在 P4"、`:811` 的"本地版 v0.2"。修：`dryRun` 分支在真实注入落地后删除；版本号从 `build/version.json` 注入到 UI（构建期替换），与内核 `backdropbuddy-kernel/1.0.0`、壳 `1.0.0.0` 单一来源。

### 5.4 导入的边界与内容类型
`kernel/store/library.mjs:379` 的 `readJson(sourcePath)` 无大小上限；`kernel/store/library.mjs:121-135` 按包内原名（仅禁斜杠）落盘媒体。修：`stat` 后限制 JSON ≤ 1 MiB；媒体统一重命名为 `media.<由探测 mime 决定的扩展名>`、缩略图 `thumb.jpg`，不信任包内文件名（也顺带消除 `CON`/`NUL` 等保留名写入失败）。

### 5.5 主题 ID 生成不做存在性检查
`kernel/store/library.mjs:114`、`:180`、`:391` 只在调用方显式传 `id` 时 `assertNewId`；`kernel/store/record.mjs:33` 的自动生成（时间戳 base36 + 4 位随机）落在极小碰撞窗口时，`tx.commit` 会 `moveDirAtomic` 覆盖已有主题目录。修：生成后同样走 `assertNewId`，冲突则重试（上限 5 次）。

### 5.6 内置主题参数改动只存浏览器存储
`ui/src/App.jsx` 的 `setThemeParams` 对 builtin 只写 `library.overrides`（localStorage），内核侧内置主题不可 `theme.save`（`kernel/store/library.mjs:325` 明确拒绝）。结果是 WebView2 用户数据被清或换机器后，这些自定义丢失。修：把 overrides 落到内核 `config.json`（新增 `builtinOverrides` 对象，走 `settings.set` 白名单），UI 改为从 `settings.get` 读取。

### 5.7 死代码与结构
- 未被引用：`kernel/media/url.mjs:11` `parseMediaUrl`、`kernel/store/pointer.mjs:41` `snapshot()`、`kernel/media/cache.mjs:13` `cleanCache`（本清单 4.6 会把它接上）、`platform/windows/backup/prune.ps1`（4.6 决定改用 Node 后即成为冗余，需要一并删除或接上）。
- 主题目录双份：`kernel/store/catalog.mjs` 与 `ui/src/data/themes.js` 各维护 20 个内置主题的名称/标签/accent。修：由一份 JSON 生成两端（或 UI 运行时从 `theme.list` 拿数据，只保留预览用的 `bg` 渐变）。
- 超长：`kernel/host/adapter.mjs:261-405` `apply` 约 145 行；`src/BackdropBuddy.Shell/MainWindow.xaml.cs` 535 行。修：`apply` 拆 `resolveDesignTokens` / `writeArtifacts` / `injectAndVerify`；壳把托盘、文件选择与预览、窗口状态拆成 `Infrastructure` 下三个类。
- 测试计数断言：`tests/kernel/modules.test.mjs` 断言 77、`tests/kernel/powershell.test.mjs` 断言 31。任何新增/删除模块或脚本都必须同步这两个数字，否则测试即失败。

---

## 6. 执行批次与顺序

| 批次 | 内容 | 预估 | 完成定义 |
| --- | --- | --- | --- |
| **B1（1.0.1）** | 3.1、3.2 | 0.5–1 人日 | 两个新回归测试落地并通过；`node --test` 全绿；手工：删除运行中主题 + 重启后暂停/继续/恢复 |
| **B2（1.0.1）** | 4.3、4.1、4.6 | 1 人日 | 旁路与背压有测试证据；重启后 `backup/cache` 文件数下降并有前后计数；去重不再返回陈旧响应 |
| **B3（1.0.2）** | 4.4、4.5、4.2、5.4、5.5 | 1.5–2 人日 | 数据目录形状校验生效；Release 无 DevTools；大文件导入期间 `status.get` 可响应；畸形包用例通过 |
| **B4（随版本）** | 5.1、5.2、5.3、5.6、5.7 | 1 人日 | 文档与实现一致；版本号单一来源；死代码清单为空；两个计数测试同步更新 |

建议严格按 B1 → B2 顺序：3.1 是崩溃、3.2 是功能失效，两者都能在 1 天内闭环；4.1 的并发改造会改变请求时序，必须在 3.1 之后做，避免同时改两处删除/恢复路径。

每批完成后的统一动作：`node --test tests/kernel/*.test.mjs`、`build\build.ps1`（含 UI 构建与 CSP 注入、体积上限）、`install/doctor.ps1` 或对应手工清单。**不自动 git 提交**，改动留在工作区由你决定提交节奏。

---

## 7. 本轮不处理（明确砍掉）

- 多宿主 target profile（Codex 等）、自动更新、主题市场、在线账号 — V2。
- 代码签名（安装包/ exe）— 属采购与流程，不是代码问题。
- UI 内启动/重启 ZCode（`platform/windows/host/launch.ps1`、`stop.ps1` 接入）— V1.1 独立特性，不混进修复批次。
- ffmpeg/ffprobe 随包携带 — 已决定不携带，本轮不改。
- 全新 Windows 用户机与 WebView2 缺失分支实机复验 — 需另一台机器，属验收而非修复。
- 重写为流式 ZIP 库（引入依赖）— 4.2 先用"分块 + 让出事件循环"，不引第三方库。

---

## 8. 需要你在审批时确认的三件事

1. **3.2 走 A 还是 B**：建议 A（新增 `runtime.json` 持久化运行态并启动时重采纳），因为它保住"重启后皮肤继续运行且可暂停"的既有产品语义；B（启动即恢复原貌）实现更省但改变语义。
2. **4.5 是否改协议**：文件令牌化会新增 `token` 字段与 `PATH_OUT_OF_POLICY` 错误码。若不想动协议，本项降级为"仅关闭 DevTools + 限制导出目录在 `exports/` 内"。建议按完整方案做，兼容分支默认关闭。
3. **5.2 的取舍**：「重命名」补 UI 入口，还是从 README 删除该说法？建议补入口（内核已支持，工作量约 20 行）。

未特别指出的项，默认按本文建议方案执行。
