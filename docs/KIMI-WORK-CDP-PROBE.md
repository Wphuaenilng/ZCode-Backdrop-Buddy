# Kimi Work 背景接入：检查结论与 CDP 只读探针执行手册

> 检查日期：2026-10-26  
> 文档状态：待其他应用执行  
> 目标应用：Windows 版 Kimi Work  
> 本机检查版本：`3.2.20.18`  
> 默认执行范围：一次受控重启、临时回环 CDP、只读页面探测、恢复正常启动  
> 不在默认范围：注入背景、修改主题、修改安装目录、读取凭据、强制结束进程

## 0. 执行卡片

### 0.1 目标

验证以下问题：

1. Kimi Work 带临时 CDP 参数重启后，是否真正开放调试端口。
2. 端口是否仅监听回环地址，并归属于本次启动的 Kimi 进程树。
3. `/json/list` 中是否出现主 Work 页面 `app://localhost/kimi-agent.html`。
4. 能否通过 CDP WebSocket 只读获取主页面 DOM 与计算样式信息。
5. 完成探测后，能否关闭调试端口并恢复正常启动。

### 0.2 本手册不证明什么

即使全部只读检查通过，也只能得出：

> **Kimi Work 具备进入 BackdropBuddy 静态背景最小实验的接入条件。**

它不等于：

- 已经支持图片或视频背景。
- 已经确认背景层可见、可读或不拦截输入。
- 已经确认刷新、导航、多窗口和重启后的恢复行为。
- 已经可以解除 BackdropBuddy 接入向导中的 Kimi 限制。
- 已经具备普通启动时的持久接入能力。

### 0.3 执行交付物

执行者应返回：

- 最终分类，见第 10 节。
- 实际应用版本、端口、进程归属和目标页面摘要。
- 只读 DOM 指纹摘要。
- 清理与恢复正常启动的结果。
- 失败时的准确阶段和原始错误信息；不要只写“无法接入”。

证据建议保存在工作区的 `.kimi-work/kimi-cdp-probe/` 下。证据不得包含聊天正文、Cookie、令牌、账号信息、localStorage 或带查询参数的完整网页地址。

## 1. 已完成的检查

以下事实来自 2026-10-26 对本机运行实例、实际设置页、官方资料和 BackdropBuddy 当前工作区的检查。

### 1.1 本机运行形态

- 主程序路径为 `C:\Users\dell\AppData\Local\Programs\Kimi\Kimi.exe`。
- 当时进程版本为 `3.2.20.18`。
- 应用具有 Chromium 风格的 GPU、renderer、utility 等多进程结构，并暴露 WebView 可访问性树。
- 当时所有 Kimi 主进程及子进程均未发现 `--remote-debugging-port`、`--remote-debugging-pipe` 或 `--inspect` 参数。
- 当时 Kimi 进程唯一的回环监听端口为 `59485`，归属 Agent 运行进程；对 `/json/version` 和 `/json/list` 的只读请求均返回 `404 Not Found`，因此它不是可用的 CDP 入口。

端口和进程状态是一次时点观察，后续执行必须重新读取，不能把 `59485` 写成固定配置。

### 1.2 实际外观设置

本机“设置 → 外观”页面只看到：

- 月之亮面、跟随系统、月之暗面。
- 字体大小、Language。
- 界面缩放。

未看到自定义图片、视频、壁纸或背景图上传入口。本次只进行了页面导航，没有更改任何外观选项。

### 1.3 主 Work 页面与其他页面必须区分

只读观察到的两个相关页面为：

- 主 Work 界面：`app://localhost/kimi-agent.html`，带有主题、语言和平台等启动查询参数。
- 设置界面：`https://www.kimi.com/settings/appearance`。

后续 CDP profile 应只匹配主 Work 页面，不应把设置页、右侧文件预览、内置浏览器、桌面宠物或其他 WebView 一并纳入。

### 1.4 官方插件与小组件不是已确认的主机换肤接口

