# 启动动画设计与实现记录

> 更新：2026-10-27
> 范围：宿主（ZCode / Codex 等）启动动画为主线；BackdropBuddy 自身 Splash 为独立支线
> 当前状态：**自身 Splash 与宿主静态启动动画主线已实现；Phase 0–2 已完成，Phase 3 核心链路与 P3-4 安装文件哈希验收通过；P3-6 的真实减少动态效果与四档 DPI 已通过，多显示器仍未覆盖，故该项为部分通过**
> 事实来源：ZCode 安装包源码、真实 ZCode CDP 实测、本机日志、BackdropBuddy 当前代码

## 0. 当前结论（先读）

宿主启动动画当前由早期 CDP 注入器、固定模板和启动编排共同实现：**由 BackdropBuddy 启动宿主时，用所选自己的主题的静图与固定预设尽早覆盖默认启动页，在宿主就绪后自动交还，全程不修改宿主安装文件。** V1 不包含启动视频或音频。

旧的“页面启动后再覆盖视频”方案已被早期注入实现取代，不再是当前交付路径。首帧 spike 与真实生产链路均已取得通过证据，但不把这些结果扩大解释为所有显示环境、所有输入方式或所有宿主均已验收。

### 0.1 已实现内容

- `kernel/host/startup-injector.mjs` 在宿主页面脚本执行前挂接浏览器级 CDP，使用 `Target.setAutoAttach(waitForDebuggerOnStart)` 与 `Page.addScriptToEvaluateOnNewDocument`，并及时恢复页面；800ms watchdog 与断连恢复用于避免暂停目标后卡死。
- `kernel/host/startup-template.mjs` 提供固定模板：`zcode-pop` 与 `theme-reveal` 两种预设、主题静图背景、900–3000ms 最短停留、900ms 跳过保护、约 3.5 秒硬截止、reduced-motion 静态效果与单次显示守卫。`#loading` 只设为透明，不删除、不接管宿主状态机。
- 主题记录的 `startup` 模型包含 `enabled / preset / holdMs / media`；仅自己的主题可编辑，旧主题与旧 `.bbskin` 默认关闭，主题包导入导出保留启动配置。素材只接受主题目录内的 JPEG / PNG / WebP，最大 500 KiB，并校验文件内容与路径边界。
- 设置入口为 **设置 → 主题参数 → 宿主启动动画**；保存后可打开 sandbox iframe 预览。**设置 → 应用偏好 → 启动宿主**用于确认启动或重启。
- `kernel/host/adapter.mjs` 与 `platform/windows/host/restart.ps1` 负责临时配置、启动前注入和结果回收；只对 BackdropBuddy 新启动的宿主生效，直接双击不触发。注入失败回退默认启动画面，不影响换肤。
- BackdropBuddy 自身 Splash 保持独立品牌链路，不播放宿主主题启动动画。
- 自动化测试共 144 项：使用复制到隔离目录的本机 `ffmpeg` / `ffprobe` 9.0.2 后，144 通过、0 跳过、0 失败；媒体工具不随发布包分发。UI 构建与产物级 JSDOM 冒烟通过。

### 0.2 本轮实测结果

