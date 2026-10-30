# BackdropBuddy · 原生主题管理器实施计划

> **一句话**：把现在的 HTML demo 升级成可安装的 Windows 主题管理器——WPF + WebView2 壳、React 18.3.1 界面、Node 22.22.2 内核、PowerShell 5.1 平台层，走 `dreamskin.manager/1` 的 NDJSON 协议，真正应用 / 暂停 / 恢复主题到宿主。
>
> | 项 | 值 |
> | --- | --- |
> | 计划版本 | v3.0 |
> | 状态 | 未发布正式版，版本号自 **0.1.4** 起改用 0.x 前缀（P0–P7 已验收；下文与 `docs/issue-*.md` 里出现的 1.0.0 / 1.1.x 是当时的里程碑编号，不回改） |
> | 当前 demo | `app/backdrop-lab.html`（三页 UI，15/15 交互验收） |
> | 原生 UI | `ui/`（React 18.3.1 + Vite 单文件，门禁 288 KiB） |
> | 参照项目 | `F:\shop\CodexDreamSkinManager`（105 KB .NET 壳、React UI、Node 内核、30 个 PowerShell 脚本） |
> | 宿主 | ZCode（Electron；只读识别 + CDP 注入，不改宿主文件） |
> | 事实源 | 本文档。`index.html` 是阅读版；改动先改本文 |

> v2.0 是「单文件 HTML 主题管理器」计划，已归档到 `.design/archive/PLAN-v2.md`；v3.0 在同一产品定义上替换交付形态与运行时。

---

## 0. 现状与阅读指南

### 0.1 当前状态

| 部分 | 状态 | 证据 |
| --- | --- | --- |
| 产品定义 / 三页 / 参数 / 状态机 | 已定 | `PLAN.md` v2、`app/backdrop-lab.html` |
| HTML demo UI | 已完成 | 23 个主题（20 内置 + 3 本地素材）；15/15 浏览器交互；控制台零错误 |
| 本地素材 | 已接入 | `assets/original.jpg`、`assets/original.mp4`、`assets/测试233.jpg` |
| 原生壳 / React UI / Node 内核 / PowerShell / 协议 / 安装包 | **P1–P7 已跑通；V1 1.0.0 已交付** | 77 模块内核 + 30 个 PowerShell；真实注入/恢复；数据/主题包；协议边界、壳生命周期、UI 1280、宿主三次一致；Inno 6.7.3 per-user 安装包、保留/清除用户主题、校验和 |
| 宿主真实应用 / 恢复 | **已完成（ZCode 3.16.2）** | 图片/视频主题真实注入；暂停/继续/重置/恢复校验；宿主 16 个关键文件哈希不变 |
| 数据与主题包 | **已完成** | 20 内置 + 3 本地素材入库；用户主题 CRUD；`.bbskin` 往返 177,493 B；重启保留；窗口 1300×780@140,100 恢复 |

### 0.2 本轮环境核对（2026-10-21 实测）

| 依赖 | 本机结果 | 结论 |
| --- | --- | --- |
| PowerShell | 5.1.19041.6456 | ✅ 目标版本 |
| .NET Framework 4.8 | Release 533325（≥528040） | ✅ 运行时在；Targeting Pack 见下 |
| WebView2 Runtime | 151.0.4129.107 | ✅ |
| Node（宿主 PATH） | v22.22.0 | ✅ 可用于 UI 构建；内核用 22.22.2 |
| Node（原项目 runtime） | v22.22.2 | ✅ 可直接复用为便携内核运行时 |
| MSBuild | VS 2022 BuildTools 17.14.51（未在 PATH） | ✅ 已有；用绝对路径，不必安装 |
| .NET 4.8 Targeting Pack | 已安装（`Reference Assemblies\...\v4.8` 存在） | ✅ 空 net48 WPF 已构建通过 |
| .NET SDK | `dotnet --list-sdks` 为空 | 不阻塞：WPF net48 用 MSBuild 构建 |
| Inno Setup（iscc） | 6.7.3（`%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe`） | ✅ P7 已用它产出安装包 |

> 结论：**P0 两个闸门都已通过**。.NET 4.8 Targeting Pack 已补，空 net48 WPF 壳构建成功；ZCode 已完全退出并用 `--remote-debugging-port=9229` 重启，9229 归属 ZCode.exe；只读 CDP 探针确认 `#root`、`zcode-startup-ready`、67 个渲染 data-testid。**P1 原生壳、P2 React UI、P3 内核、P4 宿主适配、P5 数据/主题包、P6 验证与 P7 打包已全部接通**（见 5.2 实测）；V1 1.0.0 的安装包、便携 ZIP、清单与校验和位于 `build/out-next/`（2026-10-24 起；旧的 `build/out/` 已删除）。

### 0.3 阅读指南

| 你是 | 读哪几节 |
| --- | --- |
| 判断值不值得做 | 1、5、8、9 |
| 要动手 | 2、3、4、5 |
| 要验收 | 6、5 的验收列 |
| 要接宿主 | 2.4、3.6、5 P4 |

---

## 1. 产品与目标

### 1.1 一句话定义

**BackdropBuddy 是一个本地主题管理器：主题库 → 宿主预览 → 应用 / 暂停 / 重置 / 恢复原貌；导入图片或视频生成主题，调取景、文字安全区、面板与气泡不透明度、强调色；只走本地，不改宿主文件。**

### 1.2 三页（与 demo 一致）

| 页面 | 职责 | 原生侧的差异 |
| --- | --- | --- |
| 控制台 | 主题库、搜索/分类/来源/排序、宿主预览、应用/暂停/重置/恢复、素材导出、主题包 | 「应用」从预览态变成真正的宿主注入；状态由内核返回 |
| 导入图片 | 标签、名称、图片/视频、外观模式、水平/垂直/缩放、锁定、安全区、任务页、气泡/面板不透明度、强调色、保存 | 文件选择走原生对话框；图片/视频由内核复制进主题目录，经 media 域预览 |
| 主题设置 | 选中主题、显示与取景参数、保存/取消 | 参数写入内核主题存储；运行中保存后由内核重新应用 |

产品定义、20 个内置主题、3 个本地素材、状态机、参数表沿用 v2.0，不在本计划重复；本计划只定义**怎么把它做成原生应用**。

### 1.3 三条硬边界（原生版）

1. **只走本地。** UI 从虚拟域加载，内核只在本机回环；不上传图片、不联网、不建账号。
2. **不改宿主文件。** 主题注入只走 CDP/运行时样式；恢复原貌必须能回到注入前；任何写宿主文件的行为都视为越界。
3. **不复制参照项目代码/素材。** React UI 基于本项目 demo 重写；协议字段、主题素材、PowerShell 脚本自建；参照项目只用于确认运行时形态。宿主目标是 ZCode，接入事实参考 overlaylab 的 ZCode 评估与 zskin 的 CDP 启动，不复用 Codex 专用选择器。

### 1.4 成功判据

- [ ] 双击 `BackdropBuddy.exe` 启动；单实例；WebView2 失败时有可读错误；
- [ ] UI 从虚拟域加载，三页可用；控制台零错误；
- [ ] 23 个主题（20 内置 + 3 本地）可选中、预览、搜索/过滤；
- [ ] 应用皮肤后**宿主真的变化**；暂停/继续、重置、恢复原貌可用；
- [ ] 恢复原貌后宿主与注入前一致；宿主目录文件哈希不变；
- [ ] 导入图片/视频 → 保存 → 我的 → 再次应用；刷新/重启后仍在；
- [ ] 协议 1 MiB 上限、requestId 去重、`status.get` 旁路、背压有测试；
- [ ] 安装包 per-user、asInvoker、无需管理员；WebView2 缺失有引导；
- [ ] 三次连续端到端运行结果一致。

