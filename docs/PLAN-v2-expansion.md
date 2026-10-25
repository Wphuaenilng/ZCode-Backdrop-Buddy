# BackdropBuddy 后续升级方向（V1.1 / V2）

- 状态：**①②③④⑤ 全部实现并实测（⑤ 于 2026-10-24，第二产品 = Desktop AI Pet / Tauri）**
- 记录日期：2026-10-23
- 基线版本：V1 1.0.0（P0–P7 已交付）
- 依据：本仓代码只读核对（文中 `file:line` 均为实际读取）+ Obsidian / ZCode 真机验证；`docs/PLAN.md` §9.3
- 口径：标 **未实测** 的是推断，不作为验收依据；标 **静态读取** 的是代码事实，未跑运行验证

## 0. 结论

1. ①② 已落地（2026-10-23）：宿主适配从写死 ZCode 变成 profile + 注册表 + 点选式接入向导；启动期残留 / 端口校对与托盘动作已上线，Obsidian 作为第二个宿主真机跑通。
2. ③ 已落地（2026-10-23）：**宿主在深色 / 浅色之间切换时，皮肤自己跟上**。复现先把范围缩了——面板与文字 token 本来就跟随切换、“切模式导致宿主重载”也不成立，所以漂移检测不用做，真正坏掉的只有两处并已各改一处：无素材主题的渐变底拆成两个模式块各一份（`--bb-backdrop-image`），暂停 / 恢复的校验基准改按页面此刻的模式取值（`tokensByMode[modeNow]`，并持久化 `baselineMode`）。真机复验 11/11：深色下应用无素材主题后切浅色，底色自动换成浅色系、target id 不变、暂停与继续都 `verified:true`。详见 §2.3。
3. 主题素材仍然只用你自己上传的图片 / 视频，不做造图；原来的“主题生产链”降级为 2.9 备选。

## 1. 与既有待办的关系

`docs/PLAN.md` §9.3 已列 6 条，本文**不重复**它们：

| 已有待办 | 本文处理 |
| --- | --- |
| 1 代码签名、2 干净机验收、3 设置页补两个开关、4 UI 内启停宿主、5 多宿主、6 随包 LGPL ffmpeg | 视为既定，不在此重列 |

本文只补“那 6 条之外”，其中第 5 条（多宿主）在这一层展开成 2.1，因为它涉及架构形态而不只是“再接一个宿主”。

## 2. 方向

### 2.1 宿主 profile 化 + 接入向导（最值得做）

> **状态：2026-10-23 完成（架构层 + 第二个宿主 + 点选式接入向导）。**
> 已落地：`kernel/host/expressions.mjs`（注入/校验/暂停/移除的通用表达式）、`kernel/host/profiles` 形状（`zcode.mjs` / `obsidian.mjs` 同接口）、`kernel/host/registry.mjs`（`BACKDROPBUDDY_HOST=zcode|obsidian`，默认 zcode）。ZCode 行为零变化（内核测试 82 条全绿）；Obsidian 1.13.7 真机跑通 应用 / 暂停 / 继续 / 恢复。
> 宿主差异收敛成四类：选择器与就绪判据、主题变量名与挂载点、**注入 CSS 的选择器白名单**、是否做宿主目录哈希。演练出的教训：`platform/windows/theme/validate-css.ps1` 原本写死 ZCode 选择器，必须由 profile 用 `cssSelectors` 声明，否则第二个宿主的 CSS 一律被白名单拒绝。
> 接入向导（2026-10-23 补齐）：新增「接入宿主」页，五步 = 连接（端口只读检测）→ 点选根容器 → 点选面板/玻璃条 → 选背景与文字变量 → 试穿并保存。点选是在**宿主页面里**注入高亮层，用真实鼠标事件取元素，生成唯一选择器；生成物是纯数据 profile（`%LOCALAPPDATA%\BackdropBuddy\hosts\<id>.json`），由 `kernel/host/generic.mjs` 翻译成注入 CSS，选择器白名单由数据自带。安全边界：只允许回环 CDP、检测全程只读、试穿走独立适配器（不写 pointer/runtime）。切换宿主用 `BACKDROPBUDDY_HOST=<id>` 或 config.hostId。
>
> **第二宿主选型记录**：DeepSeek Harness 0.2.1-rc.2 实测不可用——无参数启动静默 `exit 0`（初始化路径提前退出），带任何参数 `exit 9`；且界面来自 `harness.deepseek.com` 的远程登录态页面（`dshMandatoryUpdatePolicy.allowedPageOrigins`），DOM 由服务端控制，不适合作为 profile 基准。改用本机 Obsidian（`app://obsidian.md` 本地渲染、CSP 允许 `style-src 'unsafe-inline'`、body 上主题变量齐全）。

