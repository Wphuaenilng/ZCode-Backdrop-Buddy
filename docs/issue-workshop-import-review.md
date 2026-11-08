# WE 导入功能代码审查清单（2026-11-08）

> **状态**：**已执行（2026-11-08）**。下方第 0–14 节保留为原始问题与判据记录；实际落地与偏差见「§15 执行结果」。
>
> | 项 | 值 |
> | --- | --- |
> | 来源 | 代码审查员 Agent 对工作区未提交变更的审查 |
> | 审查范围 | WE 导入功能（kernel/workshop、handlers/workshop、schema、platform/windows/workshop、UI、测试、docs）+ 壳层两处修复（MainWindow 托盘最小化动画、SplashWindow DPI 对齐） |
> | 版本基线 | `main` @ `4cb9720` + 未提交变更（16 个修改文件 + 7 个新增文件/目录） |
> | 问题数 | 10 项（高 3 / 中 4 / 低 3，其中第 10 项为风格小问题合集）+ 复核补充 1 项（#1 的硬链接残余缺口，并入 #1 修复） |
> | 本次实测 | 全量内核测试 **172/172**（`--test-concurrency=2`，约 100.6 s）；3 组临时夹具探针实证 4 个问题（#1、#2、#6、#8），探针未改仓库代码、用后即删 |
> | 真机复验（2026-11-08） | #3/#4 已在真实 Windows 11 桌面真机验证通过：动画开/关两种系统状态、最大化/普通两种窗口状态，共 4 组「点 X → 托盘 → 恢复」组合，全部表现符合修复后预期；系统动画设置测后已恢复 |

---

## 0. 问题总览

| # | 严重度 | 问题 | 位置 | 证据级别 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | 高 | 符号链接逃逸：第三方条目可把任意本机文件复制进主题库 | `kernel/workshop/discover.mjs:77-89` | 实证 | 待修 |
| 2 | 高 | 扩展名路由绕过「只导入视频」契约 | `kernel/handlers/workshop.mjs:94` → `kernel/store/library.mjs:502-515` | 实证（.json 路径）+ 代码级（.zip/.bbskin） | 待修 |
| 3 | 高 | 系统动画关闭时点 X 进托盘完全失效 | `src/BackdropBuddy.Shell/MainWindow.xaml.cs:1019-1023,1040` | 代码级 | 待修 |
| 4 | 中 | 最大化窗口进托盘后恢复变普通尺寸（回归） | `MainWindow.xaml.cs:1030` + `:96` | 代码级 | 待修 |
| 5 | 中 | 多 Steam 库只在 PowerShell 回退分支展开 | `kernel/workshop/discover.mjs:121-127` | 代码级 | 待修 |
| 6 | 中 | 跨根目录 id 冲突：导入 A 卡片实际入库 B 的视频 | `discover.mjs:27-35` + `handlers/workshop.mjs:64-65` | 实证 | 待修 |
| 7 | 中 | scan 全同步 IO + 每次重扫全量重拷预览，阻塞事件循环 | `handlers/workshop.mjs:41-62`、`discover.mjs:181-247` | 代码级 | 待修 |
| 8 | 低 | native scan 响应缺 `cap` 字段，截断提示显示 undefined | `handlers/workshop.mjs:67-75` vs `WorkshopImportView.jsx:162` | 实证 | 待修 |
| 9 | 低 | ps1 读 libraryfolders.vdf 未指定编码，中文库路径疑似乱码 | `platform/windows/workshop/steam-locations.ps1:31` | 疑似，待真机 | 待复验 |
| 10 | 低 | 风格/小问题合集（5 条） | 见 §10 | 代码级 | 酌情 |

---

## 1. 符号链接逃逸（高，安全，实证）