---

## 2. 目标技术栈

### 2.1 栈表

| 层 | 技术 | 目标 / 约束 |
| --- | --- | --- |
| 原生壳 | .NET Framework 4.8 + WPF + WebView2 | 壳 ≈105 KB；只负责窗口、单实例、WebView2、Node 进程、消息中继、日志 |
| 界面 | React 18.3.1 + Vite | 打成单文件 ≤256 KB（压缩）；无 CDN、无外网请求 |
| 内核 | Node 22.22.2 ESM | 77 个模块；NDJSON over stdio；主题存储、导入、宿主适配、事务 |
| 平台层 | PowerShell 5.1 | 30 个脚本；宿主探测/启动/CDP/注入/恢复/备份/卸载 |
| 协议 | `dreamskin.manager/1` | NDJSON；单条 ≤1 MiB；requestId；`status.get` 旁路；错误可读 |
| 安装 | Inno Setup 6 | per-user、asInvoker；WebView2 检测；卸载保留/清理用户主题可选 |

### 2.2 四层职责与体积预算

```
┌───────────────────────────────────────────────────────┐
│ WPF Shell  (~105 KB)                                  │
│ 窗口 / 单实例 / WebView2 / 虚拟域 / Node 进程 / 中继     │
├───────────────────────────────────────────────────────┤
│ React UI  (≤256 KB 单文件)                             │
│ 三页 / 主题库 / 宿主预览 / 导入 / 设置 / 协议客户端       │
├───────────────────────────────────────────────────────┤
│ Node Kernel  (77 ESM modules)                         │
│ 协议 / 主题存储 / 媒体 / 事务 / 宿主适配 / 日志          │
├───────────────────────────────────────────────────────┤
│ PowerShell 5.1  (31 scripts)                          │
│ 宿主探测 / 启动 / CDP / 注入 / 恢复 / 备份 / 安装        │
└───────────────────────────────────────────────────────┘
```

- **Shell 不写业务。** 不解析主题、不碰宿主；只转发协议、管理进程与窗口。
- **UI 不碰文件系统。** 图片/视频选择走 Shell 的 `file.pick`；主题文件由 Kernel 复制；UI 只拿 media 域 URL。
- **Kernel 不弹窗。** 错误以协议响应/事件返回；需要用户操作的交由 UI。
- **PowerShell 不保存状态。** 只执行平台动作，结果回 Kernel；宿主文件只读/恢复。

### 2.3 数据目录

```
%LOCALAPPDATA%\BackdropBuddy\
├── config.json              # 主题选择、运行偏好、窗口状态
├── themes\
│   ├── builtin\             # 20 个内置主题（安装时释放）
│   ├── user\                # 我的主题（图片/视频/参数）
│   └── staging\             # 导入/应用的临时目录
├── backup\                  # 宿主注入前的快照（恢复用）
├── logs\                    # kernel.log / shell.log / host.log
└── cache\                   # 缩略图缓存（可重建）
```

主题目录不放在程序安装目录：per-user 安装、无管理员权限、卸载不误删用户主题。

### 2.4 安全模型

- WebView2：`manager.backdropbuddy.invalid` 映射 UI 目录；`media.backdropbuddy.invalid` 只映射主题媒体；CSP `default-src 'none'; script-src 'sha256-…'; style-src 'self' 'unsafe-inline'; img-src https://media.backdropbuddy.invalid data: blob:; media-src https://media.backdropbuddy.invalid blob:; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'; frame-ancestors 'none'`（构建后按实际内联脚本计算哈希）。
- Shell：asInvoker，不提权；命名管道单实例；只启动包内 `runtime/node/node.exe`；退出时终止子进程；不监听公网端口。
- Kernel：只读协议 stdin/stdout；1 MiB 硬上限；requestId 去重；方法白名单；参数 schema 校验；不执行 UI 传来的任意命令。
- PowerShell：脚本随安装包签名/校验；执行策略按进程 `-ExecutionPolicy Bypass` 仅作用于子进程；不写宿主文件；注入前备份，恢复后校验。
- 宿主：只识别目标 ZCode 进程与调试端口；端口归属校验（loopback + 进程 exe + CDP 目标指纹 + data-testid）；拒绝非目标页面。

---

## 3. 协议 `dreamskin.manager/1`

### 3.1 传输与帧

- 传输：UI → Shell（WebView2 `postMessage`）→ Kernel stdin；Kernel stdout → Shell → UI（`PostWebMessageAsJson`）。
- 帧：NDJSON，一行一条；UTF-8；单条消息 **≤1 MiB**。
- 超限：丢弃该行并返回 `MESSAGE_TOO_LARGE`，不做半包对齐；记录日志，连接继续（本地 UI 可恢复）。
- 背压：写 stdout 用回调；积压超过阈值时暂停读 stdin，回落后恢复。
- 解析：按 `\n` 切分；拒绝没有 `v/id/type` 的消息；未知方法返回 `METHOD_NOT_FOUND`。

### 3.2 消息 envelope

```json
{"v":"dreamskin.manager/1","id":"c-0001","type":"request","method":"theme.apply","params":{}}
{"v":"dreamskin.manager/1","id":"c-0001","type":"response","ok":true,"data":{}}
{"v":"dreamskin.manager/1","id":"c-0001","type":"response","ok":false,"error":{"code":"HOST_NOT_FOUND","message":"…","retryable":false}}
{"v":"dreamskin.manager/1","type":"event","event":"theme.status","data":{}}
```

- `id`：连接内唯一；1024 条滑动窗口去重；重复 id 直接返回原结果，不重复执行。
- `system.hello`：握手，返回协议版本、内核版本、主题目录、能力列表；未握手前只允许 `system.hello`/`status.get`。
- `status.get`：唯一旁路，并发上限 1；忙时返回 `{code:"BUSY",retryable:true}`。
- 事件：`theme.status`、`host.status`、`log`；UI 断线重连后先 `status.get` 对齐。

### 3.3 方法表

| 组 | 方法 | 说明 |
| --- | --- | --- |
| system | `system.hello` / `system.ping` / `system.shutdown` | 握手、心跳、退出 |
| status | `status.get` | 旁路；内核/宿主/主题当前状态 |
| theme | `theme.list` / `theme.get` / `theme.save` / `theme.remove` | 主题库、详情、保存、删除 |
| theme | `theme.import` / `theme.export` | 从路径导入/导出主题包 |
| theme | `theme.apply` / `theme.pause` / `theme.resume` / `theme.reset` / `theme.restore` | 应用/暂停/继续/重置/恢复 |
| settings | `settings.get` / `settings.set` | 全局偏好 |
| host | `host.detect` / `host.status` / `host.apply` / `host.restore` | 宿主探测/状态/注入/恢复（平台层执行） |
| file | `file.pick` / `file.validate` | Shell 原生选择对话框；文件校验 |
| media | `media.url` | 主题媒体 → `media.backdropbuddy.invalid` URL |
| log | `log.tail` | 最近日志（UI 诊断面板） |