| 项目 | 实测结论 | 判定 |
| --- | --- | --- |
| 首帧 spike | 修正“`#loading` 不存在被误判为可见”的复核规则后，普通启动 20/20 通过，另有 1 次强杀恢复通过；20 轮截图的前三帧均为红色测试层，样式安装均早于首帧采样 | 通过原 Gate；不宣称绝对零闪屏 |
| spike 时序 | 端口开放到 attach 中位数 327.5ms、范围 223–1075ms；注册中位数 133ms、范围 107–143ms；脚本执行 102.7–114.5ms；样式安装 157–172.8ms；首帧采样 180–220ms | attach 未达到原计划 ≤300ms 目标，保留该偏差 |
| 真实跳过 | `zcode-pop` 的 900ms 保护期内按钮 click 被忽略；保护期后 CDP 鼠标事件触发 `skipped`，安装到移除约 1271ms | 通过；不是原生 OS 鼠标测试 |
| 真实正常交还 | `theme-reveal` 在最短停留 3000ms 配置下以 `ready` 收尾，安装到移除约 3149ms | 通过；本轮没有触发硬超时 |
| 真实故障回退 | 故意配置非法 CDP 端口 `0`，注入器以 `invalid loopback CDP port` 拒绝；默认 `#loading` 与 ZCode 图标可见，主题层从未出现，宿主最终 ready | 通过，已保存并人工查看默认启动截图 |
| 真实强杀恢复 | 在目标仍处于 `waitingForDebugger` 时强杀本次注入器，宿主恢复 ready，最终无启动层残留 | 通过 |
| 生命周期自动化 | JSDOM 真实模板测试覆盖 Esc、实际按钮、900ms 保护与 `timeout` 硬截止，移除原因和清理结果均通过 | 通过；不能与真实宿主 `ready` 场景混写 |
| P3-4 安装文件完整性 | 前后快照覆盖 `.zcode-install-manifest` 全部 1429 项，每份总计 837456366 bytes；快照之间完成四种真实场景的有效回归。1429 个文件的 SHA-256 全部一致，清单自身未变，变化 / 缺失 / 新增均为 0 | 通过（本轮前后快照与回归范围） |
| P3-6 真实系统减少动态效果 | 通过 Windows 设置关闭“在 Windows 中显示动画”，宿主收到 `prefers-reduced-motion: reduce`，系统参数 `clientAreaAnimation=false`、`MinAnimate="0"`。首次实测发现 `.bb-startup.reduced *` 未覆盖进度条 `::after`，`bb-startup-sweep` 仍运行；修复选择器覆盖 `::before / ::after` 并补 CSSOM 回归后，启动层 `reduced` 类生效、活动动画数为 0、背景 `transform: none`，正常 `ready` 交还 | 缺陷已修复，真实宿主通过 |
| P3-6 多显示器 | 系统只检测到 `\\.\DISPLAY1` 一台物理显示器，2560 × 1440 | 未覆盖；不用模拟窗口冒充通过 |

四档 DPI 均通过真实 Windows 缩放设置逐档测试，未使用 CDP 设备指标或 reduced-motion 仿真。每档均验证真实注入、主题媒体传播、启动层铺满视口、Logo 和跳过按钮不越界、无文档溢出、正常 `ready` 交还、原生窗口 DPI 和客户区像素比例；五张启动层截图均已人工查看。

| Windows 缩放 | DPR | 原生窗口 DPI | CSS 视口 | 截图像素 | 判定 |
| --- | --- | --- | --- | --- | --- |
| 100% | 1 | 96 | 1200 × 800 | 1200 × 800 | 通过 |
| 125% | 1.25 | 120 | 1200 × 800 | 1500 × 1000 | 通过 |
| 150% | 1.5 | 144 | 1200 × 800 | 1800 × 1200 | 通过 |
| 200% | 2 | 192 | 1200 × 680 | 2400 × 1360 | 通过 |

测试后已通过 Windows 设置恢复 100% 缩放并重新开启动画，复核 `systemDpi=96`、`clientAreaAnimation=true`、`MinAnimate="1"`、`visualFXSetting=2`。所有临时宿主正常关闭，9347 端口与测试进程无残留。

### 0.2.1 新笔记本设备复验（2026-10-27）

在新节点 **LENOVO 81V4 笔记本**上，使用当前提交 `09efa81` 的 Release 目录 `build/out/BackdropBuddy-1.1.1` 和真实 ZCode `3.16.3.8992` 完成复验。环境为 Windows 11 Home 26200、当前 125% 缩放（独立 DPI 上下文读取 `systemDpi=120`，宿主 DPR `1.25`）、单台物理显示器，系统动画保持开启。每个场景使用独立数据目录和独立回环调试端口；未操作用户既有宿主进程，未修改系统动画或 DPI 设置，未向宿主安装目录写入。本轮未重做安装文件全量哈希，P3-4 的完整性结论不被扩大解释。

| 场景 | 实测结果 | 判定 |
| --- | --- | --- |
| 正常交还 | `theme-reveal` 注入成功，页面采样记录 `finished=true / reason=ready`，最终启动层、样式和 API 均清理；`attachAfterPortMs=586` | 通过 |
| 真实跳过 | `zcode-pop` 安装后 100.7ms 的 CDP 鼠标点击被 900ms 保护期忽略，1395.3ms 再次点击后以 `skipped` 交还 | 通过；不是原生 OS 键鼠测试 |
| 故障回退 | 注入器配置非法端口 `0`，以 `invalid loopback CDP port` 失败开放；默认启动画面可见，主题层从未出现，宿主最终 ready | 通过 |
| 注入器强杀恢复 | 目标处于 `waitingForDebugger` 时仅强杀本次注入器，宿主恢复默认启动并最终 ready，无白屏或启动层残留 | 通过 |