**现状（静态读取）**
- `kernel/host/adapter.mjs:12` 直接 `import { ZCODE_PROFILE, buildThemeCss, normalizeThemeParams, injectionExpression, ... } from './zcode.mjs'`——注入表达式、快照、暂停、恢复全是 ZCode 专用函数。
- 运行时安全校验是齐的：`kernel/host/detect.mjs:148` 调 `host/detect.ps1`，脚本比对端口归属进程的 exe 路径（`platform/windows/host/detect.ps1:82`）与页面指纹（`kernel/host/detect.mjs:185`）。
- 已有可复用的宿主运维脚本：`platform/windows/host/` 下 9 个（detect / launch / restart / stop / port-owner / fingerprint / version / cdp-eval / cdp-targets）。

**缺口**
“换一个宿主”需要改代码，且注入表达式与选择器耦合在一个模块里，没有 profile 的概念边界。

**做法**
1. 抽出 `host/profiles/<id>.mjs`（或 JSON）：选择器表、注入表达式构造、指纹字段、版本约束、能力位（有无虚拟滚动、有无 shadcn token）。
2. `adapter.mjs` 改成按 id 解析 profile，其余事务/快照/恢复逻辑不动。
3. 接入向导：只读连上 CDP → 抓 DOM → 用户点选“根容器 / 侧栏 / 卡片 / 视频挂载点”→ 生成 profile → **只读**冒烟（注入一次、校验、立即恢复）→ 落盘为本地 profile。

**代价**：这是唯一会动 P4 核心的改动；预估 4–6 人日（含一个非 ZCode 宿主的最小验证），不含第三方宿主的未知数。

**风险**：第三方 Electron 应用的 DOM 结构随时会变，profile 是易腐资产，必须配“指纹不符就拒绝注入”而不是“尽力而为”。反面样本：把 profile 做成“猜选择器”，会在宿主升级后静默注入到错误节点。

**判断信号**：能用同一份 kernel 代码对**第二个**宿主完成一次“注入→校验→恢复”，且宿主目录文件哈希不变。

### 2.2 可靠性与信任面

> **状态：2026-10-23 已实现并真机验收**（启动期残留审计 + 恢复横幅 + 托盘暂停/恢复 + 默认端口归属与指纹校验的显式提示）。残留判定在用户实际执行应用/恢复之前保持，不会被一次普通刷新抹掉。

**现状（静态读取）**
- `kernel/store/pointer.mjs:3-10` 记 `activeThemeId / activeName / params / paused / revision`。
- 没有找到启动期校对“宿主上是否残留注入层”的路径（全仓 grep `recover|orphan|stale|crash|leftover` 只命中主题目录清理与 staging 清理）。
- 退出清理逻辑在壳/内核生命周期里，但应用被强杀时不会执行。

**缺口**
1. 强杀/崩溃后，宿主的 DOM 里仍留着 `#backdropbuddy-*` 层，下次启动既不认领也不清理。
2. CDP 调试端口本身对**本机其他进程**是可达的（Electron 调试端口的固有形态）。BackdropBuddy 自己会校验归属，但没有任何“端口正被他人占用/连接”的提示。
3. 这两个都是**信任面**问题，不是已证实的攻击面（未实测）。

**做法**
- 启动期：读 `pointer` + 连宿主只读快照，若发现残留层且 `pointer.activeThemeId` 与实际不一致 → 给一条明确的“恢复原貌 / 沿用当前”路径，而不是让用户自己发现。
- 诊断包：一键导出“端口归属、指纹、注入层存在性、最近 N 条日志”，用于用户反馈。
- 托盘常驻 + 全局快捷键（暂停/恢复），把“常开”变成可接受的使用形态。

**代价**：2–3 人日。**风险低**，不动协议不改数据格式。

### 2.3 宿主明暗切换适配（③ 的实际所指）