所有方法参数用 JSON Schema 校验；主题名、标签、颜色、枚举、数值范围都在 schema 里；拒绝未知字段不报错，但忽略。

### 3.4 大文件与媒体域

- **协议不传图片/视频。** `file.pick` 返回本地路径；`theme.import` 由 Kernel 复制到 `themes/staging` → 校验 → 原子移动到 `themes/user`。
- 图片：最长边压到 1400 px、JPEG/WebP；视频：保留原文件，首帧缩略图缓存到 `cache/`。
- UI 通过 `media.backdropbuddy.invalid/<themeId>/<file>` 加载；Shell 只映射主题目录，不映射用户整个磁盘。
- P2 当前映射 `<app>\assets`（3 个本地素材，路径 `/original.jpg` 等）；P5 主题入库后切回 `%LOCALAPPDATA%\BackdropBuddy\themes`。
- 1 MiB 上限只约束 JSON 消息；主题包导出/导入走文件路径，避免 base64。

### 3.5 UI ↔ Shell ↔ Kernel 的桥

UI 侧封装：

```ts
interface Bridge {
  request(method: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  on(event: string, cb: (data: unknown) => void): () => void;
}
```

- UI 只依赖 `Bridge`；浏览器 demo 模式用 mock bridge，原生模式用 `window.chrome.webview`。
- Shell 收到 WebMessage 后原样转发 Kernel；Kernel 响应按 id 回投；Shell 校验 1 MiB 与 JSON 合法性。
- Node 进程崩溃：Shell 记录退出码、重启一次、UI 收到 `host.status`/`system` 事件并提示；重启失败则显示错误页。

### 3.6 宿主接入（P4 的核心：ZCode）

目标宿主：**ZCode（Electron）**，安装目录 `F:\shop\ZCode`；参照项目是 Codex 专用的，**不要复用它的 Codex 选择器/启动脚本**。

```
host.detect  → ZCode.exe / .zcode-install-manifest / 9229 调试端口
host.status  → file:// out/renderer、#root、body.zcode-startup-ready、
               [data-testid]（约 874 个）、.dark
host.apply   → 读主题 → 生成受限 CSS → CDP 注入 → 返回注入前快照指针
host.restore → 撤注入 → 校验页面恢复（ZCode 没有 config.toml，不做宿主配置写回）
```

ZCode 专属事实（来自 overlaylab 的只读评估与 zskin 的启动器）：

- **渲染入口**：`resources/app.asar` 内 `out/renderer/index.html`，生产环境走 `file://`。
- **就绪信号**：`#root` + `body.zcode-startup-ready` + `[data-testid="root-startup-loading"]` 消失。
- **选择器契约**：bundle 内约 874 个 `data-testid`，当前渲染 DOM 67 个（P0 实测）；没有 shadcn 的 `--background/--primary` 令牌，主题参数必须映射到自己的 surface/panel。
- **CDP**：未打包版可自动加 `--remote-debugging-port=9229`；打包版必须由启动方显式传参；`ZCODE_DISABLE_FIXED_REMOTE_DEBUGGING_PORT=1` 可禁用自动端口。
- **单实例**：`requestSingleInstanceLock` 存在；带参重启前必须完全退出旧进程，否则参数被吞；进程表里还可能有一个 `about:blank` 的 Electron 实例，必须按指纹过滤。
- **恢复**：ZCode 没有 Codex 的 `config.toml` 对应物；「恢复原貌」= 撤注入 + 重新加载/恢复样式，不是恢复宿主配置。

- 端口：只连 127.0.0.1；校验端口归属（进程 exe 路径、CDP 目标 URL、页面指纹、data-testid）；拒绝其他页面。
- 注入：只允许 CSS 变量/选择器白名单；不执行任意 JS；不改宿主文件；不写配置。
- 快照：注入前的样式状态写入 `backup/`；恢复用指针，不反向删数据；失败可重试。
- 未运行/未连接：`theme.apply` 返回 `HOST_NOT_FOUND` 或 `HOST_NOT_READY`，UI 显示可读原因。

---

## 4. 目录与构建

### 4.1 目录

```
BackdropBuddy/
├── docs/                          # PLAN.md / README / 第三方声明 / 问题修复文档
├── index.html
├── app/backdrop-lab.html          # 当前 HTML demo（UI 原型，非最终交付）
├── assets/                        # 本地素材（用户提供）
├── src/
│   └── BackdropBuddy.Shell/       # .NET Framework 4.8 WPF
│       ├── App.xaml / MainWindow.xaml
│       ├── WebView/               # 虚拟域、WebMessage、Bridge
│       ├── Kernel/                # Node 进程、stdout 中继、生命周期
│       ├── Instance/              # 命名管道单实例
│       └── BackdropBuddy.Shell.csproj
├── ui/                            # React 18.3.1 + Vite
│   ├── src/ (Bridge, views, components, themes)
│   ├── public/
│   └── vite.config.ts             # 单文件输出
├── kernel/                        # Node 22.22.2 ESM（77 modules）
│   ├── main.mjs
│   ├── protocol/ transport/ handlers/ store/ host/ media/ platform/ util/
│   └── package.json
├── platform/windows/              # PowerShell 5.1（31 scripts）
├── runtime/node/                  # 便携 Node 22.22.2
├── shared/                        # 协议 schema / fixtures / 版本
├── tests/                         # node --test / shell / UI / host
├── build/                         # MSBuild / Vite / Inno 脚本
└── .design/                       # 设计、演示、验收证据、归档
```

### 4.2 构建流水线

```text
P0 环境
  MSBuild（现有 VS 2022 BuildTools，绝对路径）+ .NET 4.8 Targeting Pack
  Node 22.22.2（复用原项目 runtime 或独立下载）
  Inno Setup 6 只在 P7 打包时安装，不参与 P0

P1/P2/P3 开发
  npm ci --prefix ui && npm run build --prefix ui   → ui/dist/index.html（≤256KB）
  node --test tests/kernel                          → 协议/存储/宿主 mock
  npm run test:ui                                   → WebView2 E2E / 截图
  MSBuild src/BackdropBuddy.Shell                   → BackdropBuddy.exe（≈105KB）

P7 打包
  build.ps1 → 拷贝 ui/dist、kernel、runtime/node、platform、assets/builtin
  iscc build/setup.iss → BackdropBuddy-Setup.exe（per-user / asInvoker）
```

### 4.3 产物

| 产物 | 内容 | 验收 |
| --- | --- | --- |
| `BackdropBuddy.exe` | WPF 壳 | 单实例、WebView2、Node 生命周期 |
| `ui/index.html` | React 单文件 | ≤256 KB；离线；CSP |
| `runtime/node/node.exe` | Node 22.22.2 | `--version` = 22.22.2 |
| `kernel/*.mjs` | 77 模块 | 协议测试全绿 |
| `platform/windows/*.ps1` | 31 脚本 | 探测/注入/恢复可跑 |
| `BackdropBuddy-Setup.exe` | Inno 安装包 | per-user、无管理员、可卸载 |

---

## 5. 阶段与任务

### 5.1 总览

