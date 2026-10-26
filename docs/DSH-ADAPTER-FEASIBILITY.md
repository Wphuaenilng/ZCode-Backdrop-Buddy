# DSH 接入 BackdropBuddy：源码评估与适配方案（评审稿）

> 日期：2026-10-26  
> 状态：待评审，未实施  
> 结论级别：源码与架构层面可行，尚未在真实 DSH 环境验证  
> 评审范围：图片／视频壁纸、外观参数、应用／暂停／继续／恢复、持久化、调度与多宿主接入

## 0. 文档目的与结论

本文回答三个问题：

1. `dsh-wallpaper-engine` 与 `dsh-dream-skin` 分别如何实现 DSH 壁纸和换肤。
2. 它们能否帮助 BackdropBuddy 支持 DeepSeek Harness（DSH）。
3. 如果继续实施，推荐的架构、边界和验收标准是什么。

### 0.1 结论摘要

**需要修正此前“没办法给 DSH 使用 BackdropBuddy”的宽泛表述。更准确的结论是：现有“CDP＋页面注入”路径不能直接套用到 DSH，但可以通过 DSH 插件机制新增一条适配通道。**

推荐形态为：

> **保留现有 BackdropBuddy，新增一个 `dsh-plugin-backdropbuddy` 配套插件，并在内核中增加 DSH host adapter。**

这意味着：

- 不重写现有 WPF 管理器、主题库、`.bbskin`、调度和宿主切换体系。
- 不继续把 DSH 硬塞进通用 CDP profile。
- 不直接改写两个参考插件的私有配置，也不要求用户同时安装它们。
- 参考两个项目的加载方式、壁纸层、媒体服务、DSW 令牌、持久化和生命周期清理。
- 第一版只验证图片、视频和 BackdropBuddy 已有核心操作，不引入 Scene、WebWallGL 或完整液态玻璃系统。

如果只是希望“DSH 里有壁纸”，直接使用现成插件即可；如果希望“由 BackdropBuddy 的主题库、参数和调度统一管理 DSH”，配套插件路线有实际价值。

### 0.2 建议评审决策

| 编号 | 决策点 | 本文建议 | 状态 |
| --- | --- | --- | --- |
| D1 | DSH 接入路线 | 使用 DSH 插件机制，不走通用 CDP 注入 | 待确认 |
| D2 | 与参考插件的关系 | 新做轻量配套插件，参考源码，不直接驱动其私有状态 | 待确认 |
| D3 | BackdropBuddy 与插件的桥接 | 首版采用带版本号和 revision 的原子 JSON 状态桥 | 待确认 |
| D4 | 第一版媒体范围 | 图片＋视频；不做 Scene／Web／WebWallGL | 待确认 |
| D5 | 表面所有权 | 同一时刻只允许一个插件接管 DSH 背景与相关令牌 | 待确认 |
| D6 | 持久化 | 使用宿主端文件，不把 localStorage 当权威存储 | 待确认 |
| D7 | 首个验证目标 | 建议先验证 Windows 上的 DSH Desktop，再评估 web profile | 待确认 |

## 1. 证据范围与判读规则

### 1.1 三类表述

本文使用以下标记区分确定性：

- **【源码事实】**：在当前工作区或参考仓库源码中直接读到。
- **【设计建议】**：为 BackdropBuddy 提出的新设计，尚未实施。
- **【待真机验证】**：必须通过实际 DSH 环境才能确认的行为或兼容性。

“参考插件已经实现某能力”不等于“BackdropBuddy 已经完成该能力”，也不等于“当前用户的 DSH 版本已经验证兼容”。

### 1.2 参考源码基线

| 项目 | 读取版本 | 提交 | 上游 |
| --- | --- | --- | --- |
| `dsh-wallpaper-engine` | `1.4.0` | `699b651bfd79d5263369268076f2c14d156ddd68` | <https://github.com/elysia395/dsh-wallpaper-engine> |
| `dsh-dream-skin` | `10.26.1` | `79ae16a71bcb9115e6dc9c02345e94ca4d38c1c1` | <https://github.com/RevolutionLA/dsh-dream-skin> |

本地参考源码位于：

- `.design/reference/dsh-wallpaper-engine/`
- `.design/reference/dsh-dream-skin/`

BackdropBuddy 部分基于 2026-10-26 当前工作区静态阅读。本文没有修改运行时代码，也没有把参考项目的测试结果当作 BackdropBuddy 的验证结果。

## 2. 为什么现有 CDP 路径不能直接等同于 DSH 支持

### 2.1 当前适配器依赖 CDP 会话

**【源码事实】** `kernel/host/adapter.mjs:117-135` 的 `createHostAdapter()` 默认以 `openCdp` 创建会话，并从 profile 取得 CSS 构建、注入表达式、快照、校验、暂停和移除函数。当前内置宿主注册表只有 ZCode 和 ChatGPT，其他向导宿主仍转换为 generic profile，见 `kernel/host/registry.mjs:6-53`。

因此，现有路径擅长的是：

1. 找到开放调试端口的宿主页面。
2. 通过 CDP 在页面中执行表达式。
3. 注入 BackdropBuddy 自有的 style、背景层和视频元素。
4. 再通过 CDP 读取 DOM／计算样式进行校验和恢复。

它不是“任意宿主都能直接使用的通用文件协议”，也不是 DSH 插件协议。

### 2.2 此前 DSH 探针结论的正确边界

**【源码事实】** `docs/PLAN-v2-expansion.md:34` 记录了当时对 DeepSeek Harness `0.2.1-rc.2` 的实测：无参数启动静默 `exit 0`，带参数 `exit 9`；界面来自远程登录态页面。`docs/PLAN-v2-expansion.md:327` 因此将 DSH 排除为当时的第二宿主候选。

