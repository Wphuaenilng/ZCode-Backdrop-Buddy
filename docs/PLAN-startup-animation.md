# 启动动画计划

> 状态：线 B（BackdropBuddy 自身启动动画）已实现并实测；线 A（ZCode 主题启动动画）未执行
> 日期：2026-10-23
> 范围：ZCode 主题启动动画（主线）+ BackdropBuddy 自身启动动画（支线）
> 事实来源：ZCode 3.16.x 安装包源码、本机 `shell.log`、BackdropBuddy 现有代码

---

## 1. 目标与结论

**主线目标**：让主题携带启动动画，在 ZCode 启动首帧生效，且不修改宿主安装文件。

**实现路线**：BackdropBuddy 启动 ZCode 时提前挂浏览器级 CDP，在页面第一个脚本执行前注入固定启动模板。

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

以下详细计划只展开线 A；线 B 单独排期。

---

## 4. 阶段与任务

### Phase 0：技术 spike（0.5–1 人日）

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

### Phase 1：启动期注入链路（2–3 人日）

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

### Phase 2：主题模型与 UI（2–3 人日）

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

---

## 5. 验收指标

| 指标 | 目标 |
|---|---|
| 注入成功率 | ≥95%（20 次启动） |
| 端口开放到 attach | ≤300ms |
| 启动层首帧 | 早于 ZCode 默认 logo 绘制 |
| 宿主卡死次数 | 0 |
| 启动层总时长 | 0.9–1.2s；未就绪时最长 3.5s |
| 宿主文件改动 | 0 |
| 启动期网络请求 | 0 |
| 启动图体积 | ≤500KB（建议 1920px JPEG/缩略图） |

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

## 8. 待确认的决策点

1. **生效边界**：接受「只在 BackdropBuddy 启动 ZCode 时生效」吗？若要求所有启动方式都生效，方案要改成 asar/上游/覆盖窗，成本和风险都会变。
2. **spike 授权**：实测需要重启当前正在运行的 ZCode（会中断当前窗口），或尝试用临时 profile 起第二个实例。是否允许？
3. **预设数量**：V1 两个预设是否够，还是先只做一个 `zcode-pop`？
4. **交付顺序**：先单独交付 BackdropBuddy 自身启动动画（1 人日、低风险），还是先攻 ZCode 主线（5–7 人日、需 spike）？

---

## 9. 建议排期

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