| 阶段 | 目标 | 主要产出 | 验收 | 工作量 |
| --- | --- | --- | --- | --- |
| **P0** | 补 Targeting Pack 与探针 | .NET 4.8 Targeting Pack、Node 22.22.2、ZCode CDP 只读探针 | 能构建空 net48 WPF、能只读连 ZCode（Inno 不参与 P0） | 0.5–1 人日 |
| **P1** | 原生壳 | WPF + WebView2 + 单实例 + Node 启动 + NDJSON 中继 | UI 从虚拟域加载、hello、echo、退出清理 | 2 人日 |
| **P2** | React UI · 已完成 | 三页；主题库 20+3；宿主预览；应用/暂停/恢复；导入；设置；单文件 200,114 B | 与 demo 行为一致；1280 无溢出；控制台零错误 | 2.5 人日 |
| **P3** | 内核与协议 · 已完成 | 77 模块；25 方法；主题存储；事务；媒体压缩/首帧；真实宿主检测；26/26 测试 | 协议/存储/媒体测试全绿；UI 与内核往返通过 | 3 人日 |
| **P4** | 宿主适配 · 已完成 | 30 个 PowerShell；ZCode 探测/启动/CDP/注入/恢复/备份；34/34 测试 | ZCode 前后截图；恢复原貌；宿主 16 文件聚合哈希不变 | 4 人日 |
| **P5** | 数据与主题包 · 已完成 | 3 本地素材入库；媒体域 themes + preview；`.bbskin`；file.pick；config/窗口状态；36/36 测试 | 重启保留；包往返；素材可应用；用户主题保留策略 | 2 人日 |
| **P6** | 验证 · 已完成 | 协议边界/背压；单实例/崩溃/WebView2 缺失；UI 1280；宿主三次一致；便携安装模拟；40/40 测试 | 全部清单通过；三次一致；用户主题保留 | 2 人日 |
| **P7** | 打包交付 · 已完成 | `build.ps1`、Inno 安装包、WebView2 检测、README/LICENSE、校验和 | 本机非管理员安装/启动/卸载；保留/清除用户主题；干净机与外部分支见备注 | 1.5 人日 |

> 2026-10-22 修复批次后的现状（此前各行内的测试数与脚本数是当时快照）：内核 **78** 个模块、**30** 个 PowerShell 脚本（删除无人调用的 `backup/prune.ps1`）、`node --test` **69/69**、UI 构建 **206,970 B**。本次同时修复了删除运行中主题导致内核崩溃、重启后暂停/继续/重置失效、请求去重按 id 复用等 15 项，详见 `docs/issue-code-review-fixes.md`。

合计约 **18 人日**；P4 是最大不确定项，P0 探针不过就先停。P4 的 ZCode 适配比 Codex 多一层 target profile、单实例重启与打包版调试端口；overlaylab 对原管理器多目标改造估过约 11 人日，本计划是新 UI 的独立 ZCode 适配，先按 4 人日估，P0 探针后再核准。

### 5.2 任务清单

**P0 环境与探针**
- [x] `P0-01` 使用现有 `C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\MSBuild.exe`（17.14.51，未在 PATH）；.NET 4.8 Targeting Pack 已装；空 net48 WPF 构建通过（7.7 KB）
- [ ] `P0-02` 确认本地开发/启动不依赖 Inno；Inno Setup 6 留到 `P7-02` 再安装
- [x] `P0-03` 确认 Node 22.22.2（已复制到 `runtime/node`，`node --version` = v22.22.2；协议内核测试 10/10）
- [x] `P0-04` 只读探针通过：ZCode 3.16.2、9229 归属 ZCode.exe、`file:///.../out/renderer/index.html`、`#root`、`zcode-startup-ready`、67 个渲染 data-testid；未注入、未写宿主文件
- [x] `P0-05` 探针结论写入 `.design/archive/native-probe.md`；构建闸门与宿主闸门均已通过，P0 完成

**P1 原生壳**
- [x] `P1-01` WPF net48 壳；asInvoker；PerMonitorV2 DPI；窗口 1440×900、最小 1280×720
- [x] `P1-02` WebView2 151 初始化；`manager.backdropbuddy.invalid` → `ui/dist`；CSP meta（P2 起 `media` 暂映射 `assets`，P5 已切到 `themes`，并新增 `preview` 域映射预览缓存）
- [x] `P1-03` 命名管道单实例；第二实例唤醒第一实例后退出 0；管道跨线程唤醒与重建已修
- [x] `P1-04` 启动 `runtime/node/node.exe kernel/main.mjs --mode manager`；stdin/stdout UTF-8 中继
- [x] `P1-05` WebMessage ↔ NDJSON 双向；1 MiB 校验；id 路由；30 s 超时（超时分支已实现，未真实触发）
- [x] `P1-06` Node 崩溃重启一次；二次崩溃停止；退出时终止；shell.log / kernel.log
- [x] `P1-07` 构建输出 `BackdropBuddy.exe` = 43,520 B（比参照 105 KB 更小）

> P1 实测（2026-10-21）：`https://manager.backdropbuddy.invalid/index.html` 加载成功，hello/ping/status/host.detect 全部 ok；1 MiB+64 B 消息被壳以 `MESSAGE_TOO_LARGE` 拒绝；第二实例退出码 0、壳进程数保持 1；kill 内核 PID 后约 0.4 s 重启一次并重新握手，二次 kill 后 UI 收到 stopped；关闭窗口后无壳/node 孤儿。截图 `.design/p1-shots/hello.png`。

**P2 React UI**
- [x] `P2-01` React 18.3.1 + Vite 5.4.21 + vite-plugin-singlefile；CSP 用构建后内联脚本 SHA-256；无 CDN/外链
- [x] `P2-02` 三页与 demo 对齐：控制台/导入图片/主题设置
- [x] `P2-03` 20 个内置主题 + 3 个本地素材；搜索/分类/来源/排序；本地素材走 `media.backdropbuddy.invalid`
- [x] `P2-04` 宿主预览；应用/暂停/继续/重置/恢复；状态由内核 `theme.status` 事件与 `status.get` 驱动
- [x] `P2-05` 导入图片/视频：WebView2 原生文件输入、标签、取景、安全区、不透明度、强调色；`file.pick` 协议方法与媒体入库延后到 P3/P5
- [x] `P2-06` 主题设置；保存/取消；运行中保存后重新 `theme.apply`
- [x] `P2-07` 主题包导入/导出；格式错误与空态有反馈；导入为本地即时操作，无独立 loading
- [x] `P2-08` 单文件 200,114 B（≤256KB）；1280×720 三页无横/纵溢出；控制台零错误

> P2 实测（2026-10-21）：`ui/dist/index.html` 200,114 B；23 个主题（20 内置 + 3 本地素材）在虚拟域加载；导入图片后 24、导入主题包后 25，刷新后保留；1280×720 三页 `scrollWidth/scrollHeight` 均为 1280/720；apply/pause/resume/reset/restore 与内核事件往返通过；内核被 kill 后 UI 自动重新握手并将运行状态归零；本地 3840×2160 视频可预览/暂停。截图 `.design/p2-shots/`。

