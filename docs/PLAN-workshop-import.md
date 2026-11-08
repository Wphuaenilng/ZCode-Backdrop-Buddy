# Wallpaper Engine 壁纸导入

> 更新：2026-11-08
> 范围：扫描本机 Steam 创意工坊与 Wallpaper Engine 本地项目，把视频型壁纸复制导入「我的主题」
> 当前状态：**内核扫描 / 导入 / 去重链路与 UI 已实现；内核测试与真机内核协议链路（夹具环境）通过；真实 Steam 注册表发现待真机复验**

## 0. 当前结论（先读）

「WE 导入」页扫描本机 Steam 创意工坊（App ID 431960）与 Wallpaper Engine 本地项目目录，视频型壁纸（`project.json` 的 `type:"video"`）可一键复制进「我的主题」，复用现有 `theme.import` 全链路（探测 → 哈希 → 事务暂存 → 缩略图 → 原子提交）。场景 / 网页 / 应用型壁纸不是媒体文件，只能由 Wallpaper Engine 自身渲染：UI 展示但置灰，标注「仅 Wallpaper Engine 可用」，永不导入、永不执行。

## 1. 协议方法

| 方法 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `workshop.scan` | 无 | `{found, steamPath?, source?, roots, items[], skipped, truncated, cap}` | 磁盘只读；加入 `READ_ONLY_METHODS` 不排写链。`items[]` 元素 `{id, title, type, supported, bytes, previewUrl?}`，**不含任何本地路径** |
| `workshop.import` | `{id}` | `{imported:true, theme}` / `{duplicate:true, theme}` / `{imported:false, code, message}` | `id` 必须命中最近一次扫描缓存，否则 `WORKSHOP_ITEM_NOT_FOUND`；同一视频按 `media.sha256` 去重（哈希由调用方预计算传给 `importTheme`，不重复读盘） |

新增错误码：`WORKSHOP_ITEM_NOT_FOUND`、`WORKSHOP_ITEM_INVALID`。设置协议新增 `steamPath`（string≤512|null，`zcodePath` 同款约定，本轮无设置页 UI）。

## 2. 实现结构

- `platform/windows/workshop/steam-locations.ps1`：注册表 `HKCU:\Software\Valve\Steam\SteamPath` + 解析新旧两处 `libraryfolders.vdf`，返回全部库路径。
- `kernel/workshop/discover.mjs`：发现候选链（设置 `steamPath` → `BACKDROPBUDDY_STEAM_PATH` → 常见路径 → PowerShell）；`parseProject` / `scanWorkshop` / `workshopRoots`（cap 300，坏条目只计 `skipped` 数量）。
- `kernel/handlers/workshop.mjs`：两个方法；扫描结果（含媒体绝对路径）只存活在 handler 闭包里，UI 回传 `id` 换取路径；预览图魔数校验 + ≤5 MiB 后复制到 `cache\preview\workshop\`，经 `preview.backdropbuddy.invalid` 虚拟主机展示（被清理则下次扫描重拷）。
- `kernel/store/library.mjs`：新增 `findByMediaHash(sha256)`（遍历 builtin+user 记录）。
- UI：`ui/src/components/WorkshopImportView.jsx`（进入页面自动扫描，逐条/批量导入，批量顺序逐条调用，单条失败不中断）+ `TopBar` 新 tab「WE 导入」+ `App.jsx` 导入成功后刷新主题列表并切筛选到「我的」。

## 3. 安全边界

- 第三方 `project.json` 与预览图按不可信输入处理：JSON ≤1 MiB；媒体/预览路径拒绝绝对路径与 `..` 段（解析层 + fs 层双重校验），并对 symlink/junction 做 `realpathSync` containment、对硬链接按 `nlink>1` 拒收（词法校验挡不住重解析点与硬链接，先例见 `startupImagePath`）；预览图魔数校验后才复制。
- 导入前按扫描缓存的 `itemDir + file` 重新走一遍完整校验（scan→import 存在 TOCTOU 窗口），以新解析路径为准。
- 媒体扩展名白名单（扫描层拒收 + 导入层复检）：`.json/.zip/.bbskin` 会被 `importTheme` 的扩展名路由劫到主题包导入（绕过 probe 与体积闸门），因此视频条目只放行视频扩展名。
- 媒体文件走与手动导入完全相同的校验路径（`probeMedia` 魔数嗅探 + 视频 ≤200 MiB 上限），只复制不执行；本功能不引入任何 HTML/JS 执行面。
- UI 只传条目 `id`（协议层 `^[A-Za-z0-9_.-]{1,80}$` 校验），本地路径永不过协议。
- 不安全目录名的 id 哈希混入所在根路径，两个根的同名本地项目不会撞 id。
- 扫描只读工坊目录一级；导入是复制（`importTheme` 事务），不引用原文件，订阅取消不影响已导入主题。预览缓存重扫时按 size/mtime 跳过未变化的副本。

## 4. 验证

- `tests/kernel/workshop.test.mjs`（14 项）：`parseProject` 纯函数用例（类型白名单、标题回退、穿越拒绝、不安全目录名的确定性 id）；`scanWorkshop` 真目录夹具（跳过计数、cap 截断、`workshopRoots` 收集）；信任边界（junction/hardlink 逃逸拒收、`.json/.zip` 媒体拒收、跨根同名 id 不冲突、候选命中展开 `libraryfolders.vdf`）；真实内核协议往返（扫描 → 预览落盘 → 导入 → 再次导入去重 → 场景型/未知 id 的错误码 → 响应带 `cap` 且不含本地路径）；mock 库下的失败传播；`steam-locations.ps1` 真机冒烟。
- 全量内核测试 176/176 通过（`--test-concurrency=2`）；UI 构建 + JSDOM 冒烟通过。
- 真机内核协议链路（夹具环境）：见 §5。

## 5. 待复验与已知边界

- **真实 Steam 发现待复验**：本机未安装 Steam，`steam-locations.ps1` 对真实注册表与 `libraryfolders.vdf` 的解析未在真机验证（编码问题已代码层修复：`Get-Content -Encoding UTF8` + 大小写不敏感去重）；发现链前三层（设置/env/常见路径）已覆盖绝大多数场景，且候选命中后会在内核侧直接展开 `libraryfolders.vdf`。装有 Steam + WE 的机器上跑一轮「扫描 → 导入 → 应用」即可关闭此项。
- 夹具覆盖验收：无 Steam 环境用 `BACKDROPBUDDY_STEAM_PATH` 指向构造的 `steamapps\workshop\content\431960\<id>\` 目录完成全链路验收；「未检测到 Steam」空状态由无 Steam 环境天然覆盖。
- HEVC / AV1 编码的 WE 视频能否播放取决于 WebView2 解码能力，与手动导入视频主题的既有约束一致；超大视频（>200 MiB）导入会带 `MEDIA_TOO_LARGE` 失败，卡片上展示原因。
- 媒体有效性沿用现有导入的宽松校验（无 ffprobe 时靠魔数嗅探），损坏视频可能导入成功但宿主播放黑屏——与手动导入行为一致，不在本功能收紧。
