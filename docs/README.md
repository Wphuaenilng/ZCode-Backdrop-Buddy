# BackdropBuddy

BackdropBuddy 是一个 Windows 原生主题管理器，为 ZCode 桌面端换肤：选一张图片或一段视频，应用为 ZCode 的背景与配色，随时暂停、恢复原貌。所有主题与素材只保存在本机，不联网、不上传。

当前版本：**1.1.1** · 发布者：钧天造物（Juntian Works）

## 功能

- 41 个随包壁纸主题（图片、视频，取自 Codex Dream Skin 预设库）
- 导入图片或视频，自动生成缩略图、探测媒体信息并按需压缩
- 应用 / 暂停 / 继续 / 重置 / 恢复原貌
- `.bbskin` 主题包导入与导出（ZIP：`pack.json` + `theme.json` + 媒体）
- 主题保存、删除、重命名（我的主题）；重启后保留选中主题、运行态与窗口位置
- 可选关闭时最小化到系统托盘，皮肤继续运行；从托盘菜单退出
- 宿主切深色 / 浅色时皮肤自己跟上，不需要重新应用
- 自动切换规则：每天到点、宿主明暗变化、系统明暗变化各换指定主题；托盘常驻时按下次触发时间自己醒来
- 减弱动效（视频主题改用首帧静图）、启动时自动应用上次的主题
- 宿主开多个渲染窗口时同时换肤，新窗口刷新一次即自动补上
- 能接没有 CSS 变量的宿主（Tauri / WebView2 这类）：靠选择器上色与点名跳过的窗口；已在自家 Desktop AI Pet 上跑通，用 `BACKDROPBUDDY_HOST=ai-pet` 切过去
- 应用皮肤时若 ZCode 未开放调试端口，会提示是否重启/启动 ZCode，确认后自动完成并应用所选主题
- 本地优先：主题库、备份、日志、导出都在用户数据目录

## 系统要求

| 项目 | 要求 |
| --- | --- |
| 系统 | Windows 10 1809+ / Windows 11，x64 |
| 运行时 | .NET Framework 4.8（Windows 10 1903+ 通常已内置） |
| WebView2 | Microsoft Edge WebView2 Runtime（安装包会检测） |
| 宿主 | ZCode ≥ 3.0（默认，实测 3.16.2）；也支持 Obsidian、Desktop AI Pet 与向导接入的自定义宿主 |
| 可选 | `ffmpeg` / `ffprobe`，用于视频缩略图与图片压缩 |

## 安装

运行 `BackdropBuddy-Setup-1.1.1.exe`：

- **per-user 安装，不需要管理员权限**
- 默认目录：`%LOCALAPPDATA%\Programs\BackdropBuddy`
- 创建开始菜单快捷方式；桌面快捷方式可选
- 安装前检查 WebView2 Runtime 与 .NET Framework 4.8，缺失时给出提示

静默安装：

```bat
BackdropBuddy-Setup-1.1.1.exe /VERYSILENT /CURRENTUSER /NORESTART
```

卸载：Windows 设置 → 应用 → BackdropBuddy。**默认保留用户主题与设置**；卸载向导会询问是否一并删除，静默卸载可加 `/PURGEDATA=1` 强制清除。

## 启动 ZCode（重要）

BackdropBuddy 通过 Chrome DevTools Protocol（CDP，默认端口 9229）连接 ZCode 的渲染进程。ZCode 是单实例应用：**如果已有 ZCode 在运行，新传入的命令行参数会被旧进程忽略**。

因此请先完全退出 ZCode（包括任务栏托盘/后台进程），再带调试端口启动：

```bat
"C:\Path\To\ZCode.exe" --remote-debugging-port=9229
```

- 默认路径为 `F:\shop\ZCode\ZCode.exe`；找不到时程序会自动搜索运行中的 ZCode、注册表卸载信息和开始菜单快捷方式
- 便携版或自定义安装仍找不到时，在「设置 → 应用设置 → ZCode 位置」填写 `ZCode.exe` 的完整路径，或设置环境变量 `ZCODE_PATH`，然后重启 BackdropBuddy
- 端口被占用时可用 `ZCODE_PORT` 修改（需与 ZCode 启动参数一致）

建议为 ZCode 新建一个带参数的快捷方式，专门用于配合 BackdropBuddy。若 BackdropBuddy 提示“调试端口未开放”，按上面的步骤重启 ZCode 即可。

也可以直接点击「应用皮肤」：检测到 ZCode 未开放调试端口时，会弹出确认框；确认后程序会关闭并带 `--remote-debugging-port=9229` 重启 ZCode，完成后自动应用所选主题。该操作会中断当前 ZCode 窗口，但不会修改 ZCode 的安装文件。

## 使用