**P3 内核与协议**
- [x] `P3-01` envelope、版本、1 MiB、NDJSON 分帧、UTF-8 切分；行写入带背压
- [x] `P3-02` requestId 1024 去重；`status.get` 并发 1 / BUSY；`theme.status` / `host.status` 事件
- [x] `P3-03` 方法白名单 + JSON Schema 子集校验（类型/必填/枚举/范围/格式/未知字段剥离）；新增 `THEME_NOT_FOUND`、`MEDIA_INVALID`、`TRANSACTION_FAILED` 等错误码
- [x] `P3-04` 主题存储 `builtin/user/staging`；20 个内置主题落盘；用户主题 JSON + 媒体；指针文件 `themes/pointer.json`
- [x] `P3-05` `media.url`；缩略图缓存；图片压缩到 ≤1400 px；视频首帧缩略图（ffmpeg/ffprobe）
- [x] `P3-06` 事务 stage → validate → rename → pointer；失败 discard；启动清理超过 1 h 的 staging
- [x] `P3-07` JSONL `kernel.log` + 内存环形日志 + `log.tail`；`system.hello` 能力表（25 个方法）
- [x] `P3-08` 77 个 `.mjs` 模块（计数测试）；`node --test` 26/26 全绿

> P3 实测（2026-10-21）：内核 `methods=25`、模块 77；`themes/builtin` 自动落盘 20 个主题；`theme.save/import/export/remove`、`settings.set/get`、`media.url`、`file.validate` 全通过；图片 2048×1152 压缩到 ≤1400 px，视频 3840×2160 首帧生成成功；事务失败不留下 staging 或用户主题；指针 revision 递增、restore 后清空。`node --test` 26/26（含 77 模块计数）。宿主检测改为真实读 9229；注入在 P4 已替换为真实 CDP 注入。

**P4 宿主适配**
- [x] `P4-01` 30 个 PowerShell 脚本分五组：env 6 / host 8 / theme 6 / backup 5 / install 5；全部通过 PS 5.1 语法解析
- [x] `P4-02` 宿主探测：进程、路径、版本 3.16.2、调试端口 9229、CDP 目标与页面指纹（67 个 data-testid）
- [x] `P4-03` 端口归属校验：loopback + exe + PID + 目标 URL + `#root`/`zcode-startup-ready` 页面标记；四项全过才允许注入
- [x] `P4-04` 注入：受限 CSS 白名单（选择器/属性/file URL）；主题参数 → `--color-*` 与固定背景层；失败自动回滚
- [x] `P4-05` 快照/恢复：注入前 baseline + 宿主哈希写入 `backup/`；恢复后校验元素清零、令牌还原；restore 报告落盘
- [x] `P4-06` 应用/暂停/继续/重置/恢复端到端（内核 + UI）；图片/视频；宿主 16 个文件聚合哈希前后一致
- [x] `P4-07` 错误可读：`HOST_NOT_FOUND` / `HOST_NOT_READY` / `HOST_UNREACHABLE` / `HOST_UNSUPPORTED` / `HOST_INJECTION_REJECTED`，消息带端口、进程或校验原因；不存在路径返回 `HOST_NOT_FOUND`，9228 被临时监听占用返回 `HOST_UNREACHABLE` + 占用进程路径/PID

> P4 实测（2026-10-21）：30 个脚本全部通过 PowerShell 5.1 解析；`host.detect` 返回 PID 27128、ZCode 3.16.2、ownership `exe/port/loopback/pid=true`、页面指纹 `16d3ef88…`。导入 `original.jpg`（1400×788）后真实注入：CSS 2,540 B、computed `--color-background=rgba(255,255,255,0.34)`；暂停回到 `#f8f8f8`，继续恢复；重置保持注入；恢复后 `style/layer/video` 全部清零、页面回到 `#f8f8f8`。宿主哈希 `49297d8c…`（16 文件 / 569,585,967 B）注入前后完全一致。视频主题 `original.mp4` 注入后 `readyState=4`、`currentTime=1.62`，暂停/继续/恢复通过。UI 实测 23 卡片 → 应用森林薄雾 → ZCode 出现注入 → 暂停/继续/恢复 → 0 控制台错误。端口占用（9228 临时监听）实测返回 `HOST_UNREACHABLE` 与占用进程路径/PID。`node --test` 34/34。截图 `.design/p4-shots/{before,applied,paused,restored,ui-applied}.png`，快照/报告在 `.design/p4-run-data/backup/`。

**P5 数据与主题包**
- [x] `P5-01` 20 内置主题在 `themes/builtin`；3 个本地素材以固定 ID `local-original` / `local-video` / `local-test` 入库 `themes/user`；首次启动自动 seed，`config.localAssetsSeeded` 防重复
- [x] `P5-02` 我的主题 CRUD：UI 文件选择 → `theme.import`；保存参数 → `theme.save`；删除 → `theme.remove`；图片/视频媒体与 kernel 参数实测
- [x] `P5-03` `.bbskin` zip（`backdropbuddy.pack/1` + `theme.json` + 媒体/缩略图）；JSON 兼容导出；store-only 写入、store/deflate 读取；路径穿越/大小/CRC 校验
- [x] `P5-04` config：`selectedThemeId` / `lastAppliedThemeId` / `applyOnStart` / `reducedMotion` / `localAssetsSeeded`；窗口状态写 `window.json`（避免与内核 config 并发写）；Shell `file.pick` 支持打开/保存对话框与预览缓存
- [x] `P5-05` 重启保留：pointer + config + user themes；卸载策略：`install/data-policy.ps1` 默认保留用户主题，`-PurgeUserThemes -Confirm` 才清理

> P5 实测（2026-10-21）：首次启动 20 内置 + 3 本地素材 = 23；`media.backdropbuddy.invalid` 映射 `%LOCALAPPDATA%\BackdropBuddy\themes`，`preview.backdropbuddy.invalid` 映射 `cache/preview`。UI 文件选择返回 `previewUrl`，导入后 24 主题；导出 `.bbskin` 177,493 B；再导入后 25 主题。保存参数 `panel=55` 经 `theme.get` 确认；删除后 `theme.get` 返回 `THEME_NOT_FOUND`。重启后选中 `local-original`、运行态与宿主注入均保留；窗口 `1300×780 @ (140,100)` 恢复。`data-policy -Purge` 预演只列 cache/logs/backup，保留 `themes/user` 12 文件 / 20,776,034 B。UI 205,119 B；壳 51,200 B；模块 77；`node --test` 36/36。截图 `.design/p5-shots/{ui-local-applied,ui-library,ui-mine}.png`，导出包 `.design/p5-shots/export-roundtrip.bbskin`。

**P6 验证**
- [x] `P6-01` 协议：真实壳 1 MiB−1（1,048,575 B）通过、1 MiB+1（1,048,577 B）拒绝且连接继续；重复 id 只落一个主题；`status.get` BUSY 与 1024 窗口复用单测；`LineWriter` 背压升起/清除/异常不断队列
- [x] `P6-02` 壳：第二实例退出 0 且只留一个壳；kill 内核一次自动重启并重新握手，二次 kill 停止；关闭无壳/内核孤儿；`WEBVIEW2_BROWSER_EXECUTABLE_FOLDER` 指向空目录时记录 `webview2 runtime missing` 并显示错误页
- [x] `P6-03` UI：三页 1280×720 `scrollWidth/scrollHeight=1280/720`、footer 可见；23 主题；应用/暂停/继续/恢复；设置保存到 kernel；控制台 0 错误
- [x] `P6-04` 宿主：连续三次图片注入/暂停/恢复；每次宿主哈希 `49297d8c…` 不变、指纹 `16d3ef88…` 一致、事件序列 `running→paused→running→restored`；截图 `before/after/paused/restored` 各三份
- [x] `P6-05` 安装模拟：106 MB 便携目录从独立路径启动，23 主题、应用/恢复通过；删除安装目录后 `themes/user` 3 个本地主题保留；当前会话非管理员；Inno 安装/卸载留 `P7-02` 复验
- [x] `P6-06` 体积：壳 51,200 B、UI 205,119 B；便携安装目录 106 MB（Node 运行时 87 MB + 素材 20 MB）；安装包大小在 P7 记录