> **决定（2026-10-23）**：主题素材仍然只用你自己上传的图片 / 视频，不做任何“造图”；“不同主题适配”指的是**宿主在深色 / 浅色之间切换时皮肤要跟着适配**。原来的“生成链”降级到 2.9。

**复现结果（2026-10-23 真机：ZCode dark + `local-video`，翻模式类实测）**

| 假设 | 实测 | 结论 |
| --- | --- | --- |
| 面板 / 文字 token 不跟随切换 | 翻到 light 后 `--color-background` `rgba(18,18,20,0.41)` → `rgba(255,255,255,0.30)`，`--color-foreground` `#e8e8ea` → `#1c1c1e` | **不成立**：双模式 CSS 正常跟随，不用动 |
| 无素材主题的渐变底不跟随 | 在 dark 下应用「樱花黎明」，翻到 light 后底仍是 `linear-gradient(155deg, rgb(16,18,22), rgb(27,32,40))`（深色渐变） | **成立**，只影响无素材主题；有图 / 视频的主题不受影响 |
| 暂停 / 恢复的校验基准取错模式 | 在 light 下点暂停再点继续，内核日志两次 `host paused/resumed { tokenMatch: false }` | **成立**：注入其实完好（层仍在、显示切换正常），但 UI 会拿到 `verified:false` 的误导文案 |
| `--color-primary-foreground` 单值有影响 | 两模式实测均为 `#000000`（`color.ps1:101` 按素材亮度算，与模式无关） | **不成立**：同值，不处理 |
| （新怀疑）翻明暗会让宿主重载、注入整层丢失 | 翻类前后 CDP page target id 不变、注入层与 `data-bb-theme` 都在 | **不成立**：不需要“重载后重注入” |

**结论**：③ 的范围比预想小，只剩两处——渐变底拆双份、校验基准按当前模式取值。**漂移检测不用做了**（模式切换既不重载也不丢注入）。

**做法（2026-10-23 已全部实现并真机复验）**
1. 渐变底拆双份：三个 profile（`zcode.mjs` / `obsidian.mjs` / `generic.mjs`）的两个模式块各写一个 `--bb-backdrop-image`，`#backdropbuddy-backdrop` 只写 `background-image: var(--bb-backdrop-image)`；`fallbackGradient(params, 'light'|'dark')` 各算一次。图片 / 视频底与模式无关，两块同值。generic 的浅色值放在 `:root`（html），这样宿主模式类挂在 `html` 还是 `body` 都能正确覆盖到背景层。
2. 校验按当前模式取值：`verifyExpression` / `pauseExpression` 额外返回页面此刻的 `dark`（`darkProbe`，取 `darkTarget` 上的 `darkClass`），`apply` 的 `expectedBackground` 与 `setPaused` 的 `expected` 都按这个值从 `tokensByMode[modeNow]` 取；拿不到 `dark` 才回落到 `status.page.dark`。状态里持久化 `tokensByMode` 与 `baselineMode`；基线是在哪个模式抓的，宿主切过之后“原样”就变了，这时 `expected = null`（不下结论，`verified` 仍为真）。
3. 回归：`tests/kernel/mode-adapt.test.mjs` 两条——三条 profile 的渐变底必须各模式一份且层只引用变量；用会翻模式的假宿主跑「深色应用 → 切浅色 → 暂停 → 继续」，继续必须 `verified:true`。把 `modeTokens` 改回旧的 `state.tokens` 后这条立刻变红（实测 `verified:false`），确认它真的打到了修复点。

**真机复验（2026-10-23，ZCode pid 5564 / page target `952E1CE9…`）**：深色下应用无素材主题「森林薄雾」→ 底 `linear-gradient(155deg, rgb(16,18,22), rgb(27,32,40))`；按宿主 `setTheme` 同构的方式切到浅色（写 `localStorage['zcode-theme']` + 翻 `html` 的三个模式类）→ 底自动变成 `linear-gradient(155deg, rgb(236,232,224), rgb(248,244,236))`，**没有重新应用**；同一 CDP target id 不变（未重载）。此刻暂停 → `background #f8f8f8 / verified true`，继续 → `background rgba(255,255,255,0.35) / verified true`（旧逻辑这里会比的是注入那一刻的 `rgba(18,18,20,0.30)`）。收尾：恢复原貌（层与 `<video>` 均移除）→ 重新应用用户的 `local-video` → 模式类与 `zcode-theme` 回到起点，`pointer.json` 参数逐字相同（revision 29 → 34）。11/11 断言通过。