1. **控制台**：左侧主题库（全部 / 内置 / 我的），中间宿主预览，右侧应用、暂停/继续、重置、恢复。
2. **导入**：选择图片或视频；可选主题名与参数，保存到“我的主题”。
3. **设置**：外观参数、我的主题改名、托盘行为、ZCode 位置、减弱动效与启动自动应用、自动切换规则（每天到点 / 宿主明暗 / 系统明暗 → 指定主题）、运行信息。主题包导入导出入口在控制台工具栏。
4. **接入宿主**：先用 `--remote-debugging-port=<端口>` 启动目标程序（WebView2 宿主也可以设 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<端口>`），在这里填端口做只读检测 → 到目标窗口里点选根容器与要透明化的面板 → 选背景与文字变量（**没有 CSS 变量的宿主勾「这个宿主没有 CSS 变量」**，改用「文字元素」手填选择器上色；「不要换肤的窗口」填只在该窗口出现的选择器，比如桌宠的 `.pet-root`）→ 试穿一次（应用后自动恢复）→ 保存为自定义宿主。切换宿主用环境变量 `BACKDROPBUDDY_HOST=<id>`，默认 `zcode`。

应用主题只作用于目标应用正在运行的渲染进程：注入固定 ID 的样式与背景层，恢复时逐项撤销并校验。BackdropBuddy **不修改宿主安装目录中的任何文件**。

宿主在自己的设置里切深色 / 浅色时，皮肤会跟着换到另一套 token 与渐变底，**不需要重新应用**；暂停 / 继续的校验也按页面此刻的模式判定。

## 数据位置

```text
%LOCALAPPDATA%\BackdropBuddy\
├── themes\
│   ├── builtin\       # 内置配色主题
│   ├── user\          # 我的主题（含导入的素材）
│   ├── staging\       # 事务暂存
│   ├── pointer.json   # 当前应用的主题与暂停状态
│   └── runtime.json   # 宿主运行态（重启后继续暂停/继续/重置）
├── hosts\             # 接入向导生成的自定义宿主 profile（<id>.json）
├── cache\preview\     # 预览与缩略图缓存
├── backup\            # 宿主样式快照
├── logs\              # 内核与壳日志（JSONL）
├── exports\           # 导出的 .bbskin / 配置
├── WebView2\          # 界面自身用的 WebView2 用户数据
├── config.json        # 偏好、选中主题、自动切换规则
└── window.json
```

设置环境变量 `BACKDROPBUDDY_DATA_DIR` 可把数据目录指到别处（便携/测试用）。

## 可选：ffmpeg

视频首帧缩略图与图片压缩依赖 `ffmpeg` / `ffprobe`。它们**不随安装包分发**：

- 已加入 `PATH` 时自动使用
- 或用 `BACKDROPBUDDY_FFMPEG`、`BACKDROPBUDDY_FFPROBE` 指定完整路径
- 未安装时，视频主题仍可应用，但缩略图/时长等信息可能缺失

## 从源码构建

需要：

- Visual Studio 2022 Build Tools（MSBuild 17）+ .NET Framework 4.8 Targeting Pack
- Node.js 22.22.2：下载 win-x64 便携版，把 `node.exe` 与 `LICENSE` 放到 `runtime\node\`（`node.exe` 约 83 MB，未入库）
- 首次构建前：`npm ci --prefix ui`
- 打包安装包需要 Inno Setup 6（`ISCC.exe`）

一键构建（UI → 内核测试 → Release 编译 → 资源拷贝 → 布局校验 → ZIP + 清单）：

```powershell
powershell -ExecutionPolicy Bypass -File build\build.ps1
```

出安装包：

```powershell
powershell -ExecutionPolicy Bypass -File build\package.ps1
```

产物在 `build\out\`：

- `BackdropBuddy-1.1.1\`：可直接运行的完整目录
- `BackdropBuddy-1.1.1.zip`：便携包
- `BackdropBuddy-Setup-1.1.1.exe`：per-user 安装包
- `manifest.json`、`SHA256SUMS.txt`、`build.json`

## 已知限制

- 仅支持 ZCode 单宿主；其他 Electron 应用留待后续版本
- 需要 ZCode 以调试端口启动；不支持自动重启已在运行的 ZCode
- 安装包与可执行文件未做代码签名，SmartScreen 可能提示“未知发布者”
- 主题的动画与视频播放遵循 ZCode 页面自身策略；系统“减少动态效果”不会自动停用

## 文档

- [深色模式可读性问题与修复方案](issue-dark-mode-contrast.md)
- 实施计划与阶段记录：源码仓库 `docs/PLAN.md`

历史设计与原型材料在源码仓库 `.design/archive/`。

## 许可证

- 本项目：见 [LICENSE](LICENSE)（专有软件，保留所有权利）
- 第三方组件：见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) 与 `licenses\` 目录

ZCode 是独立的第三方产品，本项目不包含、不修改其安装文件，与其开发者无隶属关系。