这些记录可以支持：

- 当时那条启动和 CDP profile 路线没有形成可用接入。
- 远程 DOM 不适合作为通用点选 profile 的稳定基准。

它们不能单独证明：

- 所有 DSH 版本都无法启动。
- DSH 永远没有可用调试端口。
- DSH 插件无法改变页面背景。
- BackdropBuddy 永远无法支持 DSH。

### 2.3 两个参考项目提供的是另一条路

**【源码事实】** 两个参考项目都通过 DSH 插件清单加载宿主端和浏览器端代码。浏览器端本来就在 DSH 页面中运行，因此不需要 BackdropBuddy 从外部取得 CDP 会话后才能绘制背景。

**【设计建议】** 对 DSH 应新增“插件型 adapter”，而不是继续增加一套 DSH 专用 CDP 选择器。

## 3. 参考项目一：`dsh-wallpaper-engine`

### 3.1 插件如何被 DSH 加载

**【源码事实】**

- `package.json:159-169` 声明 `dsh.bundle.patch` 和 `dsh.client`。
- `cordis.patch.yml:21-30` 向宿主配置插入主插件行，后续行加载其他组件。
- `lib/index.js:186-198` 通过 `inject = ['webServer']` 声明宿主端 Web 服务依赖。
- `package.json:34-37` 导出浏览器端 `./client`。

这是主包加多个子包的完整插件系统，不只是一个 CSS 文件或一段页面注入脚本。

### 3.2 Host 半边：清单、设置与媒体字节

**【源码事实】** 宿主端主要承担：

- 枚举 Wallpaper Engine 和自定义壁纸。
- 注册 inventory、media、preview、settings 等路由，见 `lib/index.js:251-294`、`442-450`。
- 通过 token 将请求映射到磁盘文件，而不是让浏览器提交任意路径。
- `/media` 和 `/preview` 只允许 GET／HEAD，并通过 `serveFile` 提供 Range、HEAD 等能力，见 `lib/routes/media-bytes.js:33-90`。
- 设置保存到 `~/.dsh-wallpaper-engine/config.json`，见 `lib/index.js:442-445` 与 `docs/HOW-IT-WORKS.md:126`。

**对 BackdropBuddy 的价值：**DSH 插件 Host 半边可以读取本地文件并向自己的 Client 半边提供实际媒体字节，因此不必复用 BackdropBuddy 管理器内部的虚拟媒体域名。

### 3.3 Client 半边：壁纸层、遮罩与透明宿主表面

**【源码事实】**

- `.we-layer` 是 `position: fixed; inset: 0; z-index: -2` 的全屏层，见 `src/styles-base.js:97`。
- `.we-scrim` 位于 `z-index: -1`，见 `src/styles-base.js:206-216`。
- 两层都设置 `pointer-events: none`，避免截获聊天界面输入。
- 壁纸激活时，`body[data-we-wallpaper]` 将 `--dsw-alias-bg-base` 和 `--dsw-specific-sidebar-fill` 设为透明，见 `src/styles-base.js:218-225`。
- 图片使用 `<img>`，视频通过专用视频通道构建 `<video>`，Scene／Web 则另有 iframe／WebWallGL 管线，见 `src/media-prep.js:585-675`、`src/video-layer.js:212-265`。
- 视频实现包含自动播放、循环、`playsinline`、预加载和 poster 等处理，见 `src/video-layer.js:229-265`。

**对 BackdropBuddy 的价值：**图片／视频背景不需要再通过外部 CDP 创建；插件 Client 可以直接拥有这些元素及其生命周期。

### 3.4 播放、遮挡和卸载清理

**【源码事实】**

- Client 在 `ctx.effect` 中订阅状态并注册可见性、焦点等监听，见 `src/client.js:5826-5977`。
- 播放控制会根据有效播放状态调用 `video.pause()` 或 `video.play()`，并记录浏览器拒绝播放的结果，见 `src/client-audio-playback.js:151-176`。
- 卸载时停止绘制、释放媒体、移除壁纸层与遮罩、清理效果并撤下激活标记，见 `src/client.js:6048-6067`。
- `clearEffects()` 成对删除插件拥有的 CSS 变量和属性，见 `src/effects.js:671-714`。
- 参考项目还针对 Desktop 拖窗区域给全屏层设置 `-webkit-app-region: initial`，见 `src/styles-base.js:97`、`209-215`。

**【待真机验证】**BackdropBuddy 配套插件需要在自己的 DSH 目标上重新验证：暂停是否真正停止解码、最小化恢复是否白帧、全屏负 z-index 图层是否影响拖窗和点击。

### 3.5 应该参考与不应整体搬入的部分

| 适合参考 | 第一版不应整体搬入 |
| --- | --- |
| Host／Client 双面插件结构 | Steam 与 Wallpaper Engine 库扫描 |
| 受限媒体路由、Range／HEAD | WebWallGL 与 Scene 渲染 |
| 图片／视频图层和 poster | Web 壁纸 iframe 与 WE API shim |
| 视频播放／暂停和错误状态 | 转码、帧率上限和 faststart 优化 |
| `ctx.effect` 清理与可见性处理 | 完整液态玻璃、字体、吉祥物、桌宠等系统 |
| DSW 表面令牌与可读性下限思路 | 与 BackdropBuddy 无关的设置 UI |

## 4. 参考项目二：`dsh-dream-skin`

### 4.1 以 DSH 主题运行时管理配色

**【源码事实】**