**代价**：0.5–1 人日（原估 1–1.5 人日，因漂移检测被砍而缩小）。**风险**：只动 CSS 结构与校验取值，注入流程不变。

### 2.4 调度、多窗口与功能缺口

> **已完成 2026-10-24**：三块全部落地并真机复验（内核 103/103、真机 18/18 + 12/12 + 6/6）。下面是交付形态与实测数。

**1）两个开关的消费点**
- `reducedMotion`：`resolveMedia` 在偏好为真时把视频主题降级成**主题已有的首帧静图**（`thumb.jpg` 当图片素材），没有首帧就退成渐变底；只此一条机制，注入表达式不变。改偏好时 `settings.set` 会对正在运行的主题立刻重放一次，返回 `reapplied`（失败则回 `reapplyError`，不假装成功）。设置页有开关并注明效果。
  - 真机（ZCode + `local-video`）：开 → 宿主里 `<video>` 消失、背景层变成 `url(“file:///…/local-video/thumb.jpg”)`，重放 2430ms；关 → 视频回来，2432ms。
- `applyOnStart`：内核在启动审计之后、且**当前没有主题在跑**时才补应用，候选取 `lastAppliedThemeId || selectedThemeId`；宿主没开或指针已有主题就不动。UI 的手动应用会先 `await` 这段启动任务，避免两次注入交错。
  - 为此改了两处语义（都是原来会静默吃掉自动应用的坑）：`theme.restore` 与「记录说在跑但页面已经变素」的 adopt 清理路径**不再抹掉** `lastAppliedThemeId`——恢复原貌只清”此刻在跑什么”，”上次用过哪个”要留着。
  - 真机：应用 → 开开关 → 恢复原貌（宿主变素、指针清空、`lastAppliedThemeId` 保留）→ 杀进程重启 → 皮肤自己回来了（`themed=local-video`），且没有被报成残留。

**2）规则层调度**（`kernel/schedule/engine.mjs` + `service.mjs`，协议 `schedule.list/save/remove/tick`）
- 规则形态 `{id,name,enabled,themeId,when:{kind:'time'|'hostTheme'|'systemTheme', at:'HH:MM', dark:bool}}`，存 `config.schedules`；命中记录存 `config.scheduleState`（`{slots, hostDark, systemDark}`）。
- **时刻型**：`slotKey = 日期@HH:MM`，每天只命中一次；并且只在 `now - 那次时刻 ≤ 30 分钟`（`FIRE_GRACE_MS`）时才补放——应用关了三天，开机不会立刻补一次”半夜的规则”。
- **明暗型**（宿主/系统）：只在”看着它变了”的时候触发；首次观测只记录不触发，所以开机时宿主本来就是深色不会莫名切主题。
- **不长驻定时器**：内核返回 `wakeAt`（下一次该看一眼的时刻），壳用**一枚一次性 `System.Threading.Timer`** 装配它，`schedule.tick` 回来后重新装配；宿主明暗的 `wakeAt = now + 30s`，系统明暗靠 `SystemEvents.UserPreferenceChanged` 直接推（700ms 去抖），规则增删时内核发 `schedule.updated`，壳立刻重新计时。没有规则时 `wakeAt=null`，壳退化成 5 分钟一次的自检，用来接住用户刚存下的新规则。
- 设置页「自动切换」卡片：规则列表（改/停用/删）+ 一个表单（条件类型 → 时间或明暗 → 换成哪个主题），并显示”下次到点”。
- 真机：存一条”宿主切到浅色 → 樱花黎明”，翻面后 ≤75s 内自动换上 `sakura` 且界面同步；存一条”每天 01:14 → 月光花园”，**01:14:04 自己换上了**（等 60s 内命中，实测从到点到换肤 4s）。