- **位置**：`kernel/workshop/discover.mjs:77-89` `resolveMediaFile`。
- **判据**：校验只做词法 containment（`path.resolve` + `path.relative`），`fs.statSync` 跟随符号链接。条目目录内放一个指向外部文件的 symlink，`project.json` 的 `file` 指向它，全部校验通过。
- **实证**：临时夹具中 symlink 指向工坊树外的 `secret.txt`，scan 返回的 `mediaPath` 读出了外部内容（`TOP-SECRET-CONTENT`）；import 会将其复制进「我的主题」。
- **影响**：恶意工坊条目或本地项目可读取任意本地文件入库，随后经 `.bbskin` 导出外传；去重哈希也算的是目标文件内容。代码明确设防 `..`/绝对路径（PLAN §3），却被 symlink/junction 绕过。仓库自己的 `startupImagePath`（`kernel/store/library.mjs:69-74`）已有 `realpathSync` containment 校验，新代码未沿用该约定。
- **最小修复**：对 root 与 resolved 做 `realpathSync` 后的 containment 校验（照抄 `startupImagePath` 模式），或 `lstat` 拒绝 reparse point；import 时对缓存的 `mediaPath` 再验一次（scan→import 之间存在 TOCTOU 窗口）。
- **前置条件说明**：文件 symlink 需管理员/开发者模式权限（探针环境为管理员）；目录 junction 无需提权。Steam 工坊下载是否保留 symlink 未验证，但 myprojects 本地目录完全可由本机其他程序植入。

## 2. 扩展名路由绕过「只导入视频」契约（高，逻辑/安全，实证）

- **位置**：`kernel/handlers/workshop.mjs:94` 调 `importTheme`；`kernel/store/library.mjs:502-515` 按扩展名先路由。
- **判据**：`importTheme` 在 probe/kind 校验**之前**按扩展名分流：`.bbskin`/`.zip` → `importPack`，匹配 schema 的 `.json` → `importJsonPack`。workshop handler 传的 `kind:'video'` 在这些分支里不生效。
- **实证**：构造 `type:"video", file:"payload.json"`（内容为合法 `backdropbuddy.theme/1` 记录）→ 真实内核协议返回 `imported:true`，产出 `media:null` 的主题，走了 `importJsonPack`。`.zip`/`.bbskin` 同理路由到 `importPack`（代码可读；包上限 300 MiB 而非视频 200 MiB）。
- **影响**：第三方条目可走私任意主题记录（params、startup 行为、内嵌图片），绕过类型与体积闸门，直接违反 PLAN §3「视频型才导入、媒体走 probeMedia + ≤200 MiB」的声明边界。非代码执行，但属信任边界 bypass。
- **最小修复**：workshop handler 在调 `importTheme` 前按视频扩展名白名单校验（或先 `media.probe` 强制 `kind==='video'`）；或给 `importTheme` 增加禁用 pack 路由的选项。

## 3. 系统动画关闭时点 X 进托盘失效（高，bug）

- **位置**：`src/BackdropBuddy.Shell/MainWindow.xaml.cs:1019-1023`（无动画分支）+ `:1040`（Hide 条件）。
- **判据**：`SystemParameters.ClientAreaAnimation == false` 时直接调 `FinishHideToTray()`，但此时 `WindowState` 仍为 `Normal`（未经过 `:1030` 的 Minimized 赋值），而 `Hide()` 的前置条件是 `WindowState == Minimized && IsVisible` → 永不成立。`OnClosing` 已 `e.Cancel = true`，窗口原地不动。
- **影响**：「调整为最佳性能」或手动关闭窗口动画的机器上，开启最小化到托盘后点 X 无任何反应。代码级证据（本环境未运行 WPF）。
- **最小修复**：无动画分支直接 `Hide()`，不复用带 Minimized 前置条件的 `FinishHideToTray`；或给后者加强制隐藏参数。

## 4. 最大化窗口进托盘后恢复变普通尺寸（中，回归）