两种预设均验证启动层铺满视口、主题媒体进入实际计算样式、Logo 和跳过按钮不越界、无文档溢出。CSS 视口为 1536 × 816，实际截图为 1920 × 1020；正常、跳过、回退与恢复截图均已逐张查看。结束后本次宿主与注入器进程残留为 0。汇总证据为 `.kimi-work/startup-production/device-laptop-2026-10-27/evidence-2026-10-27T14-58-14-005Z/summary.json`，视觉复核为同目录 `visual-review.json`，环境及 DPI 记录为 `device.json` 与 `dpi-context.json`。当前设备只覆盖 125% 缩放和系统动画开启状态；其他 DPI、真实系统减少动态效果未在本节点重复执行，多显示器仍未覆盖。

### 0.3 尚未关闭的验收边界

- 当前只有一台物理显示器，多显示器尚未实测；原生 OS 键鼠输入尚未实测，既有输入验证使用 CDP 或 DOM。
- 真实启动动画验收仅覆盖 ZCode 主渲染器；多宿主和其他窗口类型仍需分别做真实验收。
- `file:` 图片的 Network 事件在本机 Chromium 上不稳定；图片证据采用实际计算后的背景 URL 与截图，不宣称整个宿主启动期网络请求为 0。
- 真实 3.5 秒硬截止尚未通过拖延真实宿主 ready 来触发；目前由 JSDOM 生命周期测试覆盖。

### 0.4 证据位置

- 首帧 spike 复核：`.kimi-work/startup-spike/evidence-2026-10-27T08-37-08-894Z/gate-review.json`；同目录保存 20 轮原始记录与四张首帧拼图。
- 最新四种真实生产场景：`.kimi-work/startup-production/evidence-2026-10-27T12-29-00-420Z/summary.json`；`skip / timeout / fallback / kill` 全部通过，各场景子目录保存配置、时间线、日志与截图。
- P3-6 显示与减少动态效果汇总：`.kimi-work/startup-production/display-p3-6-2026-10-27/final-summary.json`。`reduced-pass-evidence / dpi100-evidence / dpi125-evidence / dpi150-evidence / dpi200-evidence` 保存各场景原始记录；启动层视觉证据为各自的 `startup-visible.png`，`native-screen.png` 是交还后的宿主画面，不能混用。系统恢复记录为 `system-restored.json`。
- P3-6 失败历史保留在 `reduced-off-evidence`（伪元素产品缺陷及原 DPI 断言错误）、`reduced-off-fixed-evidence` 与 `reduced-off-final-evidence`（测试隔离路径过深导致宿主数据库 `open_failed`），不计为通过场景；最终汇总中逐项分类。最新生产回归前一次 `earlySkip: null` 观测空窗保留在 `.kimi-work/startup-production/evidence-2026-10-27T12-27-54-650Z/summary.json`，没有早期点击就不记作早期跳过通过。
- 安装文件完整性：`.kimi-work/startup-production/install-integrity-2026-10-27/comparison.json`；前后完整清单快照、工作区副本哈希与比对脚本保留在同目录，媒体测试日志为 `media-tests.log`。
- 首轮生产采样失败证据保留：`.kimi-work/startup-production/evidence-2026-10-27T11-58-26-399Z/summary.json`。当时首次观察启动层已为 846.8ms，验收入口未执行早期点击，`earlySkip: null`，导致 `skipBefore900Ignored: false`；这不是产品提前跳过。未改产品或放宽断言，随后完整四场景重跑全部通过。
- 故障回退截图：`.kimi-work/startup-production/evidence-2026-10-27T11-28-04-950Z/fallback/default-startup.png`（此前已人工查看；本轮 fallback 原始证据见上述最新生产目录）。
- 发布构建与校验：`build/out-next/build.json` 与 `.kimi-work/startup-production/build-verification.json`。Release 1.1.1 的 195 个 manifest 条目及 ZIP 内 196 个文件均逐文件校验通过；ZIP 为 188022935 bytes，SHA-256 为 `17f532f5b65c9a74f48b9fdbf3381040f3ca5cf68bf80e8dd8264114081f5599`。发布目录 `README.md` 与 `docs/README.md` 一致，`git diff --check` 通过。

---

以下 Phase 0–3 为原始计划，保留用于对照；实际状态与偏差以第 0 节及 Phase 3 的验收记录为准。

---

## 1. 原始目标与路线

**主线目标**：让主题携带启动动画，在 ZCode 启动首帧生效，且不修改宿主安装文件。

**原设计路线**：BackdropBuddy 启动 ZCode 时提前挂浏览器级 CDP，在页面第一个脚本执行前注入固定启动模板。2026-10-27 的启动后覆盖层原型证明播放链路可行，也再次证明首帧问题必须靠启动时序解决。