**3）多窗口**
- `detect` 用 `rendererTargets()` 收集全部匹配的 page target（`profile.secondaryPattern` 排除宿主自己的辅助小窗，ZCode 用 `/[?&]windowKind=/`），逐个探指纹；**主目标用 `pickPrimary()` 选”已就绪的那个”**，未就绪的留在后面当附加窗口——不然新开一个还没挂载完的窗口会把整个宿主报成”需处理”（这条是真机跑出来的，先于修复时实测到 `verdict:host-unready`）。
- `adapter` 的注入 / 校验 / 暂停 / 继续 / 移除全部走 `withTargets()` 逐个窗口执行：每个窗口按**自己此刻的明暗**校验（一深一浅两个窗口同挂一份 CSS 也能都过）；任一窗口注入或校验失败 → 对所有窗口回滚，不留半套皮肤；`state.targetIds` 记录覆盖到的窗口。
- **补打**：审计时如果发现多出来的窗口没皮而本机确实有在跑的主题，就按那个窗口自己的模式重算 CSS 补打上去（`windows.synced`），失败只记日志不影响主窗口。用户不必为了多开一个窗口重新应用一次。
- 界面底部状态条在多于一个窗口时显示”宿主 ZCode · 已就绪 · 2 个窗口”。
- 真机：用 `window.open(同一个渲染 URL)` 在 ZCode 里真开出第二个渲染窗口（目标 `05C696`，开局 `layer:false`）→ 点一次”刷新主题库” → 第二个窗口被补上同一个主题，底部报 2 个窗口 → 关掉它主窗口无恙。附带结论：**Electron 的浏览器级 CDP 不支持 `Target.createTarget`**（`Not supported`），构造第二窗口只能走宿主自己的 `window.open`。

### 2.5 分发与常驻

- 托盘 + 全局快捷键（与 2.2 合并做）。
- 自动更新：Inno 已有 per-user 安装与 `/PURGEDATA` 策略，补“检查更新→下载→静默升级”链路即可；需要先有签名（§9.3 第 1 条）。
- winget / scoop 清单：低成本、纯体面活。

### 2.6 跨产品复用（组合拳）

> **已完成 2026-10-24**：判断信号达成——**同一份 `.bbskin` 在第二个自家产品（Desktop AI Pet）里应用成功**，真机 15/15。下面是探针结论、为此做的内核改动，以及没做的部分。

**探针（只读，`F:\workspace\AI-Project` 下 10 个产物）**：只有 **AI-Pet** 是真正的 Windows 桌面壳——Tauri v2（Rust）+ Vue，内置 exe（`src-tauri/target/release/desktop-ai-pet.exe`），WebView2 承载，注册了 **3 个窗口**（桌宠 `pet` 560×340 透明/置顶、`settings` 420×680、`chat` 340×480）。其余（`Missive` = 尺素集、`AI-Image-Studio`、`Cen-Memory`、`Workbench`、`yuki-chuxue`、`workbench2api-panel`、`AI-Harness`）是 Vite/Next 网页、小程序或服务端，没有可挂的桌面渲染进程。

**两个真问题（静态读码看不出来，真机才暴露）**
1. **端口归属校验把 WebView2 宿主全挡在门外**：Tauri / WinUI / .NET WebView2 的监听套接字属于 `msedgewebview2.exe` 子进程，原来 `host/detect.ps1` 与 `host/port-owner.ps1` 只比 `ownerPath == exe`，于是 AI-Pet 被判成"端口被别的进程占用"。改成**顺祖先链认领**（最多 8 级，`Test-OwnedBy` / `Find-AncestorPath`），`ownership.pid` 与 `matchesExe` 都用这个判定。
2. **这个产品没有任何 CSS 变量**（`src/` 里 0 个 `--x:` 定义，构建后的 CSS 也是 0）。原来的自定义 profile 强制要求 `backgroundVar`/`foregroundVar` + 至少一条 `varMap`，等于把"变量化不足"的产品全拒收。

**为此改的内核（都是通用能力，不是给 AI-Pet 打的补丁）**
- `backgroundVar`/`foregroundVar` 与 `varMap` 改为**可选**（空串/空对象合法）；校验仍挡非法变量名与带大括号的选择器。
- 新增两个 profile 字段：
  - `textSelectors`：无变量宿主靠选择器上色——每个模式各压一条 `color: <foreground> !important`（有 `darkClass` 时深色那份挂在模式类下）。只改颜色，不动尺寸与排版。
  - `skipSelector`：**点名不换肤的窗口**。AI-Pet 的桌宠窗口是透明画布，铺壁纸只会让宠物浮在照片上；`.pet-root` 命中即跳过。`withTargets()` 注入前探一次，命中就整个窗口不动（暂停/恢复/移除同样跳过）。