- **位置**：`MainWindow.xaml.cs:1030`（AnimateToTray 设 Minimized）+ `:96`（ActivateFromSecondInstance 一律还原 Normal）。
- **判据**：改动前 `OnClosing` 直接 `Hide()`，不动 `WindowState`，最大化窗口从托盘回来仍是最大化；改动后先置 Minimized，恢复时 `if (WindowState == Minimized) WindowState = Normal` → 回到最大化前的还原尺寸。所有托盘恢复路径（左键单击、菜单「打开主界面」、二次实例激活）都走 `ActivateFromSecondInstance`，无一幸免。
- **附加不一致**：关闭时 `SaveWindowState` 落盘的是 `"maximized"`（`:936`），下次启动会最大化，与本会话恢复行为不一致。
- **最小修复**：进托盘前记录原 WindowState（或最大化标志），恢复时按记录还原。

## 5. 多 Steam 库只在 PowerShell 回退分支展开（中，逻辑缺口）

- **位置**：`kernel/workshop/discover.mjs:121-127`。
- **判据**：config/env/Program Files 任一候选命中即返回 `libraries:[该路径]`，不读 `libraryfolders.vdf`；只有 `search`（PowerShell）分支展开库列表。
- **影响**：Steam 在默认位置、WE 装在第二库（C 盘 Steam + D 盘 WE，常见配置）→ 扫描找到 Steam 却 0 条目，UI 误报「没有发现 Wallpaper Engine 壁纸项目」。且此时设置 `steamPath`/环境变量反而更糟（同样不展开）。`kernel/schema/settings.mjs` 注释声称「库列表由 libraryfolders.vdf 展开」与实际不符。
- **最小修复**：候选命中后同样展开 `libraryfolders.vdf`（复用 ps1 或 JS 直接解析）；同步修正注释。

## 6. 跨根目录 id 冲突（中，逻辑，实证）

- **位置**：`kernel/workshop/discover.mjs:27-35` `itemIdFor` + `kernel/handlers/workshop.mjs:64-65` `lastScan` Map。
- **实证**：两个 myprojects 根各有「我的壁纸」目录 → 两条目 id 同为 `wp-13kx2cp`（djb2 哈希只混入目录名，不含根路径）。
- **影响**：`lastScan.set(id, item)` 只留后者；UI 渲染两张同 id 卡片（React key 重复），点前一张卡导入的是后一条的媒体；`results` 状态也会串卡。工坊数字 id 全局唯一不受影响，本地项目目录名很容易撞；djb2 32 位哈希本身也有碰撞概率。
- **最小修复**：id 混入根路径（如 `hash(root + name)`），或扫描时按 id 去重并计入 skipped。

## 7. scan 全同步 IO，阻塞事件循环（中，性能）

- **位置**：`kernel/handlers/workshop.mjs:41-62`、`kernel/workshop/discover.mjs:181-247`；`kernel/transport/stdio.mjs:8` 注释。
- **判据**：`READ_ONLY_METHODS` 只是不排写链；`readdirSync/readFileSync/copyFileSync` 仍阻塞单线程事件循环。最坏 300 条目 × 5 MiB 预览 = 1.5 GB 同步复制；每次重扫无条件全量重拷（无存在性/mtime 判断）。
- **影响**：大工坊扫描期间内核所有请求与事件停摆，「扫描工坊时不卡皮肤应用」只在队列层成立，事件循环层不成立。
- **最小修复**：目标文件已存在且 size/mtime 一致则跳过复制；进一步换异步 fs 分块让出事件循环。

## 8. native scan 响应缺 `cap` 字段（低，bug，实证）

- **位置**：`kernel/handlers/workshop.mjs:67-75` 返回对象无 `cap`；`ui/src/components/WorkshopImportView.jsx:162` 使用 `scan.cap`。
- **实证**：真实内核 scan 响应 `cap === undefined`；条目 >300 触发截断时 UI 显示「仅显示前 **undefined** 个」。
- **掩盖原因**：`ui/src/bridge.js` mock 返回 `cap:300`，内核测试也未断言 `cap`，mock 模式与测试都看不到问题。
- **最小修复**：响应补 `cap: scan.cap`（`scanWorkshop` 已返回该字段）；同步更新 PLAN §1 协议表。