**明确边界**：只在「由 BackdropBuddy 启动 ZCode」的路径生效；从开始菜单直接双击 ZCode 不生效。要覆盖所有启动方式，只能改 asar、做上游 PR 或改用覆盖窗，均不列入 V1。

**预算**：主线 5–7 人日（含 spike 与验证）；BackdropBuddy 自身启动动画为独立支线，约 1 人日，可并行但不与主线混在同一版本验收。

---

## 2. 已核实的设计前提

| 事实 | 影响 |
|---|---|
| ZCode 启动画面是静态 `out/renderer/index.html` 的 `#loading` + `.startup-logo-shell`，自带 0.72s 弹入 | 必须在页面脚本执行前注入，才能覆盖首帧 |
| 入口 JS 在 `zcode-startup-ready` + 500ms 后删除 `#loading`，另有 3s 硬超时 | 启动层不能依赖 `#loading` 存活，必须是独立全屏层 |
| 现有 `openCdp` 只连页面 target（`kernel/host/detect.mjs:83`），`requireStatus` 要求 ready（`kernel/host/adapter.mjs:105`），`restart.ps1` 返回时页面已启动完（`platform/windows/host/restart.ps1:126`） | 现有链路天然错过启动画面，必须新增启动期注入器 |
| 官方 UI 插件启动后加载，不能注入主渲染器（ZCode `UI_PLUGIN.md`） | 插件方案排除 |
| 现有指纹检查的是 `[data-testid="root-startup-loading"]`，不是静态 `#loading` | 当前没有观察真正的启动画面，需要修正日志与检测 |
| 现有主题 CSS 已使用 `file://` 媒体地址（`kernel/host/adapter.mjs:205`） | 启动层可直接复用主题图片路径，无需另起协议 |

### 2.1 本机启动耗时（`shell.log` 实测）

| 启动时间 | WebView2 就绪耗时 |
|---|---|
| 2026-10-22 16:34 | 1.54s |
| 2026-10-22 16:48 | 1.25s |
| 2026-10-22 20:52 | 2.55s |
| 2026-10-22 20:55 | 0.78s |

该数据用于支线 B 的时长设计；主线 A 的 ZCode 启动耗时需在 spike 中另行测量。

---

## 3. 两条工作线

### 线 A：ZCode 主题启动动画（主计划）

- 主题可配置启动动画
- 由 BackdropBuddy 启动 ZCode 时注入
- 不改宿主文件
- 预计 5–7 人日

### 线 B：BackdropBuddy 自身启动动画（支线，独立）

- 单一浅色底板 `#F1F2F6`（与应用内部一致）+ 连续单场景动画（应用图标淡入 → 英文副题 → 启动/就绪两级状态 → 浅色交接）；中心不重复应用名，应用名只在左上品牌块
- 字体清晰度：英文副题改用 Segoe UI 11px / 2.6px 字距，小字 10px/9.5px 并加深；WPF 小字 `TextFormattingMode=Display`、大字 `Ideal` + `ClearType`；中文状态 22px Microsoft YaHei，不用伪粗体
- 参考 `dsh-startup-screen` 的底板/准星/等宽小字语言；图标直接使用品牌仓生成的状态栏字形（`Assets/app-icon.png`，1024px，Resource 内嵌），与任务栏/标题栏一致；图标与准星共用 `IconStage` 中心，准星开口 280°；按反馈去掉黑幕、过曝、故障与光爆
- 与 ZCode 主线无依赖，可先交付

### 线 B 实测（2026-10-23，单场景统一版）

- 实现：`src/BackdropBuddy.Shell/SplashWindow.xaml(.cs)`；主窗与启动窗同为 `#F1F2F6`，不再有黑→白或暖→冷跳变；界面就绪后在收尾阶段交接。
- 实测（Release，隔离数据目录，1440×900）：splash 首帧约 0.4–0.6s；动画约 3.0–3.5s（WebView2 慢时进入等待态）；常规热启动从进程到界面约 3.6s；600ms 后点击任意位置、SKIP 或 Esc 可跳过；`BACKDROPBUDDY_REDUCED_MOTION=1` 或系统关闭动画时走静态底板（734ms 交接）；错误路径 309ms 退场并显示错误页；第二实例不显示启动窗（exit 0 handoff）。
- 已知：动画总长比原 1s 版长（按要求放慢）；若需要短版，调 `SplashWindow` 的时间常量即可；只在 96 DPI 实测。

### 3.1 线 B 事件驱动改造（2026-10-25，已实机验收）