> P6 实测（2026-10-21）：协议真实壳 1 MiB−1 通过、1 MiB+1 拒绝（`MESSAGE_TOO_LARGE`）后 `system.ping` 仍成功；重复 `requestId` 两次返回同一响应，主题数 23→24；`node --test` **40/40**。壳：第二实例 exit 0；内核 PID 25840→23980 自动重启；二次 kill 后 UI `kernel=stopped`、壳/内核进程均 0；WebView2 缺失日志命中错误页。UI：三页 1280×720 无溢出；设置 `panel=48` 经 `theme.get` 确认；应用本地素材、暂停/继续/恢复通过。宿主三次：指纹、宿主哈希、应用/恢复令牌完全一致。安装：便携目录启动/应用/恢复通过，删除目录后用户主题保留。截图 `.design/p6-shots/{1280-console,1280-import,1280-settings,applied-1280,host-before-1,host-after-1,host-restored-1}.png`，三次摘要 `host-runs.json`。

**P7 打包**
- [x] `P7-01` `build.ps1` 一键构建：UI（205,119 B）→ 内核测试 40/40 → Release MSBuild（61,952 B）→ 资源拷贝（132 文件 / 109,779,349 B）→ `install/layout.ps1` 校验 → `manifest.json` → ZIP；`build.json` 记录 9 个步骤与耗时
- [x] `P7-02` Inno Setup 6.7.3（per-user 安装，安装器签名 Valid / Pyrsys B.V.）；`setup.iss`：lowest/asInvoker、x64compatible、WebView2 与 .NET 4.8 检测、开始菜单、卸载默认保留 + `/PURGEDATA=1` 可选；静默安装 exit 0（当前会话非管理员），131/131 文件哈希一致，134 文件落盘；启动后 23 主题、三页无横向溢出、0 UI 错误；从安装目录真实应用到 ZCode 并恢复；卸载默认保留 249 文件数据，`/PURGEDATA=1` 清除，快捷方式/注册项/安装目录均移除；真实默认数据 301 文件前后不变
- [x] `P7-03` README（安装、ZCode 9229 启动、数据目录、ffmpeg 可选）、LICENSE（专有）、THIRD_PARTY_NOTICES + `licenses/`（Node / WebView2 / React / Vite / 中文语言文件）；安装器简体中文语言文件（MIT）
- [x] `P7-04` 版本 1.0.0（壳 1.0.0.0、内核/UI 1.0.0）、应用图标 7 尺寸；`BackdropBuddy-Setup-1.0.0.exe` 44,691,473 B / SHA256 `05a7a595…`；ZIP 54,560,994 B / `fd3ca11c…`；`manifest.json` 32,394 B / `3088bb08…`；`SHA256SUMS.txt` 三行全部通过；ZIP 132 条目 CRC 全通过、中文素材名正确

> P7 实测（2026-10-21）：`build.ps1` 全流程通过（UI 205,119 B；vite 43 模块；`node --test` 40/40；MSBuild 0.55 s；stage 132 文件 / 109,779,349 B；layout ok；ZIP 132 条目 / 54,560,994 B）。安装日志：`WebView2 Runtime detected: 151.0.4129.107`、`Microsoft .NET Framework 4.8 detected`；安装 exit 0，`isAdmin=false`；安装目录 134 文件 / 114,185,434 B（含 `unins000.exe`/`.dat`），`verify-hashes.ps1` 检查 131/131 全对。已安装版本经 CDP 实测：23 主题、三页 `scrollWidth ≤ clientWidth`、footer `主题库就绪 · 23 个主题`、0 UI 错误；`local-original` 应用后宿主 `style/layer=true`、`--color-background=rgba(255,255,255,0.30)`，恢复后 `style/layer=false`、`#f8f8f8`。卸载：默认保留 `p7-data` 249 文件 / 32,413,262 B；`/PURGEDATA=1` 删除 229 文件 / 30,938,708 B；两次都移除安装目录、开始菜单快捷方式与 `{7E1F0F5C-…}_is1` 注册项；真实 `%LOCALAPPDATA%\BackdropBuddy` 301 文件 / 16,547,067 B 前后一致。最终宿主无注入、无壳/内核进程。截图与图标 `.design/p7-shots/`，日志 `.design/p7-install.log`、`.design/p7-uninstall.log`。未实机触发：WebView2 缺失分支（本机已装 151）、交互式向导界面、全新 Windows 用户机、代码签名。

---

## 6. 验证与验收

### 6.1 协议

- 帧：合法/非法 JSON、缺字段、未知方法、UTF-8 被切在字节中间。
- 1 MiB：1 MiB−1 通过；1 MiB+1 返回 `MESSAGE_TOO_LARGE`，丢弃该帧但连接继续；不半包对齐。
- id：重复 requestId 只执行一次；1024 窗口外的 id 可复用。
- 旁路：`status.get` 并发 2 时第二个 `BUSY/retryable`。
- 背压：大量请求时 stdin 暂停/恢复，不无限堆内存。

### 6.2 宿主

- 注入前：截图 + 宿主目录文件哈希 + 运行状态。
- 注入后：截图变化 + `theme.status=running`。
- 暂停/继续：状态与画面一致。
- 恢复：截图回到注入前；哈希一致；`theme.status=idle`。
- 三次连续执行结果一致；失败路径（宿主未开、错误端口、页面不符）有可读错误。

### 6.3 壳与 UI

- 双击启动；第二实例不新开窗口；关闭后 Node 进程退出。
- WebView2 Runtime 缺失：安装包引导/错误页，不白屏。
- Node 崩溃：一次重启；UI 提示；恢复后 `status.get` 对齐。
- UI 1280×720：三页无横向溢出；键盘可达；控制台零错误。

### 6.4 安装

- 干净 Windows 10 用户：安装无需管理员；开始菜单/桌面；卸载。
- WebView2 已装/未装两条路径。
- 用户主题在升级/卸载时的保留策略明确。

> P7 已实测：当前 Windows 10 会话 `isAdmin=false`，静默安装 exit 0；开始菜单快捷方式创建/移除；安装目录与注册项移除；默认保留与 `/PURGEDATA=1` 清除两条策略。未实机触发：WebView2 缺失分支（本机 151 已装）、交互式向导、全新 Windows 用户机。

---

## 7. 风险与应对