## 9. ps1 读 vdf 未指定编码（低，疑似，待真机）

- **位置**：`platform/windows/workshop/steam-locations.ps1:31`。
- **判据**：PS 5.1 `Get-Content` 对无 BOM 文件默认按系统 ANSI 读取；Steam 的 `libraryfolders.vdf` 为 UTF-8，中文库路径可能乱码 → `GetFullPath` 成功但路径错误 → 根目录不存在被静默丢弃。代码级事实确定（未指定 `-Encoding`），影响取决于 Steam 实际写盘编码，需真机确认。
- **次要**：`$libraries.Contains` 大小写敏感，`C:\Steam` 与 `c:\steam` 会重复入库（下游 `workshopRoots` 有大小写去重兜底，影响小）。
- **最小修复**：`Get-Content -Encoding UTF8`；列入 PLAN §5 已声明的真机复验清单（复验时加一个中文路径库）。

## 10. 风格/小问题合集（低）

1. `previewFileName`（`handlers/workshop.mjs:13-18`）注释声称收敛字符集可消除分隔符冲突，实际 `a_b` 与 `a-b` 仍同归 `a-b` 互覆盖；仅影响封面，72 字符截断同理。
2. 新导入哈希算两遍：handler 去重一次 + `importTheme` 锁内一次（`library.mjs:527`），200 MiB 文件多读一遍；可考虑向 `importTheme` 传入预计算哈希。
3. `.workshop-card` 硬编码 `rgba(255,255,255,.8)`（`styles.css`），其余卡片用 `var(--card)`，不一致。
4. `FinishHideToTray` 在实际未隐藏（用户已从任务栏还原）时仍记 "window hidden to tray"，日志误导。
5. UI 失败项 checkbox 被 `disabled={!!state}` 锁死（`WorkshopImportView.jsx:184`），只能单卡重试、不能重新勾选批量重试，UX 不一致。

---

## 11. 测试缺口

现有 13 项 workshop 测试全过，但以下场景零覆盖（夹具基建已就位，各补一条成本低）：

| 场景 | 对应问题 | 建议断言 |
| --- | --- | --- |
| 条目内 symlink/junction 指向外部 | #1 | scan 计入 skipped，mediaPath 不返回 |
| `type:"video"` 但 file 为 .json/.zip/.bbskin | #2 | 返回 `WORKSHOP_ITEM_INVALID` 或 MEDIA_INVALID，不产出主题 |
| 两个根目录同名（不安全名）项目 | #6 | id 唯一，或去重计 skipped |
| scan 响应字段完整性 | #8 | `cap` 存在且等于 300 |
| 候选命中 + 多库 vdf | #5 | libraries 展开第二库（可用夹具 vdf） |

## 12. 待真机复验

- ~~#3/#4：WPF 行为仅代码级推断~~ **已真机验证（2026-11-08）**：动画开/关 × 最大化/普通共 4 组「点 X → 托盘 → 恢复」组合全部通过，系统动画设置测后已还原；验证细节见 §15 对应行。
- #5/#9：装有 Steam + WE（含第二库、中文路径库）的机器上跑「扫描 → 导入 → 应用」，与 PLAN §5 既有复验项合并。（#5 的多库展开逻辑已由夹具 vdf 单测覆盖，待复验的只剩真实注册表/真实 vdf 读取。）
- #1 前置条件：Steam 工坊下载是否保留 symlink 未验证；本地 myprojects 植入路径已实证（且修复后即使保留也会被拒收）。

## 13. 本次真跑过的命令与读数