固定节拍（1250/650/320ms）改为里程碑状态机：动画不再决定时长，交接条件是「UI 真正就绪 且 已展示 ≥700ms」。

| 里程碑 | 信号来源 | 文案（中/英） |
| --- | --- | --- |
| 1 内核进程 | `StartKernel` 成功后 `NotifyPhase(PhaseKernel)` | 正在启动内核 / STARTING KERNEL |
| 2 内核 hello | 壳侧 `system.hello` 回调（常被 3/4 超车，属正常） | 正在准备主题库 / PREPARING THEMES |
| 3 WebView2 | `EnsureCoreWebView2Async` 完成 | 正在启动界面 / LOADING INTERFACE |
| 4 导航完成 | `NavigationCompleted` | 正在渲染界面 / RENDERING INTERFACE |
| 5 UI 就绪 | React 首屏数据完成（hello + theme.list + settings）后 `bridge.notifyReady()` → 壳 `NotifyUiReady()` | 准备就绪 / READY |

- 常量（`SplashWindow.xaml.cs`）：`MinShownMs=700`、`HandoffFadeMs=180`、`PhaseStallMs=1500`（同一里程碑停留超时切"仍在准备，请稍候"并给状态行呼吸动效）、`UiReadyFallbackMs=6000`（ui.ready 迟到则按导航完成交接，防启动窗卡死）。
- 视觉：静态完成帧直接上屏（删除 1.35s 入场 Storyboard 与逐字打字机），唯一持续动效为准星 30s/圈慢速旋转；进度条按里程碑 0.2/0.4/0.6/0.8/1.0 跳变。
- 保留：Esc/点击跳过（600ms 保护）、reducedMotion 静态底板、Abort 错误路径、第二实例不显示启动窗、跟随主窗。

**实测（Release、隔离数据目录、96 DPI）**：

| 场景 | 时序 |
| --- | --- |
| 冷启动（播种 41 个本地主题） | phase3 1.5s → phase4 1.6s → 等待文案 3.1s → phase5 3.8s → 交接 **3814ms** |
| 热启动（已播种） | phase2 339ms → phase3 574ms → phase4 675ms → phase5 956ms → 交接 **956ms**、关闭 1220ms |

对比旧版：动画固定 3.0–3.5s、进程到界面约 3.6s；热启动现在 1.2s 内完成且每一步文案对应真实事件。

**顺带修复**：`ui/src/bridge.js` 两处 `listeners.set(new Set())` 缺 key（应为 `listeners.set(event, new Set())`）——该笔误使 React 挂载时第一个 `bridge.on()` 即抛 TypeError，UI 整页空白、零消息发出（浏览器直开 UI 包用错误捕获页定位，`Cannot read properties of undefined (reading 'add')`）。

以下详细计划只展开线 A；线 B 单独排期。

---

## 4. 阶段与任务

> 实施状态：Phase 0–2 的功能已落地；Phase 3 按本节后附记录逐项验收。P2-4 实际采用“缩略图优先、静图其次、500 KiB 硬上限、无合适静图用深色渐变”，没有额外生成 1920px 启动专用副本。

### Phase 0：技术 spike（0.5–1 人日，已完成）

**目的**：只验证一件事——能否在 `#loading` 绘制前注入成功，以及成功率。

| 编号 | 任务 | 产出 |
|---|---|---|
| P0-1 | 写一次性 `startup-injector.mjs`：轮询 `/json/version`，连浏览器 WS，`Target.setAutoAttach(waitForDebuggerOnStart)`，注入测试脚本后恢复 | 独立脚本，不进主代码 |
| P0-2 | 注入红色全屏测试层，记录 4 个时间点：端口开放、target attach、脚本执行、`#loading` 是否存在/已绘制 | 计时日志 |
| P0-3 | 连续启动 10–20 次，统计「脚本跑在 `#loading` 绘制前」的比例 | 成功率报告 |
| P0-4 | 卡死测试：暂停后强杀注入器，确认 ZCode 仍能正常加载 | 结论 |
| P0-5 | 截图验证：首帧是否被测试层覆盖，默认 logo 是否闪现 | 截图集 |

**Gate**：成功率 ≥95% 且无卡死，进入 Phase 1；否则改用覆盖窗 fallback，暂停主线。

---

### Phase 1：启动期注入链路（2–3 人日，已完成）