| # | 风险 | 概率 | 影响 | 触发 | 应对 |
| --- | --- | --- | --- | --- | --- |
| R1 | .NET 4.8 Targeting Pack 缺失（MSBuild 已有） | 中 | 高 | P0 构建 net48 WPF 报 reference assemblies 缺失 | 用 VS Installer 加 Targeting Pack / 装 Developer Pack；MSBuild 用 BuildTools 绝对路径 |
| R2 | Inno Setup 缺失 | 高 | 低 | P7 无法打包（不阻塞本地开发） | P7 安装；备用 WiX/自解压 |
| R3 | 宿主 CDP 端口/版本变化 | 中 | 高 | apply 失败/页面不符 | P0 探针；端口归属校验；错误可见；不硬编码单版本 |
| R4 | 注入后无法恢复 | 低 | 高 | restore 失败 | 注入前快照 + 指针恢复 + 哈希校验；失败保留快照 |
| R5 | 1 MiB 限制影响主题数据 | 中 | 中 | 大 JSON 被拒 | 大文件走路径/media 域；协议只传元数据 |
| R6 | WebView2 虚拟域/CSP 配置错误 | 中 | 高 | UI 白屏 | P1 最小页验证；CSP 白名单；日志 |
| R7 | Node 子进程孤儿/崩溃 | 中 | 中 | 关闭后残留 | Job Object/进程树终止；崩溃重启一次 |
| R8 | PowerShell 执行策略/杀软 | 中 | 中 | 脚本被拦 | 随包校验；子进程 Bypass；错误提示；签名为后续 |
| R9 | 图片/视频导入占空间 | 中 | 中 | 用户素材过大 | 图片压缩；视频原文件；配额提示 |
| R10 | UI 单文件超过 256 KB | 中 | 低 | 构建体积超 | 代码分割/压缩；主题数据外置到 kernel/media |
| R11 | ZCode 单实例 / 打包版调试端口 / 无 config 恢复 | 中 | 中 | 旧进程吞参数、端口不可用、恢复无法写回配置 | 启动前确认退出；显式传 9229；恢复=撤注入+重载+校验；快照样式 |

> 一票否决：R3 宿主无法稳定接入、R4 恢复不可用。任何一条触发，P4 停下，先解决再继续 UI。

---

## 8. 范围与砍掉

### 8.1 V1 必做

- 三页；20 内置 + 3 本地素材；宿主预览；应用/暂停/继续/重置/恢复；导入图片/视频；主题设置；主题包；本地持久化；安装/卸载。

### 8.2 V1 不做（可后续）

- 自动轮换 / 定时换肤；多宿主；主题市场/云同步；在线更新；移动端；多语言；宿主配置写回。
- 视频转码/压缩：V1 原文件 + 首帧缩略图；转码放 V2。
- 主题编辑器的拖拽画布：V1 参数表单足够。

### 8.3 若工期紧，按顺序砍

1. 主题包导入/导出（保留本地主题）；
2. 下载素材（保留导出主题包）；
3. 视频主题（保留图片）；
4. 内置主题从 20 减到 12（保留分类覆盖）；
5. 主题设置里的“自定义取景”高级项。

**不砍**：应用/恢复、宿主文件只读、1 MiB 协议、单实例、恢复校验、安装包。

---

## 9. 环境、假设与待确认

### 9.1 已确认（2026-10-21 实测）

- PowerShell 5.1.19041.6456；.NET Framework 4.8（Release 533325）；WebView2 151.0.4129.107；Node 22.22.0（宿主）/ 22.22.2（便携 runtime）。
- MSBuild 已在 VS 2022 BuildTools（17.14.51，未在 PATH）；.NET 4.8 Targeting Pack 已安装；P1 壳 43,520 B，P5 后 51,200 B，P7 加图标/公司信息后 Release 壳 61,952 B；Inno Setup 6.7.3 已按 per-user 安装（`%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe`）。
- ffmpeg / ffprobe 在 PATH（`D:\environment\ffmpeg\bin`）；P3 的图片压缩、缩略图与视频首帧依赖它们，缺失时降级为原图/无缩略图。
- ZCode 3.16.2 / Electron 41.0.3 已用 `"F:\shop\ZCode\ZCode.exe" --remote-debugging-port=9229` 重启；9229 只监听 127.0.0.1，归属 PID 27128（`F:\shop\ZCode\ZCode.exe`）。
- P0 只读探针通过：页面 `file:///F:/shop/ZCode/resources/app.asar/out/renderer/index.html`；`title=ZCode`；`#root=true`；`body.zcode-startup-ready=true`；`root-startup-loading` 不存在；渲染 DOM 67 个 `data-testid`（sample: sidebar / task-new-button / conversation-section…）；`.dark=false`；未注入、未写宿主文件。
- P1 壳：单实例、虚拟域、Node 生命周期、NDJSON 中继；关闭无孤儿。
- P2 UI：React 18.3.1 单文件 200,114 B；23 个主题；1280×720 三页无溢出；0 控制台错误。
- P3 内核：77 个 `.mjs` 模块、25 个方法；本地 `%LOCALAPPDATA%\BackdropBuddy\themes` 落盘 20 个内置主题；事务/媒体/日志/真实宿主检测；`node --test` 26/26。
- P4 宿主：30 个 PowerShell 脚本；ZCode 端口归属/页面指纹校验；图片与视频真实注入；暂停/继续/重置/恢复；注入前快照与恢复报告；宿主 16 文件哈希不变；UI 全链路 0 错误；`node --test` 34/34。
- P5 数据：3 本地素材入库；媒体域切到 themes + preview；`.bbskin` 往返 177,493 B；file.pick 打开/保存；用户主题 CRUD；重启保留；窗口状态恢复；卸载默认保留用户主题；`node --test` 36/36。
- P6 验证：真实壳 1 MiB−1/+1 边界、重复 id、BUSY/1024 窗口、背压；单实例/WebView2 缺失/内核重启一次/二次停止/无孤儿；三页 1280×720；宿主三次一致；便携安装/删除后用户主题保留；`node --test` 40/40；壳 51,200 B、UI 205,119 B。
- P7 打包：`build.ps1` 全流程（UI 205,119 B → 40/40 → Release 61,952 B → 132 文件 / 109,779,349 B → layout → ZIP 132 条目 CRC 通过）；Inno 6.7.3 per-user 安装包 44,691,473 B / SHA256 `05a7a595…`，静默安装 exit 0、非管理员、131/131 哈希一致、23 主题、应用/恢复通过；保留与 `/PURGEDATA=1` 两条卸载策略均实测；`SHA256SUMS.txt` 3/3；中文安装器语言文件 MIT；ffmpeg 决定不随包。
- 参照项目目录可读：`F:\shop\CodexDreamSkinManager`（只提供运行时形态，其 Codex 宿主选择器不适用）。

### 9.2 待确认

- **宿主范围**：2026-10-25 起方向收窄到 agent 应用——内置宿主只保留 ZCode（Obsidian 已下线，`BACKDROPBUDDY_HOST=obsidian` 报 unknown host），自建宿主一律走「接入宿主」向导（含无 CSS 变量的 Tauri/WebView2 宿主，已在 Desktop AI Pet 上跑通，见 PLAN-v2-expansion §2.6）。VSCode 与 ChatGPT 桌面版探针/试穿已完成、接入待扩展（§2.10 / §2.11）。
- **卸载策略**：已实现并实测——默认保留用户主题与设置；交互式卸载会询问是否同时删除；静默卸载可加 `/PURGEDATA=1`；卸载器尊重 `BACKDROPBUDDY_DATA_DIR`。
- **签名**：V1 未做代码/脚本签名，安装包 `Authenticode=NotSigned`，SmartScreen 会提示“未知发布者”；建议对外分发前补签。
- **主题包格式**：已选 `.bbskin`（zip：`pack.json` + `theme.json` + 媒体/缩略图）；JSON 仅作兼容配置导出。
- **媒体工具链**：已决定**不随包携带** ffmpeg/ffprobe（本机 GPL 构建，两者各约 105 MB）；保留 PATH / `BACKDROPBUDDY_FFMPEG` / `BACKDROPBUDDY_FFPROBE` 三种发现方式，缺失时视频主题仍可应用、缩略图/压缩降级。
- **运行偏好 UI**：`applyOnStart` / `reducedMotion` 已有设置页开关与内核消费点（2026-10-24，见 PLAN-v2-expansion §2.4）：减弱动效把视频主题降级成首帧静图并立刻重放，启动自动应用只在没有主题在跑时补应用上次那个。
- **干净机验收**：本机为非管理员会话，但已有 .NET 4.8 与 WebView2 151；全新 Windows 10/11 用户机与 WebView2 缺失分支仍需实机复验。