- 校验哨兵：没有背景 token 的宿主读不到色值，改用我们自己的 `--bb-dim` 是否生效来判"注入成功"（`verifyExpression` / `pauseExpression` 多返回 `dim`），`tokenMatch` 返回 `null` 而不是误报 `false`。
- `theme.apply` 的返回补上 `windows`（第 ④ 项加的窗口计数原来没透出到协议层），`theme.pause/resume` 补上 `tokenMatch`。

**真机结果**（`.design/cross-product-live.mjs`，15/15）
- `hosts/ai-pet.json` 通过校验并落到 `%LOCALAPPDATA%\BackdropBuddy\hosts\`；`BACKDROPBUDDY_HOST=ai-pet` 即可切过去。
- 内置「月光花园」导出 `.bbskin`（798 B）→ 在干净目录里导入（`my-mvluxtqa-ml0w`）→ 应用到 AI-Pet：**3 个窗口识别、2 个上屏、桌宠窗口原样不动**；页面底色被打透（`rgba(0,0,0,0)`）、文字压成 `rgb(28,28,30)`、卡片拿到磨砂底；截图见 `.design/cross-ai-pet-888B4D.png`。
- 恢复原貌后三个窗口全部 `layer/style/themed` 清空。
- 宿主文件一个字节都没动（generic profile 不做宿主目录哈希，也不写宿主文件）。

**没做的部分（说清楚边界）**
- **没有把 kernel 拆成独立 npm 包**：它已经是"宿主无关的运行时 + profile 数据"，这次验证的就是这一点；真正抽包要等第二个产品**要随包分发**时再做，现在拆只会多一层版本耦合。
- `Missive` / 网页产品没验证：它们没有桌面壳，要么在浏览器里跑（可以，但那是"给网页换皮"，与本产品叙事不同），要么先给它们套壳——那是另一次决策。
- AI-Pet 的 profile 里 `rendererPattern` 指向 `http://localhost:5199/`（这个 exe 是 devUrl 构建，靠本地静态服务喂 `dist`）；正式分发版若是 `tauri://localhost` 或 `http://tauri.localhost`，要把 profile 的 `rendererPattern` 改一行。
- 向导的 `textSelectors` / `skipSelector` 目前是**手填选择器**，没做成点选；点选需要跨窗口选目标，属于下一步打磨。

### 2.7 系统级主题（边界最远）

从“宿主换肤”扩到 Windows 本体：壁纸、`.deskthemepack`、强调色、任务栏明暗。技术可行，但会与现有“不改宿主文件”的安全承诺形成两套心智模型，且与本产品的核心叙事（宿主运行时皮肤）不同源。

**判断**：不建议在 V1.x 做；若要做，应作为独立产品线而不是本项目的下一个版本。

### 2.8 不建议：AI 生成主题

项目第一条硬边界是“不上传图片、不联网、不建账号”（`docs/PLAN.md` §1.3）。云端生成直接破约；本地跑模型会把安装包从 44 MB 拉高一个量级，且与“主题来自用户自己的素材”这一产品定位冲突。

### 2.9 素材派生（暂缓，原“主题生产链”）

2026-10-23 决定：素材只用你自己上传的图 / 视频，不做造图。以下留作备选，需要时再单独立项。

- **配色抽取**：复用现成亮度分析（`mean/center/p15/p75/p85/p90/p99/highlight`），补主色聚类，自动产出强调色。
- **合成图层**：渐变 / 暗角 / 噪点 / 模糊叠在照片上，作为可开关项。
- **批量**：选一个文件夹，按同一套参数出多个主题。

风险照旧：自动配色容易出“模板脸”，必须保留人工覆盖且不默认改写用户已调参数。

## 3. 优先级与闸门