- `package.json:84-98` 声明浏览器端依赖 runtime、locale、theme 和 settings 等服务。
- `lib/client.js:8868-8872` 声明 `slots`、`locale`、`theme` 注入。
- `lib/client.js:8900-8916` 使用 `ctx.theme.register()` 注册主题，并保存 disposer。
- `lib/client.js:8952-8971` 使用 `ctx.theme.setTheme()` 恢复主题。
- `lib/client.js:2693-2713` 使用 `ctx.theme.overrideTokens()` 叠加或撤下令牌覆盖。
- `lib/client.js:6813-6851` 将 accent 映射到 brand、business primary、主按钮填充和 dimmed 等令牌，并为明暗模式提供 `{ light, dark }` 值。

**对 BackdropBuddy 的价值：**配色可以优先通过 DSH 的主题运行时和令牌层完成，而不是完全依赖易变的 CSS Module 哈希类名。

### 4.2 壁纸仍然是独立背景层

**【源码事实】**`lib/client.js:7688-7769` 在需要时创建固定定位的壁纸 `div`，通过 `document.body.prepend()` 插入，设置 `z-index: -1`、`pointer-events: none`、背景尺寸、位置、缩放和模糊，再调用令牌着色逻辑。

因此，“使用原生主题 API”并不等于“只改令牌就能得到任意壁纸”。图片背景层和表面令牌需要配合。

### 4.3 宿主文件才是跨 origin 的权威持久化

**【源码事实】**

- Host 半边通过 `inject = ['webServer']` 注册 `/dream-skin/api`，见 `lib/index.js:105-108`、`615-643`。
- 权威状态位于 `$DSH_HOME/dream-skin.json`，见 `lib/index.js:136-141`。
- 写入采用临时文件＋rename，并带 Windows 锁定时的回退处理，见 `lib/index.js:188-204`。
- Client 明确区分内存、localStorage 和宿主文件：Desktop 每次启动可能改变端口，origin 随之变化，单独依赖 localStorage 会丢失状态，见 `lib/client.js:1868-1886`。

**对 BackdropBuddy 的价值：**DSH 壁纸状态应保存在宿主端；localStorage 可以作为首帧缓存，但不能作为跨重启唯一真源。

### 4.4 对本任务的局限

**【源码事实】**该项目核心是主题、静态图片／URL／渐变壁纸、玻璃参数、accent 和主题包。当前壁纸构建逻辑不是 BackdropBuddy 所需的完整视频控制协议。

因此适合参考：

- `ctx.theme` 与 `overrideTokens()` 的使用方式。
- accent 和明暗双模式令牌。
- 设置槽与 disposer 管理。
- 宿主端持久化和动态端口问题。

不适合单独承担：

- BackdropBuddy 视频壁纸。
- 外部管理器的应用／暂停／继续／恢复命令。
- BackdropBuddy 调度与多宿主状态闭环。

## 5. BackdropBuddy 已有哪些可复用能力

### 5.1 可以直接保留的部分

| 能力 | 当前实现 | 对 DSH 方案的意义 |
| --- | --- | --- |
| 主题记录 | `backdropbuddy.theme/1`，见 `kernel/store/record.mjs:3-18` | DSH adapter 可继续消费同一主题记录 |
| 外观参数 | `mode/x/y/zoom/hpos/safe/task/bubble/panel/accent`，见 `kernel/store/record.mjs:5-18` | 大部分可映射到媒体 CSS 和 DSW 令牌 |
| 图片／视频库 | `kernel/store/library.mjs:31-49`、`73-99` | 继续使用既有媒体校验和主题目录 |
| `.bbskin` 与导入导出 | 现有 pack／library 流程 | 不需要为 DSH 另建主题格式 |
| 应用与状态事务 | `kernel/handlers/theme-state.mjs:35-94` | `host.apply()` 成功后才写当前主题指针 |
| 暂停／继续 | `kernel/handlers/theme-state.mjs:96-124` | `host.pause()/resume()` 成功后才写 paused |
| 调度 | `kernel/schedule/service.mjs:26-72` 最终仍调用 `applyThemeState()` | DSH adapter 接入后可复用调度，不另写 DSH 排程器 |
| 宿主记忆 | `kernel/handlers/theme-state.mjs:61-66`、`kernel/host/switch.mjs:69-87` | 可继续保存 `hostThemes.dsh` |
| 减弱动效 | 视频退为首帧图，见 `kernel/host/adapter.mjs:368-382` | DSH 路径应保持同一产品语义 |

### 5.2 必须新增或调整的部分

#### A. 新增插件型 host adapter

**【源码事实】**当前 `createHostAdapter()` 与 CDP detect／session／expression 模型深度绑定，见 `kernel/host/adapter.mjs:117-175`。

**【设计建议】**新增独立 DSH adapter，并在装配处按 profile 类型选择，而不是强迫 DSH profile 提供一堆无意义的 CDP expression。装配点位于 `kernel/app/kernel.mjs:103-147`。

#### B. 新增外部桥接契约

**【源码事实】**当前管理器协议为 `dreamskin.manager/1`，见 `shared/protocol/constants.mjs:1`；内核通过 `attachStdio()` 接收 NDJSON 请求，见 `kernel/transport/stdio.mjs:20-35`、`61-100`。它不是现成的、供 DSH 插件调用的 HTTP API。

**【设计建议】**首版新增一个小型、版本化的 DSH 桥接契约，不让插件接管或复制 WPF↔内核 stdio 会话。

#### C. 提供 DSH 可访问的真实媒体路由

**【源码事实】**管理器内部媒体 URL 使用 `https://media.backdropbuddy.invalid/...`，见 `kernel/media/url.mjs:1-8`。这个地址属于 BackdropBuddy 自己的媒体处理体系，不能直接假设 DSH 页面也能解析。