官方“个人插件”资料描述的是工具、MCP、技能、外部服务和网页工作流，没有在本次查阅范围内找到宿主 UI 注入或背景主题 API。[Kimi 帮助中心](kimi-cite://web?url=https%3A%2F%2Fwww.kimi.com%2Fhelp%2Fplugins-and-skills%2Fcreate "citation")

官方“小组件与看板”用于展示交互页面和组织内容，不等于修改主 Work 窗口背景。[Kimi Work 概览](kimi-cite://web?url=https%3A%2F%2Fwww.kimi.com%2Fhelp%2Fkimi-work%2Foverview "citation")

因此，当前不能照搬 DSH 的 Host／Client 插件方案，也不能把 Kimi Code CLI 的 JSON 颜色主题误认为 Kimi Work 桌面背景接口。

### 1.5 BackdropBuddy 已有可复用条件

当前通用 profile 已支持程序路径、端口、页面匹配、根容器、透明表面、暗色标记和 blob 媒体投递等字段。[user-profiles](kimi-cite://md-line?path=F%3A%2Fworkspace%2FAI-Project%2Frea-project%2FBackdropBuddy%2Fkernel%2Fhost%2Fuser-profiles.mjs&line=112 "citation")

现有检测器通过 `/json/version`、`/json/list`、页面目标和页面指纹判断宿主是否就绪。[detect](kimi-cite://md-line?path=F%3A%2Fworkspace%2FAI-Project%2Frea-project%2FBackdropBuddy%2Fkernel%2Fhost%2Fdetect.mjs&line=228 "citation")

但当前接入向导会直接拦截 `kimi.exe`。其中“已禁用远程调试”的文字目前超出了证据：已证明的是“当前实例未开放 CDP”，尚未证明“带参数重启也无效”。[HostWizard](kimi-cite://md-line?path=F%3A%2Fworkspace%2FAI-Project%2Frea-project%2FBackdropBuddy%2Fui%2Fsrc%2Fcomponents%2FHostWizard.jsx&line=121 "citation")

## 2. 当前结论与执行顺序

当前最合理的顺序是：

1. 由其他应用执行一次受控重启和只读 CDP 探针。
2. 若探针通过，先保存页面、选择器、变量和导航稳定性证据。
3. 再单独评审一次可逆静态背景实验。
4. 静态背景成功后，才考虑 Kimi profile、向导限制调整和视频能力。

不建议：

- 把 DSH 配套插件架构直接复制到 Kimi Work。
- 首次实验就修改 Kimi 安装资源或应用包。
- 首次实验就注入全屏图片、视频或大片透明样式。
- 把一次失败写成“所有版本永远不支持”。

## 3. 安全条件与停止条件

### 3.1 重启前必须满足

- 用户已明确安排由其他应用执行本次重启。
- 已确认没有未发送的输入、未保存的编辑、正在运行的 Agent 任务、远程控制或文件写入。
- 已确认定时任务和后台任务不会因本次重启产生不可接受的影响。
- 当前执行者不依赖这个 Kimi Work 会话继续工作。

无法确认上述状态时，不要重启。

### 3.2 全程禁止

- 不使用 `0.0.0.0`、局域网地址或公网地址开放 CDP。
- 不做端口转发，不修改防火墙，不共享调试端口。
- 不添加 `--no-sandbox`、`--disable-web-security` 或独立 `--user-data-dir`。
- 不读取 Cookie、localStorage、会话令牌、账号信息或聊天正文。
- 不修改 Kimi 设置、安装文件、缓存或用户数据。
- 不默认使用 `Stop-Process -Force`、`taskkill /F` 或其他强制终止方式。
- 不在失败时连续重启或无限重试。

CDP 能控制已登录页面。调试端口只能短暂存在，完成探测后必须关闭。

### 3.3 任一出现即停止

- 端口监听在非回环地址。
- 端口归属其他程序，或无法核实归属。
- 需要强制结束进程才能继续。
- 应用提示存在未完成任务或未保存内容。
- 应用异常退出、反复崩溃或出现账号异常。
- 执行步骤将超出只读范围。

停止后进入第 11 节恢复流程，并如实记录，不继续“尝试别的注入办法”。

## 4. 预检与变量

以下命令以 PowerShell 为例，工作目录必须是：

```text
F:\workspace\AI-Project\rea-project\BackdropBuddy
```

建议变量：

```powershell
$workspace = 'F:\workspace\AI-Project\rea-project\BackdropBuddy'
$kimiExe = 'C:\Users\dell\AppData\Local\Programs\Kimi\Kimi.exe'
$port = 9333
$evidence = Join-Path $workspace '.kimi-work\kimi-cdp-probe'

Set-Location $workspace
New-Item -ItemType Directory -Force -Path $evidence | Out-Null

if (-not (Test-Path -LiteralPath $kimiExe -PathType Leaf)) {
  throw "未找到 Kimi.exe：$kimiExe"
}

(Get-Item -LiteralPath $kimiExe).VersionInfo.ProductVersion
```

`9333` 只是本次手册的示例端口，不应写成永久固定值。

检查端口是否已被占用：

```powershell
$existing = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
if ($existing.Count) {
  $existing | Select-Object LocalAddress, LocalPort, OwningProcess
  throw "端口 $port 已占用；不要结束其他进程，请停止或另选空闲端口并同步更新所有命令。"
}
```

记录当前进程时，只保存 PID、父 PID、程序路径、版本和调试相关参数。不要把完整命令行原样写入证据，因为其中可能包含无关路径或敏感参数。

## 5. 正常退出并带临时 CDP 启动

### 5.1 正常退出

1. 通过应用自身界面关闭所有 Kimi Work 窗口。
2. 从托盘或应用菜单选择正常“退出”。
3. 在有界时间内等待进程退出，建议最多等待 20 秒。
4. 如果仍有 Kimi 进程或退出确认对话框，读取原因；不要默认强制结束。

可使用以下命令观察是否仍有进程：

```powershell
Get-Process -Name Kimi -ErrorAction SilentlyContinue |
  Select-Object Id, ProcessName, MainWindowTitle, ProductVersion
```

仅仅还有进程不代表可以强制结束。若无法正常退出，停止并报告。

### 5.2 临时启动

确认所有相关主进程已经正常退出后，执行：

```powershell
$launched = Start-Process -FilePath $kimiExe -ArgumentList @(
  '--remote-debugging-address=127.0.0.1',
  "--remote-debugging-port=$port"
) -PassThru
```

`$launched.Id` 只代表启动器返回的 PID。Electron 风格应用可能继续创建或替换进程，因此后续必须重新读取实际进程和端口归属，不能假定该 PID 就是最终主进程。

最多等待 30 秒，每秒检查一次端口。不要反复执行启动命令。

## 6. 验证端口安全与归属

读取监听信息：

```powershell
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)
$listeners | Select-Object LocalAddress, LocalPort, OwningProcess
```

### 6.1 没有监听

若约 30 秒后仍无监听：

- 记录为 `CDP_NOT_OPEN`。
- 保存实际启动参数、版本和进程状态摘要。
- 不连续换端口重启；端口未开放不是端口冲突的证据。
- 进入恢复流程。

### 6.2 有监听

必须同时满足：

1. `LocalAddress` 是 `127.0.0.1` 或 `::1`。
2. `OwningProcess` 对应 `Kimi.exe`，并能纳入本次启动的进程树。
3. 不是其他程序此前占用的端口。

读取进程归属：

```powershell
$owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
Get-CimInstance Win32_Process |
  Where-Object { $owners -contains $_.ProcessId } |
  Select-Object ProcessId, ParentProcessId, ExecutablePath
```

如果是 `0.0.0.0`、`::`、其他程序或归属不明，分类为 `UNSAFE_OR_FOREIGN_PORT`，不要请求 CDP HTTP 接口，立即进入恢复流程。

## 7. 只读枚举 CDP 目标

仅在第 6 节通过后执行：

```powershell
$cdpBase = "http://127.0.0.1:$port"
$version = Invoke-RestMethod -Uri "$cdpBase/json/version" -Method Get -TimeoutSec 3
$targets = @(Invoke-RestMethod -Uri "$cdpBase/json/list" -Method Get -TimeoutSec 3)
```

预期：

- `/json/version` 能返回浏览器信息。
- `/json/list` 能返回页面目标数组。

选择主 Work 页面：

```powershell
$mainTargets = @($targets | Where-Object {
  $_.type -eq 'page' -and
  $_.url -match '^app://localhost/kimi-agent\.html(?:[?#]|$)'
})
```

规则：

- 只选择 `type = page`。
- 只选择主 Work 的 `app://localhost/kimi-agent.html`。
- 不选择 `https://www.kimi.com/settings...`。
- 不选择文件预览、内置浏览器、桌面宠物、worker、service worker 或 DevTools 页面。
- 有多个主 Work 目标时全部记录，不能任意丢掉其他窗口。

如果没有主目标，分类为 `CDP_OPEN_NO_MAIN_TARGET`。可以保存脱敏后的目标摘要，但不要改用设置页或其他页面凑数。

### 7.1 目标证据脱敏

证据中建议只保留：

- `id`、`type`。
- 去除查询参数和片段后的 URL。
- 是否存在 `webSocketDebuggerUrl`。
- 是否为候选主目标。

不要默认保存完整 `title`、完整 URL、页面 HTML 或聊天内容。`webSocketDebuggerUrl` 可供本次内存连接使用，不必写入报告。

## 8. 只读 DOM 与计算样式探针

### 8.1 连接要求

对每个 `$mainTargets`：

1. 确认存在 `webSocketDebuggerUrl`。
2. 确认 WebSocket 地址仍为回环地址。
3. 使用 CDP `Runtime.evaluate` 执行下面的纯只读表达式。
4. 连接完成后关闭 WebSocket。

可在项目现有可运行 Node 环境中复用 `kernel/host/detect.mjs` 的 `CdpSession.open()`。如果环境不具备所需 WebSocket 能力，记录环境错误；不要为了本次探针临时安装依赖或修改项目。

### 8.2 允许执行的表达式

```js
(() => {
  const selectors = [
    '#root', '#app', '.app', '.main', '.main-pane',
    '.conversation-view', '.conv-main', '.message-list',
    '.composer-dock', '.right-rail-slot'
  ];

  const summarize = (el) => {
    if (!el) return null;
    const style = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: String(el.className || '').slice(0, 240),
      role: el.getAttribute('role'),
      position: style.position,
      zIndex: style.zIndex,
      backgroundColor: style.backgroundColor,
      backgroundImage: style.backgroundImage === 'none' ? 'none' : '<present>',
      color: style.color
    };
  };

  const rootStyle = getComputedStyle(document.documentElement);
  const variables = [];
  for (let index = 0; index < rootStyle.length && variables.length < 80; index += 1) {
    const name = rootStyle[index];
    if (!/^--/.test(name) || !/bg|background|surface|panel|sidebar|text|foreground|border/i.test(name)) continue;
    const raw = rootStyle.getPropertyValue(name).trim();
    variables.push({
      name,
      value: /url\(/i.test(raw) ? '<url>' : raw.slice(0, 120)
    });
  }

  return {
    href: `${location.protocol}//${location.host}${location.pathname}`,
    readyState: document.readyState,
    themeQuery: new URL(location.href).searchParams.get('theme'),
    htmlClass: String(document.documentElement.className || '').slice(0, 240),
    bodyClass: document.body ? String(document.body.className || '').slice(0, 240) : null,
    htmlDataTheme: document.documentElement.getAttribute('data-theme'),
    bodyDataTheme: document.body ? document.body.getAttribute('data-theme') : null,
    hasBody: !!document.body,
    bodyChildren: document.body ? document.body.children.length : 0,
    elements: Object.fromEntries(selectors.map((selector) => [
      selector,
      summarize(document.querySelector(selector))
    ])),
    variables
  };
})()
```

该表达式只查询元素和读取样式，不创建、修改或删除 DOM，也不读取文本内容、存储或凭据。

### 8.3 通过条件

- WebSocket 能连接并完成求值。
- 没有 `exceptionDetails`。
- `readyState` 最好为 `complete`；若仍在加载，记录并等待一次有界重读。
- `hasBody = true`。
- 能取得候选容器或变量信息。

`.app`、`.main-pane` 等只是候选锚点，不要求全部存在。缺少某个类名不等于失败；应保存实际结果，后续再决定稳定选择器。

如果求值失败，分类为 `CDP_EVAL_FAILED`，记录错误，不执行任何修正性注入。

## 9. 补充只读稳定性检查

核心探针通过后，可做一轮普通界面导航：

1. Work → Chat → Work。
2. 打开设置，再返回。
3. 打开或关闭一个右侧预览；若没有现成预览，不为此额外创建文件。
4. 不点击任何主题、语言、缩放或账号设置。

每次导航后重新读取 `/json/list` 和主目标指纹，记录：

- 目标 ID 是否变化。
- 主页面 URL 是否变化。
- `readyState` 是否重新经历加载。
- 候选容器是否仍存在。
- 是否出现多个主 Work 页面。

本步骤只用于判断未来 adapter 是否需要处理重载、重新注入和多窗口，不得在页面中预先放置测试样式来“验证持久化”。

## 10. 结果分类

| 分类 | 判定 | 下一步 |
| --- | --- | --- |
| `READY_FOR_STATIC_PROBE` | 端口安全、归属明确、主目标存在、只读求值成功，且已恢复正常启动 | 单独评审可逆静态背景实验；仍不代表已支持背景 |
| `CDP_NOT_OPEN` | 带参数正常重启后仍无调试监听 | 不进入注入；保留证据，评估非 CDP 路线 |
| `CDP_OPEN_NO_MAIN_TARGET` | CDP HTTP 可用，但没有主 Work 页面目标 | 检查目标枚举和页面形态，不改选其他页面 |
| `CDP_EVAL_FAILED` | 主目标存在，但 WebSocket 或只读求值失败 | 记录准确错误，不做修正性注入 |
| `UNSAFE_OR_FOREIGN_PORT` | 非回环、其他程序占用或归属不明 | 立即停止并恢复，不连接该端口 |
| `INCONCLUSIVE` | 进程退出、导航、证据或清理不完整 | 不作支持或不支持的结论 |

报告时必须同时给出“探测结果”和“清理结果”。探针成功但恢复未完成，不能写成整个任务成功。

## 11. 恢复正常启动

无论成功或失败，都执行：

1. 通过应用自身界面正常退出带调试参数的 Kimi Work。
2. 不删除用户数据，不清理缓存，不修改设置。
3. 确认临时端口不再监听。
4. 不带任何调试参数正常启动 Kimi Work：

```powershell
Start-Process -FilePath $kimiExe
```

5. 确认应用能够正常进入主界面。
6. 再次检查进程，不应存在 `--remote-debugging-port` 或 `--remote-debugging-address`。
7. 记录最终端口和进程状态。

如果正常启动失败，停止实验并报告。不要通过删除配置、重装或清理账号数据来“修复”。

## 12. 探针通过后的推荐路线

以下不属于本手册的自动执行范围。

### 12.1 先做独立静态实验

单独获得执行确认后，按以下顺序验证：

1. 临时、可移除的静态色块或背景层。
2. 点击、输入、滚动和拖窗是否受影响。
3. 文字对比度、侧栏和聊天气泡可读性。
4. 移除后是否恢复原貌。
5. 再测试一张静态图片及其 CSP／媒体投递方式。
6. 最后才评估视频、暂停和性能。

每一步都需要真实 DOM／计算样式或媒体状态验证，不能把 `Runtime.evaluate` 调用完成当作视觉成功。

### 12.2 再形成 Kimi profile

优先根据实测数据建立用户 profile，而不是立即内置：

- `exe`：重新确认的实际程序路径。
- `port`：受控调试端口。
- `rendererPattern`：只匹配主 Work 页面。
- `readySelector`、`rootSelector`、`surfaceSelectors`：来自实际 DOM 证据。
- `darkAttr`／`darkClass`：来自实际明暗模式观察，不只依赖启动 URL 的 `theme` 查询参数。
- `mediaDelivery`：根据 CSP 实验决定，不能把 blob 当成已验证结论。

只有证据充分后，才评审是否调整接入向导中对 `kimi.exe` 的硬拦截和“已禁用远程调试”文案。

### 12.3 普通启动仍需解决

即使 CDP 实验成功，普通启动默认仍可能没有调试端口。正式产品化还需要评审：

- 是否由 BackdropBuddy 提供受控启动入口。
- 如何检测并提示“当前运行但未开调试”。
- 如何限定回环地址、校验端口归属并避免与现有实例冲突。
- 如何避免把临时调试端口变成长期不必要的暴露面。

## 13. 失败后的边界

若带参数重启仍无法取得安全、可用的 CDP：

- 不直接改写 Kimi 安装包或内置资源。
- 不把 Agent 运行时的本地控制端口当成未公开换肤 API。
- 不把小组件、技能或功能插件当成主窗口背景能力。
- 可另行评估网页版浏览器扩展或向官方提出主题接口需求，但它们不再是“当前 Kimi Work 桌面主界面”的同一路线。

失败应缩小结论范围，例如“本机 `3.2.20.18` 按本手册启动后未开放 CDP”，不要写成“所有 Kimi 版本永远无法支持”。

## 14. 执行结果模板

```yaml
executedAt:
executor:
appVersion:
executablePath:
temporaryPort:
gracefulShutdownConfirmed: false
noActiveTasksConfirmed: false
portListening: false
loopbackOnly: false
portOwnerPid:
portOwnerExecutable:
cdpVersionRead: false
mainTargetCount: 0
mainTargetUrls: []
webSocketConnected: false
domEvaluationSucceeded: false
readyState:
bodyPresent: false
navigationRecheck: not-run
result: INCONCLUSIVE
errorStage:
errorMessage:
normalRestartCompleted: false
temporaryPortClosed: false
debugFlagsRemoved: false
evidenceFiles: []
notes:
```

执行者应保留失败阶段和准确错误，不删除失败证据，也不把未执行项目写成成功。