| 顺序 | 方向 | 理由 | 前置闸门 | 预估 | 状态 |
| --- | --- | --- | --- | --- | --- |
| ① | 宿主 profile 化 + 接入向导（2.1） | 决定天花板 | profile 只读探针 | 4–6 人日 | **已完成 2026-10-23** |
| ② | 残留校对 + 端口提示 + 托盘（2.2 / 2.5 合并） | 决定口碑与“敢常开” | 无 | 2–3 人日 | **已完成 2026-10-23** |
| ③ | 宿主明暗切换适配（2.3） | 决定日常可用性：切深色/浅色不用重新应用 | 复现已完成 2026-10-23 | 0.5–1 人日 | **已完成 2026-10-23**（真机 11/11） |
| ④ | 调度 / 多窗口 / 两个开关消费点（2.4） | 补齐自洽性 | ③ 之后更好做 | 5 人日 | **已完成 2026-10-24**（真机 18+12+6 全绿） |
| ⑤ | 跨产品复用（2.6） | 资产复用 | ① 已完成 | 视产品而定 | **已完成 2026-10-24**（AI-Pet 真机 15/15） |
| — | 素材派生（2.9） | 已决定不做造图 | — | — | 暂缓 |
| — | 系统级（2.7）、AI 生成（2.8） | 越界或破约 | — | — | 不做 |

### 3.1 闸门：profile 只读探针（已通过 2026-10-23）

原计划是“投入 ① 之前先做只读探针”，现已做完并通过：

1. 第二宿主选定为本机 Obsidian（Electron 39.8.3，`app://obsidian.md` 本地渲染）。
2. 只读连 CDP 抓到 160 个 CSS 变量、18 个带背景的面板、`.app-container` 等稳定锚点。注意它**没有** `#root` 也没有 `data-testid`，所以锚点判据要按 class，不能照抄 ZCode。
3. 全程不写宿主文件；试穿跑“应用 → 暂停 → 继续 → 恢复”，恢复后页面干净（`themed: null`）。
4. DeepSeek Harness 作为候选被否：本机起不来（无参数静默 exit 0、带参数 exit 9），且界面是远程登录态页面。

**③ 的闸门同理，且已执行**：2026-10-23 在真机 ZCode 上翻了一次明暗并逐项记录（见 §2.3 复现结果表）。五条假设两条成立、三条被推翻，包括我自己新怀疑的“切模式会让宿主重载”。教训照旧：静态读码得出的缺口表不能当开工依据，先复现。

## 4. 证据索引

| 结论 | 证据 | 性质 |
| --- | --- | --- |
| 适配层曾按 ZCode 写死，现已改为 profile + 注册表 | `kernel/host/adapter.mjs`（现取 `profile.*`）、`kernel/host/registry.mjs` | 静态读取 + 实测 |
| 配色脚本一次产出 light + dark 两套 token | `platform/windows/theme/color.ps1:118-144` | 静态读取 |
| `tokensByMode` 组装并输出双模式 CSS 块 | `kernel/host/adapter.mjs:396-402`、`kernel/host/zcode.mjs` 的 `buildThemeCss` | 静态读取 |
| contrast 两模式同值（故 `:root` 单值暂无可见影响） | `platform/windows/theme/color.ps1:101,118-119` | 静态读取 |
| 渐变底与校验基准只取 apply 那一刻的模式 | 真机：dark 下应用「樱花黎明」翻 light 后底仍是深色渐变；light 下暂停/继续日志 `tokenMatch:false` | **实测成立** |
| 面板 / 文字 token 跟随切换（对照） | 真机：`--color-background` `rgba(18,18,20,0.41)` → `rgba(255,255,255,0.30)` | **实测成立** |
| 翻明暗会导致宿主重载（怀疑） | 真机：翻类前后 CDP page target id 不变、注入层仍在 | **实测不成立** |
| 向导四接口真机通过 | Obsidian 9334：inspect / 真实鼠标点选 / 试穿 / 保存 | 实测 |
| 运行时校验端口归属与指纹 | `kernel/host/detect.mjs:148`、`platform/windows/host/detect.ps1:82`、`kernel/host/detect.mjs:185` | 静态读取 |
| 视频主题注入真实 `<video>` | `kernel/host/zcode.mjs:275-286` | 静态读取 |
| `reducedMotion` / `applyOnStart` 已接上消费点 | `kernel/host/adapter.mjs` 的 `resolveMedia` + `kernel/app/kernel.mjs` 的 `startupTask` | 实测（2026-10-24，真机 12/12） |
| 启动期残留审计已上线（orphan / stale / mismatch / port-conflict） | `kernel/host/adapter.mjs` 的 `audit` / `recordAudit` | 实测（改 pointer 文件复现） |
| 宿主运维脚本已齐（启停/归属/指纹/版本） | `platform/windows/host/`（9 个 ps1） | 静态读取 |
| ffmpeg 不随包 | `docs/PLAN.md` §9.2 | 文档事实 |