**【设计建议】**DSH 插件 Host 半边必须提供自己的受限媒体路由，直接读取经过白名单校验的 BackdropBuddy 主题媒体。

#### D. 不让插件直接读取全局 pointer 作为命令真源

**【源码事实】**当前 `pointer.json` 保存的是管理器当前活动主题、参数、paused 和 revision，见 `kernel/store/pointer.mjs:3-38`；宿主切换时还存在每宿主主题记忆和 adopt／audit 过程，见 `kernel/host/switch.mjs:31-87`。

**【设计建议】**使用 DSH 专用 desired-state 文件。插件直接监听全局 pointer 会带来两个问题：

1. 切换到其他宿主后，全局当前主题不一定代表应该应用到 DSH 的主题。
2. pointer 不含客户端应用回执，也没有表达 DSH 各窗口实际状态的契约。

## 6. 路线比较

| 路线 | 优点 | 主要问题 | 结论 |
| --- | --- | --- | --- |
| A. 继续生成 DSH 通用 CDP profile | 理论上少一个插件 | 依赖可连接目标和外部注入；此前探针未形成可用路径；远程 DOM 与稳定锚点仍有风险 | 不作为主路线 |
| B. BackdropBuddy 直接改写参考插件配置或调用其内部 API | 看似可以复用现成渲染器 | 本次未发现面向外部管理器的稳定、版本化控制契约；配置、inventory token、动态端口和实时通知均会耦合其内部实现 | 不作为主路线 |
| C. 新增 BackdropBuddy 配套 DSH 插件 | 职责清晰，可复用 BackdropBuddy 主题与调度，直接拥有 DSH 内生命周期 | 需要新增插件、adapter 和桥接契约 | **推荐** |
| D. 把 WPF 管理器整体移植成 DSH 插件 | 理论上单进程 | 重复主题库、调度和产品 UI，改造成本与维护面最大 | 不推荐 |
| E. 只把主题导出成 Dream Skin 主题包 | 静态换肤较简单 | 不覆盖视频、暂停、调度和统一控制；仍是另一套主题格式与工作流程 | 可作为未来附加功能，不是本次方案 |

补充说明：两个参考项目均声明 MIT 许可证。若后续直接复制代码而非仅参考设计，应保留相应版权和许可证文本；代码许可证不自动覆盖第三方壁纸、图标或其他素材权利。

## 7. 推荐架构

### 7.1 总体结构

```text
┌──────────────────────────────────────────────────────┐
│ BackdropBuddy WPF / WebView2                         │
│ 主题库、参数、调度、宿主切换、用户操作                │
└───────────────────────┬──────────────────────────────┘
                        │ 现有 dreamskin.manager/1（stdio）
┌───────────────────────▼──────────────────────────────┐
│ BackdropBuddy Node kernel                            │
│ 新增 DSH host adapter                                │
│ 解析主题与合并参数、分配桥接 revision、等待应用回执  │
└───────────────────────┬──────────────────────────────┘
                        │ 原子 DesiredState / Status 文件
┌───────────────────────▼──────────────────────────────┐
│ dsh-plugin-backdropbuddy：Host 半边                  │
│ 校验状态、提供受限媒体路由、保存镜像、汇总客户端状态 │
└───────────────────────┬──────────────────────────────┘
                        │ DSH 同源 state / media / status 路由
┌───────────────────────▼──────────────────────────────┐
│ dsh-plugin-backdropbuddy：Client 半边                │
│ 图片/视频层、DSW tokens、播放控制、实际应用回执      │
└──────────────────────────────────────────────────────┘
```

### 7.2 BackdropBuddy DSH adapter

**【设计建议】**adapter 至少实现现有上层需要的以下语义：

- `detect/status`：桥接目录、插件 Host、Client 和最近回执是否可用。
- `apply`：解析主题与媒体，合并参数，写新 desired revision，等待实际应用回执。
- `pause/resume`：写 paused 状态并等待对应 revision 回执。
- `reset`：恢复默认参数，保留主题，并保持当前 paused 语义。
- `restore`：写入 `theme: null`，等待图层和令牌清理回执。
- `adopt/audit`：BackdropBuddy 或 DSH 重启后，对账 desired、status、宿主记忆和实际 Client 状态。
- `observeMode`：优先使用 DSH 主题状态；无法可靠观察时，调度器应按现有 null／未知语义处理，而不是猜测。

**关键事务要求：**adapter 不能只“成功写入 JSON”就向上层报告已应用。现有 `applyThemeState()` 会在 `host.apply()` 返回后写 pointer；如果 DSH Client 尚未应用，UI 就会出现假成功。因此 `apply/pause/resume/restore` 应等待状态回执，或在超时时明确返回可诊断错误。

### 7.3 配套插件 Host 半边

**【设计建议】**

1. 通过 `inject = ['webServer']` 注册同源路由。
2. 通过显式插件配置获知 BackdropBuddy 数据根目录，不假设所有环境都使用默认 `%LOCALAPPDATA%` 路径。
3. 读取并校验 desired-state，不信任浏览器提交的磁盘路径。
4. 将媒体描述转换为短期或 revision 绑定的 token，再提供 `/media/<token>`。
5. 媒体只来自 BackdropBuddy 的 `themes/builtin` 和 `themes/user` 合法主题目录。
6. 对视频支持 GET、HEAD 和 Range，返回正确 MIME 和错误状态。
7. 接收 Client 的实际应用／错误回执，原子写入 status-state。
8. 保存最后一份有效 desired 镜像，供 DSH 单独重启时恢复。
9. 插件卸载时注销路由、停止 watcher 和未完成请求。

### 7.4 配套插件 Client 半边

**【设计建议】**