| 编号 | 任务 | 关键点 |
|---|---|---|
| P1-1 | 扩展 `CdpSession` 支持浏览器级会话与事件分发（`Target.attachedToTarget`） | 现有类只处理响应，不支持事件 |
| P1-2 | 新增 `kernel/host/startup-injector.mjs` | 由内核在重启前拉起，独立进程，失败不影响启动 |
| P1-3 | 与 `restart.ps1` 编排：先起注入器，再停/启 ZCode；端口若已开放则放弃本次注入 | 避免误注入旧实例 |
| P1-4 | 固定启动模板：全屏层、主题背景、ZCode logo、动效、`-webkit-app-region: drag` | 与主题包内容解耦 |
| P1-5 | 把 `#loading` 设为 `opacity:0`，不删除、不改 DOM 结构 | 保留 ZCode 自身状态机 |
| P1-6 | 单次显示守卫（sessionStorage），防止页面 reload 重播 | 只在本进程首次文档显示 |
| P1-7 | watchdog：800ms 内无论成功失败都 `runIfWaitingForDebugger`；断开 CDP 自动恢复 | 防宿主白屏卡死 |
| P1-8 | 注入结果日志：`startup.inject {attached, injected, elapsedMs, reason}` | 为验收统计成功率 |

**启动层时序**：

| 时间 | 行为 |
|---|---|
| 0ms | 页面恢复，注入层立即出现，`#loading` 透明 |
| 0–900ms | 背景淡入 + logo 动效 + 光扫 |
| ≥900ms 且宿主 ready | 180ms 淡出并移除 |
| 动画结束但宿主未 ready | 停在完成帧，轻微呼吸，最长 3.5s |
| 用户点击/按键 | 900ms 后允许立即跳过 |
| `prefers-reduced-motion` | 静态背景 + 150ms 淡入淡出 |

---

### Phase 2：主题模型与 UI（2–3 人日，已完成）

| 编号 | 任务 | 关键点 |
|---|---|---|
| P2-1 | `kernel/store/record.mjs` 增加 `startup` 字段：`enabled` / `preset` / `holdMs` / `media` | 默认关闭，旧主题自动兼容 |
| P2-2 | `kernel/store/library.mjs` 导入/导出携带 `startup` | 旧包缺失字段使用默认值 |
| P2-3 | 后端校验：预设枚举、时长范围、媒体路径越界检查 | 不接受任意 JS/HTML |
| P2-4 | 启动素材规范化：优先使用主题缩略图或 1920px JPEG | 禁止直接使用 20MB 原图/视频 |
| P2-5 | 设置页新增「启动动画」区块：开关、预设、时长、预览 | 预览与宿主共用同一模板 |
| P2-6 | 预览通过固定 iframe/sandbox 渲染，不把主题内容直接塞进 React 主文档 | 隔离样式与脚本 |
| P2-7 | 文案与流程：明确「下次由 BackdropBuddy 启动 ZCode 时生效」，与「应用并重启 ZCode」打通 | 避免用户以为立即生效 |
| P2-8 | 协议方法：`theme.startup.preview` 返回净化后的模板参数 | 单一事实源，避免前后端各写一套 |

**V1 预设**：建议只做两个——`zcode-pop`（主题背景 + ZCode logo 弹入 + 光扫）和 `theme-reveal`（背景缓慢推近 + 主题名）。不再扩展。

---

### Phase 3：验证与交付（1 人日）

| 编号 | 验证项 | 通过标准 |
|---|---|---|
| P3-1 | 连续启动 20 次 | 注入成功率 ≥95%（19/20） |
| P3-2 | 注入失败回退 | ZCode 正常启动，默认启动画面可见，无阻塞 |
| P3-3 | 卡死测试 | 强杀注入器后 ZCode 仍能加载，无白屏残留 |
| P3-4 | 宿主文件不变 | `.zcode-install-manifest` 覆盖文件哈希前后一致 |
| P3-5 | 多窗口 | `update-status`、插件沙箱、内嵌浏览器不被注入 |
| P3-6 | 动效与显示 | 减少动效、100/125/150/200% DPI、多显示器各 1 次截图 |
| P3-7 | 主题兼容 | 旧 `.bbskin` 导入、导出往返、默认关闭 |
| P3-8 | 文档 | README 写明生效边界、失败回退、素材建议 |

**2026-10-27 实际验收记录**：