### 9.3 下一步

**V1.1.0 已交付，唯一交付目录是 `build/out-next/`**（安装包、便携 ZIP、完整目录、`manifest.json`、`SHA256SUMS.txt`、`delivery.json`）；旧的 `build/out/` 已于 2026-10-24 删除。字节数与哈希不在本文复述，以 `build/out-next/build.json` 与 `delivery.json` 为准。`build/build.ps1` 与 `build/package.ps1` 可重复出包（默认输出到 `build/out/`，先退出运行中的 BackdropBuddy，它会锁 staging）。

**已落地（2026-10-23 ①②③，2026-10-24 ④）**

- **① 宿主 profile 化 + 点选式接入向导**：`kernel/host/registry.mjs` + profile 接口（`expressions.mjs` / `zcode.mjs` / `obsidian.mjs` 同形）；新增「接入宿主」页，五步（连接 → 点选根容器 → 点选面板 → 选变量 → 试穿保存），产出纯数据 profile 存 `%LOCALAPPDATA%\BackdropBuddy\hosts\<id>.json`。切宿主用 `BACKDROPBUDDY_HOST=<id>` 或 `config.hostId`，默认仍是 ZCode。
- **② 启动期残留 / 端口校对 + 托盘常驻**：`host.audit` 判定 `clean / adopted / orphan-layer / stale-pointer / mismatch-layer / port-conflict`，控制台顶部出恢复横幅；托盘菜单补当前主题、暂停·继续、恢复原貌，图标取 EXE 的 16px 帧。
- **③ 宿主明暗切换适配**：宿主切深色/浅色时皮肤自己跟上，不需要重新应用。三个 profile 的「无素材渐变底」拆成两个模式块各一份（`--bb-backdrop-image`，背景层只引用变量），暂停/继续的校验基准改按页面此刻的模式取值（`tokensByMode[modeNow]` + 持久化 `baselineMode`）。复现推翻的三项（token 不跟随、`--color-primary-foreground`、模式切换导致重载）与真机 11/11 复验记录在 [PLAN-v2-expansion.md](PLAN-v2-expansion.md) §2.3；模式漂移检测因此不用做。
- **④ 调度、多窗口与两个开关消费点**：`reducedMotion` 让视频主题降级成首帧静图（改偏好立刻重放），`applyOnStart` 在启动审计后只在没有主题在跑时补应用上次那个；规则层 `{ 每天 HH:MM | 宿主明暗 | 系统明暗 } → 主题`（`kernel/schedule/`，不长驻定时器——内核给 `wakeAt`，壳装配一次性计时器，系统明暗走 `UserPreferenceChanged`）；注入改为遍历宿主全部渲染窗口，主目标取「已就绪的那个」，任一窗口失败就整体回滚，新开窗口在下次审计时自动补皮。设置页有开关与规则编辑，状态条报窗口数。实测见 [PLAN-v2-expansion.md](PLAN-v2-expansion.md) §2.4。
- **⑤ 跨产品复用**：同一份 `.bbskin` 在第二个自家产品 **Desktop AI Pet**（Tauri v2 + Vue + WebView2）里应用成功。为无 CSS 变量的宿主补了三条通用能力：`backgroundVar`/`varMap` 可选、`textSelectors`（选择器压文字色，按模式两份）、`skipSelector`（点名不换肤的窗口，AI-Pet 的桌宠窗口）。端口归属校验改为顺祖先链认领 `msedgewebview2.exe`，否则所有 WebView2 宿主都会被判成"端口被占用"。AI-Pet 的 profile 落在 `%LOCALAPPDATA%\BackdropBuddy\hosts\ai-pet.json`，`BACKDROPBUDDY_HOST=ai-pet` 切过去。实测见 §2.6。

- **安装器修复（2026-10-24）**：`build/setup.iss` 的数据目录护栏原来用 `ExpandConstant('{userprofile}')`，这个 Inno 版本的卸载器不认该常量——`CurUninstallStepChanged` 抛 `Unknown constant`，**卸载器退出码仍是 0**、文件/注册表/快捷方式照删，但 `uninstall.log` 里留 exception 且"数据已保留"分支不执行。改成 `GetEnv('USERPROFILE')` 后重装重卸日志干净。同一份包两轮实测：静默装/卸 exit 0；安装目录 150 文件 = 暂存 148 + 卸载器两件，逐文件 md5 0 缺 0 改；HKCU 卸载键与开始菜单快捷方式齐全；装好的程序能起（37 个方法、splash 3.10s、adopt 到现有主题、宿主关着时报 `host-offline` 无横幅）；卸载后用户数据 90 文件 / 28 主题文件逐字节不变（含 `hosts/ai-pet.json`）。**验卸载不能只看退出码，必须读 uninstall 日志。**

**待办按优先级**

1. 代码签名（安装包 + exe），消除 SmartScreen 警告。
2. 全新 Windows 10/11 用户机验收，含 WebView2 缺失与交互式向导实际路径。
3. UI 内启动/重启宿主（复用 `host/launch.ps1` / `host/stop.ps1`，按 PID 收进程），减少手动传参。
4. 素材派生（配色抽取 / 合成图层 / 批量生成）**暂缓**：主题素材只用你自己上传的图片与视频，不做造图。
5. 自动更新、主题市场、随包 LGPL ffmpeg 按需再评估。

> 完整方向清单、真机证据与未验证项在 [PLAN-v2-expansion.md](PLAN-v2-expansion.md)（①②③④⑤ 已标完成）。

---

## 附：一页速览

```
现状   V1.1.0 已交付；① profile 化 + 接入向导、② 残留校对 + 托盘、③ 明暗切换适配、④ 调度 + 多窗口 + 两个开关、⑤ 跨产品复用（AI-Pet）已落地（2026-10-23/24）
壳     .NET Framework 4.8 + WPF + WebView2
界面   React 18.3.1 + Vite 单文件
内核   Node 22.22.2 ESM，NDJSON over stdio（模块数 / 测试数 / 体积见 build/out-next/build.json）
平台   PowerShell 5.1
协议   dreamskin.manager/1，单条 ≤1 MiB
宿主   profile 化：ZCode（默认）+ Obsidian + 接入向导生成的自定义宿主；只读识别 + CDP 注入，不改宿主文件
交付   安装包 / 便携 ZIP / 校验和 / 中文安装器（字节数与哈希见 build/out-next/build.json、delivery.json）
阶段   P0 → P7 ✅；①②③④⑤ 全部落地（PLAN-v2-expansion.md）
闸门   P0 能构建 + 能只读连宿主；R3/R4 一票否决；③ 先复现明暗切换再动代码
```