1. 创建 BackdropBuddy 自有背景层和遮罩层，使用固定 id／属性，`pointer-events: none`。
2. 图片使用 `<img>`；视频使用 `<video>`，并处理 poster、循环、自动播放拒绝和解码错误。
3. 使用 revision 保证同一状态只应用一次，避免轮询导致视频反复重建。
4. 优先通过 `ctx.theme.overrideTokens()` 管理配色；必要的少量 CSS 只使用稳定属性锚点。
5. 暂停时隐藏背景并暂停视频，同时撤下 BackdropBuddy 令牌覆盖；继续时按当前 desired 恢复。
6. 恢复时停止视频、移除 `src`、移除图层和样式、dispose 令牌覆盖，恢复 DSH 原貌。
7. 在图片解码、视频可播放或实际失败之后发送状态回执；不能把“DOM 已插入”当作“媒体已成功显示”。
8. 所有监听、定时器、DOM、媒体和令牌覆盖均挂到 `ctx.effect` 生命周期。

### 7.5 状态同步方式

**【设计建议】**首版不必引入新的网络端口：

- BackdropBuddy adapter 原子写 desired-state。
- DSH Host 监听文件变化，并更新内存快照。
- DSH Client 通过同源路由读取状态；可以采用低频轮询，只有 revision 改变才触发实际重建。
- Client 将每个窗口／页面的应用结果回报 Host，Host 汇总并原子写 status-state。
- BackdropBuddy adapter 读取 status-state，完成事务和 audit。

轮询间隔、文件 watcher 丢失事件时的补偿频率，以及多窗口回执聚合策略属于实现期验证项，不应在未测试前写成性能承诺。

## 8. 建议桥接契约

以下均为**【设计建议】**，不是当前已有文件格式。

### 8.1 DesiredState 示例

```json
{
  "schema": "backdropbuddy.dsh-desired/1",
  "hostId": "dsh",
  "revision": 42,
  "updatedAt": "2026-10-26T07:00:00.000Z",
  "theme": {
    "id": "my-example",
    "name": "示例主题",
    "source": "user",
    "media": {
      "kind": "video",
      "file": "media.mp4",
      "thumb": "thumb.jpg"
    }
  },
  "params": {
    "mode": "cover",
    "x": 50,
    "y": 50,
    "zoom": 100,
    "hpos": 0,
    "safe": "auto",
    "task": "auto",
    "bubble": 0,
    "panel": 30,
    "accent": "#6f9275"
  },
  "paused": false,
  "reducedMotion": false
}
```

恢复原貌不需要另一种命令通道，只需递增 revision 并写：

```json
{
  "schema": "backdropbuddy.dsh-desired/1",
  "hostId": "dsh",
  "revision": 43,
  "updatedAt": "2026-10-26T07:01:00.000Z",
  "theme": null,
  "params": null,
  "paused": false,
  "reducedMotion": false
}
```

### 8.2 StatusState 示例

```json
{
  "schema": "backdropbuddy.dsh-status/1",
  "hostId": "dsh",
  "clients": [
    {
      "clientId": "desktop-main",
      "attemptedRevision": 42,
      "appliedRevision": 42,
      "state": "running",
      "mediaReady": true,
      "error": null,
      "updatedAt": "2026-10-26T07:00:00.200Z"
    }
  ]
}
```

### 8.3 契约不变量

1. `schema` 不兼容时必须拒绝新状态并报告错误；除收到明确的恢复命令外，保留最后一份有效画面和镜像。
2. `hostId` 不是 `dsh` 的状态不得被该插件应用。
3. 每次 desired 写入都分配新的桥接 revision；同一 revision 重试必须幂等。
4. **桥接 revision 应独立持久化，不应直接复用 `pointer.revision`。**现有 pointer 只在宿主操作成功后更新；失败重试若改变内容却仍使用旧 revision，Client 可能错误忽略新状态。
5. Client 回执必须包含 `attemptedRevision`，并以 `appliedRevision` 单独表示最后实际成功应用的版本；失败时二者可以不同。Host 仅“收到文件”不等于 Client 已应用。
6. `theme: null` 表示恢复原貌，并清除插件保存的持久镜像。
7. `paused: true` 只对有主题的状态有效；暂停状态也需要跨重启保存。
8. `media.file` 和 `thumb` 只允许合法文件名；浏览器不得提交任意绝对路径。
9. 无效新媒体不得替换插件的最后一份有效镜像；应写入诊断状态并给 BackdropBuddy 返回失败。
10. desired 与 status 都必须原子写，读取方需要容忍文件暂时不存在，但不能把损坏 JSON 当作“用户已恢复”。
11. 首版一个桥接目录只绑定一个明确的 DSH 目标实例；后续若同时支持 desktop／web 或多实例，必须增加目标标识并隔离状态，不能仅凭 `hostId: "dsh"` 共用同一份 desired／status。

## 9. BackdropBuddy 参数到 DSH 的映射