| 命令 | 结果 |
| --- | --- |
| `node --test --test-concurrency=2 tests/kernel/workshop.test.mjs tests/kernel/modules.test.mjs tests/kernel/powershell.test.mjs` | **13 pass / 0 fail**（约 6.3 s） |
| `node --test --test-concurrency=2 "tests/kernel/*.test.mjs"` | **172 pass / 0 fail**（约 100.6 s） |
| 探针 1：条目内 file symlink → 工坊树外文件 | scan 接受，读出外部内容（#1 实证） |
| 探针 2：`type:"video", file:"payload.json"` 走真实内核协议 | `imported:true`、`media:null`；同轮确认 `cap === undefined`（#2、#8 实证） |
| 探针 3：两个 myprojects 根同名「我的壁纸」 | 两条目同 id `wp-13kx2cp`（#6 实证） |

> 注：探针均为 os.tmpdir() 下临时夹具 + 临时脚本，未改仓库代码，跑完即删。目录参数 `node --test tests/kernel/` 在本机 Git Bash 下会被解析坏（MODULE_NOT_FOUND），须用引号 glob `"tests/kernel/*.test.mjs"` 让 Node 自行展开。

## 14. 总评

功能链路完整、测试基线绿、协议边界设计（真实路径不过协议、id 换路径、扫描缓存只存活于 handler 闭包）思路正确。但两处安全边界（#1 symlink、#2 扩展名路由）已被实证绕过，**建议修复 #1–#3 后再提交**；#5 与 #9 需真机复验闭环。修复时请同步补 §11 测试，并在本文档补「执行结果」表。

## 15. 执行结果（2026-11-08）

全量内核测试 **176/176**（新增 4 项边界测试）；UI 构建 + JSDOM 冒烟 + eslint 通过；修复后重跑同构探针：#1/#2/#6/#8 四项全部归零，对照组（正常视频条目）导入不受影响。

**壳层真机验证（2026-11-08，Windows 11 桌面、Debug 构建、独立数据目录）**：以真实 WPF 进程走完「点 X → 托盘 → 恢复」全链路——

| 组合 | 操作链 | 判定依据 | 结果 |
| --- | --- | --- | --- |
| 动画开 + 最大化 | 最大化（bounds [-9,-9,1938,1038]）→ 点 X → 二次实例激活 | 日志 `window hidden to tray` + `MainWindowHandle=0` → 恢复后 bounds 不变、标题栏显示「还原」 | 通过（最大化保留） |
| 动画关 + 最大化 | 设置里关闭「动画效果」→ 重启进程（WPF 缓存以 False 初始化）→ 点 X → 恢复 | 同上判据；无动画分支立即真隐藏 | 通过（#3 的判别点：旧代码窗口会原地不动） |
| 恢复状态还原 | 两次恢复均回到进托盘前的最大化 | `_windowStateBeforeTray` 按记录还原 | 通过（#4 的判别点：修复前掉回普通尺寸 [60,15,1800,990]） |

测试托盘设置的持久化行为（window.json 随窗口状态落盘、启动读回）也被顺带实证：新进程启动即带托盘图标。测试全程未触碰并行运行的正式实例；系统「动画效果」设置测后已恢复为开。