| 编号 | 状态 | 证据与限制 |
| --- | --- | --- |
| P3-1 | 通过（spike） | 20/20 普通启动复核通过，20 轮首帧截图通过；这是首帧注入 spike，不冒充 20 次完整生产链路验收 |
| P3-2 | 通过（真实宿主） | 非法端口使注入器在连接前失败，默认启动截图存在，宿主 ready 且主题层始终未出现 |
| P3-3 | 通过（真实宿主） | spike 与生产验收各覆盖一次暂停目标后的注入器强杀，均恢复且无启动层残留 |
| P3-4 | 通过（真实宿主） | 前后快照完整覆盖 `.zcode-install-manifest` 的 1429 项；复制到工作区后计算 SHA-256，变化 / 缺失 / 新增均为 0，清单自身未变；快照之间四种真实生产场景回归全部通过 |
| P3-5 | 通过（真实原生多窗口） | 真实 Electron `BrowserWindow` / `WebContentsView` 加载实际 ZCode renderer：主窗口完成注入、显示与清理；`update-status`、插件沙箱、内嵌浏览器均被 `autoAttach` 观察到，但无启动层、样式或启动 API，且页面可响应。证据：`.kimi-work/startup-production/multiwindow-p3-5-2026-10-27/native-evidence-2026-10-27T13-03-25-587Z/summary.json`。这不是通过 ZCode 最终用户 UI 流程打开辅助页面的验收 |
| P3-6 | 部分通过（真实宿主） | 真实系统减少动态效果已通过，修复了进度条伪元素动画未停用的问题并补自动化；100% / 125% / 150% / 200% DPI 逐档通过且截图已人工查看；最新 100% DPI 复核全部断言通过，证据为 `.kimi-work/startup-production/display-p3-6-2026-10-27/dpi100-recheck-evidence/summary.json`。新增 LENOVO 81V4 笔记本节点，在当前 125% 缩放下通过正常交还、跳过、故障回退和强杀恢复，证据为 `.kimi-work/startup-production/device-laptop-2026-10-27/evidence-2026-10-27T14-58-14-005Z/summary.json`。该节点与最新预检均只有 `\\.\DISPLAY1`；多显示器未覆盖，不能判定整项完成 |
| P3-7 | 通过（自动化） | `startup-theme.test.mjs` 覆盖旧主题默认关闭、旧 `.bbskin` 导入、含启动配置的导出再导入、媒体字节保持一致与持久化 |
| P3-8 | 完成 | `docs/README.md` 已写明设置路径、保存后预览、生效边界、素材限制与失败回退 |

P3-5 回归补充：验收发现 `Target.setAutoAttach` 与现存目标挂接可能对同一 `targetId` 建立两个会话，已在 `kernel/host/startup-injector.mjs` 按 `targetId` 去重；重复会话仅恢复执行，不再注册启动脚本。`tests/kernel/startup-injector.test.mjs` 定向回归 8/8 通过。后续修复了 `platform/windows/host/find.ps1` 在 `ProgramData` 缺失时拼接空路径的问题；生产验收器也改为按启动层安装时间判断 900 ms 跳过窗口，并从注入器日志补读观察器挂接前的安装事件。最终完整内核测试共 145 项，142 通过、0 失败、3 跳过；`skip`、`timeout`、`fallback`、`kill` 四个真实生产场景全部通过，证据：`.kimi-work/startup-production/evidence-2026-10-27T14-01-00-000Z/summary.json`。

---

## 5. 验收指标

| 指标 | 目标 | 当前实测 / 判定 |
| --- | --- | --- |
| 注入成功率 | ≥95%（20 次启动） | spike 复核 20/20，通过 |
| 端口开放到 attach | ≤300ms | 中位数 327.5ms、范围 223–1075ms，**未达到该时延目标** |
| 启动层首帧 | 早于 ZCode 默认 logo 绘制 | 20 轮前三帧均为测试层，且样式安装早于首帧采样；通过本轮截图验收，不外推为绝对零闪屏 |
| 宿主卡死次数 | 0 | spike 与生产强杀场景均恢复，未观察到卡死 |
| 启动层总时长 | 默认 0.9–1.2s；未就绪时最长 3.5s | 真实跳过约 1271ms；3000ms 配置下真实 ready 交还约 3149ms；硬截止由 JSDOM 验证为 3300–3600ms 内移除 |
| 宿主文件改动 | 0 | 本轮真实前后哈希比对覆盖清单全部 1429 项，变化 / 缺失 / 新增均为 0，清单自身未变；通过本轮范围验收 |
| 启动期网络请求 | 0 | 固定模板无网络依赖；`file:` 事件不稳定，未证明整个宿主启动期请求为 0 |
| 启动图体积 | ≤500KB（建议 1920px JPEG/缩略图） | 实现硬上限 500 KiB，并校验路径、扩展名与文件头；自动化通过 |

---

## 6. 风险与对策