| BackdropBuddy 参数／状态 | DSH 建议映射 | 评审注意点 |
| --- | --- | --- |
| `media.kind=image` | `<img>` 或背景图片层 | 应等待 decode／load 后再回执成功 |
| `media.kind=video` | `<video>`＋poster | 浏览器解码能力不等于文件扩展名；失败必须可见 |
| `mode=auto/cover` | `object-fit: cover` | `auto` 当前默认行为需保持一致 |
| `mode=contain` | `object-fit: contain` | 是否补模糊底或纯色底需视觉验收 |
| `mode=stretch` | `object-fit: fill` | 与现有 `100% 100%` 的视觉效果对照 |
| `x/y` | `object-position`／背景位置 | 用同一组测试图核对构图 |
| `zoom` | 媒体层 `scale`，外层裁切 | 避免模糊边缘、拖窗区和合成层问题 |
| `hpos` | DSH 专用构图换算 | **待确认**；不能无意间复制 ZCode 的宿主特定系数 |
| `safe` | 独立 scrim／方向渐变 | `auto` 护左是否符合 DSH 布局需截图验证 |
| `task=auto/ambient/focus` | 面板模糊、遮罩、文字保护档位 | 第一版只做少量稳定锚点，不做完整玻璃系统 |
| `panel` | `--dsw-alias-bg-layer-*`、sidebar fill 等 | 需要明暗两套和可读性下限 |
| `bubble` | `--dsw-specific-bubble` 及必要的高亮色 | 不应把气泡透明度误用到所有弹窗 |
| 输入区域相关 panel／task | `--dsw-specific-input-major` | 与 tool popup 共用令牌时需检查影响面 |
| `accent` | brand、business primary、button primary、link 等 | 主按钮文字色也应按对比度调整，不能一律白色 |
| 明暗模式 | `overrideTokens()` 的 `{ light, dark }` 值 | 不要只保存应用那一刻的单模式静态色 |
| `lock/custom` | BackdropBuddy 管理器侧元数据 | 不需要作为 DSH 视觉命令发送 |
| `reducedMotion` | 视频退为首帧；无首帧时退回无媒体底 | 与现有产品语义保持一致 |

参考依据：

- 面板层令牌：`.design/reference/dsh-wallpaper-engine/src/styles-base.js:236-275`。
- 输入框与气泡令牌：`.design/reference/dsh-wallpaper-engine/src/styles-shell.js:35-64`。
- accent 与按钮文字对比度：`.design/reference/dsh-wallpaper-engine/src/styles-chrome.js:102-123`。
- Dream Skin accent 列表：`.design/reference/dsh-dream-skin/lib/client.js:6813-6851`。

## 10. 操作语义与状态边界

| 操作／场景 | 推荐语义 | 必须避免 |
| --- | --- | --- |
| 应用 | 写新 revision，等待实际媒体与令牌应用回执，再提交管理器 pointer | 只写文件就显示成功 |
| 暂停 | 隐藏壁纸、暂停视频、撤下外观覆盖，保留主题和 paused 持久状态 | 只把视频暂停但仍让页面保持玻璃覆盖 |
| 继续 | 按同一 desired 恢复壁纸、令牌和播放 | 重建为另一主题或丢失参数 |
| 重置参数 | 使用默认参数重新应用同一主题；若之前 paused，仍保持 paused | 意外解除暂停或清空主题 |
| 恢复原貌 | `theme: null`，清媒体、图层、样式和令牌，再清管理器当前主题 | 残留透明表面或后台视频解码 |
| DSH 重启 | 插件从最后有效镜像恢复；Manager 后续可对账 | 只依赖 localStorage |
| BackdropBuddy 重启 | DSH 可继续显示；adapter 通过 revision／status 认领或报告差异 | 无对账就假定两端一致 |
| 切换到其他宿主 | 不把其他宿主的主题写入 DSH desired | 全局 pointer 变化导致 DSH 跟着误切换 |
| 切回 DSH | 结合 `hostThemes.dsh`、desired 和 status 做 adopt／audit | 强行覆盖用户已在 DSH 侧确认的新状态 |
| 插件禁用／重载 | `ctx.effect` 清理所有自有资源；重载后按持久状态恢复 | 路由、监听器、视频或样式重复累积 |
| 其他皮肤插件接管 | 首版要求明确单一所有者；自动让路策略另行评审 | 多插件同时写同一背景与令牌 |

## 11. 安全、兼容与性能边界

### 11.1 文件与路由安全

**【设计建议】**

- 只允许 `source=builtin|user`、合法主题 id 和合法媒体文件名。
- Host 负责拼接真实路径，并使用 `path.resolve`、相对路径检查和真实路径检查阻止越界。
- 是否允许 symlink 应明确；首版建议拒绝通过 symlink 逃出主题根目录。
- 沿用当前媒体大小限制和格式校验；当前 CDP adapter 的大小检查为 300 MiB，见 `kernel/host/adapter.mjs:341-355`。
- 路由只允许必要方法；视频必须处理 Range、HEAD、非法范围和客户端断开。
- 同源／回环检查只是安全边界之一，不能把“来自本机”当作路径授权。
- 状态回执只接受 Host 已发布的 revision 和合法 clientId，不能让其他页面伪造“应用成功”。
- 第一版不渲染第三方 HTML，不引入 `iframe allow-scripts`，缩小攻击面。

### 11.2 DSH 版本与上游变化

**【待真机验证】**

- 当前 DSH 实际内核版本、Node 版本和插件加载方式。
- `webServer`、`ctx.theme`、`ctx.effect` 在目标版本中的真实行为。
- DSH Desktop 与 web profile 的差异，不应用桌面外部版本号推断内核版本。
- `--dsw-*` 令牌是否存在以及实际消费面。
- 必须 blur 的元素是否有稳定语义锚点；避免依赖构建哈希类名。
- 插件禁用、热重载和 DSH 重启时 disposer 是否完整执行。

### 11.3 多插件冲突

**【源码事实】**参考项目已经包含部分跨插件让路逻辑，例如 `dsh-wallpaper-engine/src/client.js:411-473` 对特定皮肤中心信号的响应。这说明背景、玻璃和主题所有权是实际冲突点，而不是理论问题。

**【设计建议】**BackdropBuddy 第一版不应假设这些第三方标记覆盖所有皮肤插件。先明确要求不要同时启用多个会接管同一表面的插件；自动检测、让路和恢复作为独立功能评审。

### 11.4 性能与媒体兼容

**【待真机验证】**