| 项 | 状态 | 落地位置 | 验证 |
| --- | --- | --- | --- |
| #1 symlink/junction 逃逸（含补充的硬链接缺口） | 已修 | `discover.mjs` `resolveMediaFile`/`findPreview`：`realpathSync` containment + `nlink>1` 拒收（照 `startupImagePath` 先例，硬链接 realpath 就在条目内、路径校验原理上拦不住）；handler 导入前按缓存 `itemDir+file` 重走完整校验（封 TOCTOU） | 新增测试 1 项（junction+hardlink 均拒收）；探针复验：逃逸条目被跳过、秘密内容未入库 |
| #2 扩展名路由绕过 | 已修 | `discover.mjs` 扫描层视频扩展名白名单（`kindForMime(mimeFromExtension)`）；handler 导入层复检 | 新增测试 1 项（`.json`/`.zip` 拒收）；探针复验：走私条目不产出主题 |
| #3 无动画托盘失效 | 已修 | `MainWindow.xaml.cs` `FinishHideToTray(force)`：无动画分支强制隐藏 | **真机通过**：设置里关闭「动画效果」（`ClientAreaAnimation=False`，WPF 缓存随进程重启以 False 初始化）后点 X，`MainWindowHandle=0`、日志 `window hidden to tray`、进程存活；恢复后回到最大化。旧代码该分支 `Hide()` 前置条件永不成立，窗口会原地不动 |
| #4 最大化恢复降级 | 已修 | `MainWindow.xaml.cs` 新增 `_windowStateBeforeTray`：`AnimateToTray` 记录，`ActivateFromSecondInstance` 以 `!IsVisible \|\| Minimized` 为守卫按记录还原（不影响可见最大化的窗口） | **真机通过**：最大化（bounds [-9,-9,1938,1038]）→ 点 X → 托盘 → 二次实例激活恢复 → bounds 仍为 [-9,-9,1938,1038]；动画开/关两种系统状态下各验一轮，最大化均保留（修复前会掉回 [60,15,1800,990]） |
| #5 多库只在 PS 分支 | 已修 | `discover.mjs` 新增 `parseLibraryFolders`：候选命中后在内核侧展开新旧两处 vdf（不必拉起 PowerShell）；`settings.mjs` 注释同步修正 | 新增测试 1 项（夹具 vdf → 第二库条目可扫到） |
| #6 跨根 id 冲突 | 已修 | `itemIdFor(dirName, rootKey)`：不安全名哈希混入根路径；`scanWorkshop` 传根 | 新增测试 1 项；探针复验：`wp-13kx2cp` 单 id → 两个不同 id |
| #7 同步 IO + 全量重拷 | 部分修 | 预览复制按 size/mtime 跳过未变副本；扫描/复制本身未异步化（受 cap=300、project.json ≤1 MiB、预览 ≤5 MiB 约束，量大再异步化） | 代码级 |
| #8 cap 缺失 | 已修 | handler 返回补 `cap`（未找到 Steam 分支 `cap: 0`）；PLAN §1 协议表同步 | round-trip 断言 `cap===300`；探针复验 `cap=300` |
| #9 vdf 编码 | 已修（代码层） | ps1 `Get-Content -Encoding UTF8` + 大小写不敏感去重 | 真机复验仍待（PLAN §5） |
| #10.1 注释与行为不符 | 已修 | `previewFileName` 注释改为如实描述（不同 id 仍可能互覆盖，仅封面缓存，可接受） | 代码级 |
| #10.2 双重哈希 | 已修 | `library.importTheme` 接受预计算 `sha256`，workshop 导入传入（省一次全文件读） | round-trip 测试仍通过 |
| #10.3 卡片底色不一致 | 不采纳 | `.workshop-card` 与其模板 `.scan-card`（styles.css:1132）同为 `rgba(255,255,255,.8)`，二者一致；用 `var(--card)` 的是另一批组件，不构成失配 | — |
| #10.4 日志误导 | 已修 | `FinishHideToTray` 按实际结果写日志（隐藏成功 / 已还原跳过） | 代码级 |
| #10.5 失败项不可批量重试 | 已修 | checkbox 只锁已入库（imported/duplicate）项，失败项可重新勾选进批量 | 代码级 |
| §11 测试缺口 | 已补 | `workshop.test.mjs` 10 → 14 项：junction+hardlink 逃逸、`.json/.zip` 拒收、跨根同名 id、候选+多库 vdf 展开、round-trip 断言 cap | 全量 176/176（`--test-concurrency=2`） |

> 修复后探针（同构夹具）：`#8 cap=300`、`#1 逃逸条目跳过且秘密内容未入库`、`#2 走私条目 WORKSHOP_ITEM_NOT_FOUND`、`#6 两 id 不同`，全部 FIXED；对照组正常视频条目 `imported:true`。#3/#4/#5/#9 的真机复验项保持 §12 清单不变。