| 风险 | 概率/影响 | 对策 |
|---|---|---|
| `waitForDebuggerOnStart` 导致 ZCode 白屏卡死 | 中/高 | watchdog、断开 CDP 自动恢复、P0-4 强杀测试 |
| 早挂竞态，注入晚于首帧 | 中/中 | P0 成功率实测；失败静默回退默认启动画面 |
| `file://` 图片在 document_start 不可用 | 低/中 | 现有主题 CSS 已用 file URL；P0 一并验证，失败改用缩略图 data URL |
| ZCode 更新改启动 DOM/URL | 中/中 | 选择器容错、版本门禁、失败降级；启动层独立于 `#loading` |
| 主题包成为任意代码入口 | 低/高 | 只接受枚举/颜色/时长/本地图片；固定模板；复用 CSS 白名单 |
| 启动层被误认为卡死 | 低/中 | 完成帧呼吸、输入可跳过、3.5s 上限 |
| 直接双击 ZCode 不生效 | 高/产品边界 | UI 明示；提供「用 BackdropBuddy 启动」入口；不承诺全路径 |

---

## 7. 明确不做

- 不修改 `app.asar`，不写宿主安装目录
- 不依赖 ZCode UI 插件
- 不注入任意主题 JS/HTML
- V1 不支持启动视频/音频
- 不做 WPF 覆盖窗（只作为 spike 失败后的 fallback）
- 不承诺从开始菜单直接启动 ZCode 也生效
- 不为 1 秒动画引入 Lottie/Skia/3D 依赖

---

## 8. 原决策点与落地结果

1. **生效边界**：V1 已按「只由 BackdropBuddy 启动宿主时生效」落地；直接双击、改 asar、上游修改与覆盖窗均不在本次交付内。
2. **spike 方式**：已用临时 profile 与隔离数据目录完成真实 ZCode 测试，测试进程按本轮 PID 与 profile 归属清理。
3. **预设数量**：已交付 `zcode-pop` 与 `theme-reveal` 两个固定预设，不开放主题任意代码。
4. **交付顺序**：BackdropBuddy 自身 Splash 已先完成；宿主静态启动动画主线现已完成核心实现与验收，剩余项目见 Phase 3。

---

## 9. 原始建议排期（历史）

| 顺序 | 内容 | 人日 |
|---|---|---|
| 1 | Phase 0 spike + 决策 | 0.5–1 |
| 2 | Phase 1 注入链路 | 2–3 |
| 3 | Phase 2 主题模型与 UI | 2–3 |
| 4 | Phase 3 验证与文档 | 1 |
| 合计 | ZCode 主线 | 5.5–8 |
| 并行 | BackdropBuddy 自身启动动画 | 1 |

建议先做 Phase 0，成功率达标再投入主题模型；不达标就停在覆盖窗方案，避免把 4 天以上工时押在一个未验证的注入时机上。

---

## 10. 参考

### 仓库内

- `kernel/host/detect.mjs:83` — `openCdp` 页面级会话
- `kernel/host/detect.mjs:174` — 已读取 `/json/version`，但未使用浏览器 WS
- `kernel/host/adapter.mjs:105` — `requireStatus` 要求页面 ready
- `kernel/host/adapter.mjs:122` — `restart`
- `kernel/host/adapter.mjs:205` — 主题媒体 `file://` URL
- `platform/windows/host/restart.ps1:126` — 启动 ZCode 并等待端口
- `kernel/host/zcode.mjs:9` — `zcode-startup-ready`
- `kernel/store/record.mjs:1` — 主题记录 schema
- `kernel/store/library.mjs:127` — 主题包 schema 校验
- `kernel/schema/settings.mjs:19` — `applyOnStart` / `reducedMotion`
- `docs/PLAN.md:521` — `applyOnStart` 尚未消费
- `src/BackdropBuddy.Shell/App.xaml.cs:37` — 主窗口创建
- `src/BackdropBuddy.Shell/MainWindow.xaml:12` — 现有静态加载面板

### 外部

- ZCode 渲染器启动页源码：<https://github.com/zai-org/ZCode/blob/main/packages/desktop/src/renderer/index.html>
- ZCode UI 插件文档：<https://github.com/zai-org/ZCode/blob/main/UI_PLUGIN.md>
- CDP `Target.setAutoAttach`：<https://chromedevtools.github.io/devtools-protocol/tot/Target/#method-setAutoAttach>
- CDP `Page.addScriptToEvaluateOnNewDocument`：<https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-addScriptToEvaluateOnNewDocument>
- Electron 命令行开关：<https://www.electronjs.org/docs/latest/api/command-line-switches/>