- 视频自动播放是否被浏览器策略拒绝，拒绝后 UI 如何提示和重试。
- H.264 MP4、WebM 等实际编码是否可解码；MOV／M4V 扩展名不代表必然支持。
- 大视频、moov 后置 MP4 的首帧延迟；首版不承诺参考项目的 faststart 优化。
- 全屏 `backdrop-filter` 和视频同时运行的 GPU／CPU 开销。
- 页面隐藏、最小化和恢复时是否正确暂停、续播，是否出现白帧。
- `prefers-reduced-motion`／BackdropBuddy 减弱动效开启时是否彻底不创建视频解码路径。
- 多次切换后是否残留视频、监听器、定时器、路由或合成层。

## 12. 分阶段实施建议

### 阶段 0：独立 DSH 最小验证插件

**目标：先验证 DSH 能力，不接完整 BackdropBuddy。**

范围：

- 最小 Host＋Client 插件。
- 使用固定的示例 desired-state。
- 一张图片、一个已知可解码的视频。
- 基础背景层、scrim、少量 DSW 令牌。
- 应用、暂停、继续、恢复、插件卸载清理。
- Host 文件持久化和受限媒体路由。

通过条件：第 13.1、13.2 节，以及第 13.3 节中不涉及 BackdropBuddy 桥接的验收项，均在真实 DSH 目标上有截图、日志和清理证据；调度与多宿主验收不在阶段 0 冒充完成。

### 阶段 1：BackdropBuddy 桥接与 DSH adapter

范围：

- 版本化 desired／status 契约。
- DSH adapter 和宿主注册／装配。
- 实际主题库媒体与合并参数。
- revision、回执、超时、错误和 audit。
- 应用／暂停／继续／恢复事务闭环。

通过条件：BackdropBuddy 点击操作后，不再是“文件已写即成功”，而是 DSH Client 回执与 UI 状态一致。

### 阶段 2：产品能力对齐

范围：

- BackdropBuddy 宿主列表中的 DSH 状态和错误展示。
- `.bbskin` 主题、媒体库、参数调节。
- 调度自动应用。
- 每宿主主题记忆、启动自动应用、减弱动效。
- DSH／BackdropBuddy 各自重启后的恢复。

### 阶段 3：兼容与强化

范围：

- 多窗口／多 Client 回执聚合。
- 多皮肤插件冲突检测或让路。
- 大视频与特殊编码的优化。
- 更完整的表面映射、视觉回归和性能优化。
- 插件安装、升级、卸载和故障诊断流程。

## 13. 真机验收清单

### 13.1 加载与恢复

- [ ] 插件能在目标 DSH 版本安装、启用、禁用和重启加载。
- [ ] 不修改 DSH 应用二进制，不依赖 BackdropBuddy 打开远程调试端口。
- [ ] 禁用或卸载后，无 BackdropBuddy 背景、样式、令牌、视频和定时器残留。
- [ ] DSH 单独重启后，最后有效主题与 paused 状态按设计恢复。
- [ ] BackdropBuddy 单独重启后，能对账并显示真实 DSH 状态。

### 13.2 图片与视频

- [ ] 图片正常显示，取景、contain／cover／stretch、缩放符合预期。
- [ ] 视频首帧、poster、循环、暂停和继续正常。
- [ ] 不支持或损坏的媒体会显示错误，不静默替换为“成功”。
- [ ] 媒体缺失、越界路径、非法文件名和过大文件均被拒绝。
- [ ] 视频拖动／Range 请求、HEAD 和客户端中断不会产生明显资源泄漏。

### 13.3 核心操作语义

- [ ] 应用后只有对应 revision 被提交，重复状态不会重建视频。
- [ ] 暂停后背景隐藏、视频暂停、原 DSH 表面恢复。
- [ ] 继续后同一主题和参数恢复，视频从合理位置续播。
- [ ] 重置参数不会意外解除 paused。
- [ ] 恢复原貌后无透明表面、无遮罩、无视频解码、无自有 DOM。
- [ ] DSH 关闭、插件禁用或回执超时时，BackdropBuddy 不显示假成功。

### 13.4 参数与主题

- [ ] `panel/bubble/task/accent` 在明暗两套模式下均有可读性。
- [ ] accent 很亮或很暗时，主按钮文字仍有足够对比度。
- [ ] DSH 切换明暗模式时，不需要重新应用主题才能得到对应令牌。
- [ ] `safe` 和 `hpos` 的实际构图经评审确认，没有照搬其他宿主的特殊系数。
- [ ] 减弱动效开启时视频退为首帧，无后台视频解码。

### 13.5 调度与多宿主

- [ ] BackdropBuddy 调度触发后，DSH 实际应用并回执新 revision。
- [ ] DSH 与 ZCode／ChatGPT 切换时，不跨宿主误应用主题。
- [ ] `hostThemes.dsh` 记忆与插件持久状态不会产生未经确认的抢写。
- [ ] 多 Client 场景中，不以一个窗口成功代表所有窗口成功；若首版不支持，应明确标为限制。

### 13.6 性能与冲突

- [ ] 页面隐藏／最小化后视频按设计暂停，恢复后无持续白帧。
- [ ] 连续切换主题后，DOM、监听器、定时器和视频数量不累积。
- [ ] 全屏模糊与视频同时运行时性能可接受；若达不到，则有明确的降效回退方案或功能限制。
- [ ] 与其他皮肤／壁纸插件同时启用时，有明确阻止、提示或单一所有者约束。

## 14. 需要评审确认的问题