## 5. 未验证与待确认

- **明暗切换（③）已复现并已修**：结论与实测见 §2.3。当时的尾巴已经收掉——“用户在设置里点深色/浅色会不会顺带重载页面”经读宿主自己的产物确认**不会**：`F:\shop\ZCode\resources\app.asar` 偏移 327425224 的 `setTheme` 只做 `localStorage.setItem('zcode-theme')` + 类切换 + store 更新（同一组 `classList.toggle` 见偏移 310270383 / 324277602 的启动与运行时赋值），全程没有 `location.reload()`。真机那条路径仍是**用 CDP 同构地写 localStorage + 翻类**复现的，没有真的去点设置页，剩下的差异只有宿主 store 的广播通知，不影响注入层。
- **视频主题在宿主窗口最小化时不播放**：实测 `visibilityState:hidden` 下 `<video>` 停在 `currentTime 0 / paused`，把窗口还原后自行开始播放（2.73s → 4.16s）。这是 Chromium 对隐藏文档的常规行为，不是注入坏了，也不需要改；只是别把“最小化时看不到动画”当成 bug 报。
- **多窗口的“真实第二窗口”只验到 ZCode 一种**：构造方式是宿主自己的 `window.open(同一个渲染 URL)`（浏览器级 CDP 的 `Target.createTarget` 在 Electron 上返回 `Not supported`，用不了）。Obsidian / 向导接入的自建 profile 多开窗口时是否也给出同样形态的 page target，未实测；`secondaryPattern` 排除辅助小窗这条只对 ZCode 的 `?windowKind=` 设过。
- **多显示器没有单独验证**：实现按“每个渲染窗口一份”处理，同一窗口跨屏移动不涉及注入；多屏不同 DPI 下的视觉只做过单窗口观察，未做双屏实测。
- **调度只验到“宿主开着”的路径**：时刻型与宿主明暗型在真机各命中一次（到点后 4s 换肤）；系统明暗型依赖 `SystemEvents.UserPreferenceChanged`，事件订阅与去抖是静态代码，**未真实触发过一次系统切换**。另外应用被彻底退出（不是最小化到托盘）时不会有任何计时器，规则要等下次开机才生效——这是设计取舍，不是缺陷，但用户不一定预期得到。
- **宿主页面自己重载过一次且原因未定**：2026-10-24 的真机跑动里观察到 ZCode 渲染进程在应用没开的时候变回过素页面（`adopted theme is no longer injected / page-clean`）。皮肤随重载丢失是已知设计（注入不跨文档），当时的补应用逻辑把它接住了；但“为什么会重载”没归因，不写成结论。
- **跨产品（⑤）只在 AI-Pet 上验过，且用的是 devUrl 构建**：那个 exe 指向 `http://localhost:5199/`，我是用一个本地静态服务喂它的 `dist` 才跑起来；正式分发版的页面 URL（`tauri://localhost` / `http://tauri.localhost`）没有验，profile 的 `rendererPattern` 可能要改一行。其余自家产品（尺素集 / AI-Image-Studio / Cen-Memory 等）都是网页或小程序，没有可挂的桌面渲染进程，**没有验证**。
- **无变量宿主的观感只做到"背景层 + 面板透明/磨砂 + 文字色"**：卡片磨砂用的是固定的白 0.16 / 黑 0.18，不跟主题走；深色主题在无变量宿主上只能换背景与文字色，图标、插画、渐变按钮都不动。要更像样需要给宿主补一层变量，或者内核长出"选择器组 → 前景/背景/边框/圆角"的映射表，属下一步。
- **接入向导的第三个宿主**：目前只在 Obsidian（本地 `app://` 渲染）上验证过。远程登录态页面（DeepSeek Harness 那类）与 VSCode 系（workbench 多层 webview）未验证，可能点不出稳定锚点。
- **端口被外部进程连接的实际影响**：只确认了“本机可达”这一形态；没有做任何越权/干扰实验。
- **残留注入层的实际发生频率**：强杀场景未构造，属推断（orphan 链路本身已用改 pointer 文件的方式复现过一次）。
- **自家产品是否为 Electron/WebView 壳**：未核对。
- 本文所有工期均为估算，未做分解排期；一旦立项，应按 P 阶段格式重写成 `PLAN.md` 的新章节，而不是直接照着本表干。