1. **目标形态**：首个版本只承诺 Windows DSH Desktop，还是必须同时覆盖 web profile？
2. **暂停定义**：是否确认沿用 BackdropBuddy 当前“隐藏背景并恢复宿主表面”，而不是仅仅冻结视频帧？
3. **桥接方式**：是否接受首版原子 JSON＋revision，后续确有需要再换命名管道或本地服务？
4. **状态权威**：BackdropBuddy 离线时，是否允许 DSH 插件按最后镜像独立恢复和继续运行？
5. **多插件策略**：首版是否采用“不要同时启用其他接管背景的插件”的明确限制？
6. **多窗口**：是否列为首版硬门槛，还是先单窗口验证、保留每 Client 状态模型？
7. **参数范围**：`hpos/safe/task` 是否必须第一版完全对齐，还是先完成媒体、panel、bubble、accent？
8. **安装方式**：是否接受用户通过 DSH 插件管理命令安装配套插件，由 BackdropBuddy 检测和引导，而不是由 BackdropBuddy 私自修改 DSH profile？

## 15. 最终建议

建议批准“阶段 0 最小验证插件”，而不是立即改造整个 BackdropBuddy。

阶段 0 要回答的不是“能不能写出一段背景 CSS”，而是以下完整闭环：

> DSH 正式加载插件 → 本地图片／视频可显示 → DSW 表面让出背景 → 暂停／继续语义正确 → 恢复后无残留 → DSH 重启后状态仍在。

只有这些在真实 DSH 上成立，才进入 BackdropBuddy adapter、桥接协议和调度接入。这样可以先验证最大的宿主不确定性，同时保留现有程序架构，避免在错误路线上提前投入完整产品改造。

---

## 附录 A：关键源码证据索引

### BackdropBuddy

| 主题 | 位置 |
| --- | --- |
| 当前 CDP adapter | `kernel/host/adapter.mjs:117-175` |
| 当前宿主注册表 | `kernel/host/registry.mjs:6-53` |
| adapter 装配与切换依赖 | `kernel/app/kernel.mjs:103-147` |
| 主题默认参数 | `kernel/store/record.mjs:3-18` |
| 当前 pointer 与 revision | `kernel/store/pointer.mjs:3-38` |
| 应用事务 | `kernel/handlers/theme-state.mjs:35-94` |
| 暂停／继续事务 | `kernel/handlers/theme-state.mjs:96-124` |
| 恢复事务 | `kernel/handlers/theme-state.mjs:141-163` |
| 当前暂停的页面语义 | `kernel/host/expressions.mjs:183-208` |
| 当前恢复的清理语义 | `kernel/host/expressions.mjs:211-237` |
| 当前媒体路径与减弱动效 | `kernel/host/adapter.mjs:341-394` |
| 管理器内部媒体 URL | `kernel/media/url.mjs:1-8` |
| stdio 请求通道 | `kernel/transport/stdio.mjs:20-35`、`61-100` |
| 调度复用 applyThemeState | `kernel/schedule/service.mjs:26-72` |
| 每宿主主题记忆 | `kernel/host/switch.mjs:69-87` |
| 此前 DSH 探针记录 | `docs/PLAN-v2-expansion.md:34`、`327` |

### dsh-wallpaper-engine

| 主题 | 位置 |
| --- | --- |
| DSH bundle／client 声明 | `package.json:159-169` |
| 主插件装载行 | `cordis.patch.yml:21-30` |
| Host webServer 依赖 | `lib/index.js:186-198` |
| 媒体与预览路由 | `lib/routes/media-bytes.js:33-90` |
| 设置持久化路由 | `lib/index.js:442-450` |
| 背景层和遮罩层 | `src/styles-base.js:97-131`、`206-225` |
| 面板层令牌 | `src/styles-base.js:236-275` |
| 输入框与气泡令牌 | `src/styles-shell.js:35-64` |
| accent 与对比度 | `src/styles-chrome.js:102-123` |
| 图片／视频／iframe 构建 | `src/media-prep.js:585-675` |
| 视频构建与 poster | `src/video-layer.js:212-265` |
| 播放／暂停 | `src/client-audio-playback.js:151-176` |
| Client 生命周期 | `src/client.js:5826-6067` |
| 效果清理 | `src/effects.js:671-714` |
| 跨插件让路实例 | `src/client.js:411-473` |
| Host／Client 分工说明 | `docs/HOW-IT-WORKS.md:111-127` |
| 遮挡暂停说明 | `docs/HOW-IT-WORKS.md:188-198` |

### dsh-dream-skin

| 主题 | 位置 |
| --- | --- |
| DSH bundle／client 声明 | `package.json:84-98` |
| Host 状态文件与 API 说明 | `lib/index.js:14-24` |
| Host webServer 依赖 | `lib/index.js:105-108` |
| 宿主状态路径与写入 | `lib/index.js:136-141`、`188-204` |
| Host API 注册 | `lib/index.js:615-643` |
| 动态 origin 与三层存储 | `lib/client.js:1868-1886` |
| overrideTokens 管理 | `lib/client.js:2652-2713` |
| accent 令牌 | `lib/client.js:6813-6851` |
| 图片背景层 | `lib/client.js:7688-7769` |
| 主题注册与 disposer | `lib/client.js:8862-8916` |
| 主题恢复 | `lib/client.js:8933-8971` |

## 附录 B：明确不在本次结论内的事项

- 没有声称两个参考仓库的全部测试已在本次运行。
- 没有声称 BackdropBuddy 已经具备 DSH adapter 或配套插件。
- 没有声称当前用户的 DSH 版本已通过兼容性验证。
- 没有承诺 Wallpaper Engine Scene／Web 壁纸、WebWallGL、转码或完整液态玻璃进入第一版。
- 没有把示例 desired／status JSON 当作已实现协议；它们需在评审后冻结。
- 没有把源码静态可行等同于性能、视觉、多窗口和升级兼容性已经验收。
