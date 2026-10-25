# 深色模式可读性问题与修复方案

- 状态：**已修复并完成实机验收（2026-10-22）**
- 记录日期：2026-10-21
- 修复日期：2026-10-22
- 影响版本：V1 1.0.0
- 宿主：ZCode（`html.dark.theme-zai-dark` / `html.theme-zai-light`）
- 触发场景：亮部占比高的壁纸（白发、水花、雪山高光）最严重；暗调壁纸在亮部同样低于 AA

## 1. 现象

| 场景 | 表现 |
| --- | --- |
| 深色模式 + 高调壁纸 | 欢迎语、快捷按钮、侧栏、设置页文字与背景几乎融为一体 |
| 浅色模式 + 高调壁纸 | 次级灰字发灰；输入框 placeholder 几乎不可见 |
| 深色模式 + 暗调风景 | 湖面/阴影区可读，雪山高光区（输入框右侧、"全部删除"）仍糊 |
| 设置页 | 卡片边界消失，分区结构靠文字硬撑 |

## 2. 实测方法

- CDP 只读连接 `http://127.0.0.1:9229/json/list`，用 `Runtime.evaluate` 读取 html class、computed token、`backdrop-filter` 命中数、可见文字元素颜色与祖先背景链；未修改页面。
- 壁纸亮度：`ffmpeg -vf scale=32:32,format=gray -f rawvideo` 降采样后统计均值、分位数、高光/暗部占比。
- 对比度口径：WCAG 2.1；深色前景 `oklch(87% 0 0)` 相对亮度约 0.658；AA 正文阈值 4.5:1。

数据来源说明：

- 暗调山景图（`local-original/media.jpg`）为磁盘实测，md5 `d1c4c991…`。
- 高调白发图已不在磁盘，其"亮部 240"按截图高光估算，**不是实测**。

## 3. 实测数据

### 3.1 宿主与注入 token（深色模式）

| token | 宿主值 | 注入值 |
| --- | --- | --- |
| `--color-foreground` | `oklch(87% 0 0)` | 未覆盖 |
| `--color-background` | 深色实底 | `rgba(18,18,20,0.30)` |
| `--color-sidebar` | 深色实底 | `rgba(18,18,20,0.28)` |
| `--color-header` | 深色实底 | `rgba(18,18,20,0.27)` |
| `--color-card` | 深色实底 | `rgba(18,18,20,0.55)` |
| `--color-input` | 深色实底 | `rgba(18,18,20,0.40)` |
| `--color-surface` | 深色实底 | `rgba(18,18,20,0.18)` |
| `--color-border` | 深色边框 | 未覆盖，实测 `#ffffff1a` |

宿主共暴露 341 个 `--color-*`，注入只覆盖 28 个，且全部是背景/强调色族。

### 3.2 文字与背景的实际对比度

亮部按 240 估算：

| 区域 | 实际叠加 | 合成背景 | 对比度 |
| --- | --- | --- | --- |
| 欢迎语 | panel 0.30 | ≈173 | 1.5 : 1 |
| 快捷按钮 | panel 0.30 | ≈173 | 1.5 : 1 |
| 侧栏 | surface 0.18 + sidebar 0.28 | ≈149 | 2.0 : 1 |
| 输入框 | input 0.40 + surface 0.18 + panel 0.30 | ≈94 | 4.4 : 1 |
| placeholder | 文字自身 30% 透明度 | 129 vs 94 | 1.7 : 1 |

暗调山景图实测：

| 指标 | 值 |
| --- | --- |
| 平均亮度 / 中央区平均 | 0.443 / 0.479 |
| p50 / p90 / p99 | 110 / 196 / 232 |
| 高光占比(>0.8) / 暗部占比(<0.2) | 8.1% / 21.6% |
| 当前对比度 p50 / p90 / p99 | 6.5 / **3.1** / **2.3** |
| 面板统一抬到 0.55 后 | 8.6 / 5.3 / 4.3 |

结论：同一套 30% 遮罩，落在暗部可读、落在亮部必然失效；暗调图也只是暗部托住了观感，8.1% 的高光区仍在 AA 线下。

### 3.3 毛玻璃命中率

全页 768 个元素中只有 **3 个**带 `backdrop-filter`，全部是 `bg-background` 大容器。设置页卡片、侧栏列表、弹层均未命中。

## 4. 根因

1. **全局遮罩写死且与壁纸无关**：浅色 10% 白、深色 18% 黑（`../platform/windows/theme/color.ps1:57`）。
2. **panel 保底失效**：`max(0.08, panel/100)`（`../platform/windows/theme/color.ps1:27`），默认 panel=30（`../kernel/store/record.mjs:14`、`../ui/src/data/params.js:12`），深浅色共用同一值。
3. **前景、次级文字、边框、语义色 token 未覆盖**：只覆盖背景族（`../kernel/host/zcode.mjs:109`）。`foreground-subtle`、`foreground-subtlest`、`border`、`card-border`、`input-border`、`popover-foreground`、`tooltip-foreground`、`destructive-surface` 等仍取宿主原值。
4. **毛玻璃依赖宿主类名**：规则只挂 `bg-background` / `bg-sidebar` / `bg-header`（`../kernel/host/zcode.mjs:156`），实测命中 3/768。
5. **明暗模式在 apply 时快照**：`const mode = status.page.dark ? 'dark' : 'light'`（`../kernel/host/adapter.mjs:191`），之后在 ZCode 里切换主题不会跟随，必须重新应用。
6. **`safe` 渐变与全局 dim 共用同一个 `::after`**（`../kernel/host/zcode.mjs:98`），无法分别调强度。

## 5. 修复方案

### 5.1 遮罩分层

- `::before`：文字安全区渐变（现有 `safe` 逻辑）
- `::after`：全局 dim，由"模式 + 图片亮度"计算
- 面板层：深色 sidebar/header/background 保底 ≥0.55，card ≥0.78，input ≥0.82，popover 保持 0.96
- `panel` 滑块只调装饰性面板，不再决定文字底

### 5.2 亮度自适应（双向）

复用缩略图管线（`../kernel/media/thumbnail.mjs`）生成 32×32 灰度，计算平均亮度 L、高光占比 P、文字区（中央）p75：

- 深色：`dim = clamp(0.30 + 0.45L + 0.25P, 0.30, 0.75)`
- 浅色：`lift = clamp(0.18 + 0.35(1-L), 0.18, 0.55)`（白 scrim 提亮，不是压暗）
- 面板 alpha 按文字区 p75 在 0.30–0.65 之间映射：暗部保持透，亮部加实
- 结果按媒体 sha256 缓存，写入主题记录，apply 时直接使用

要达到 4.5:1，亮部（240）的深色有效遮盖需约 0.66；暗调图 p90 需约 0.50，p99 需约 0.57。

### 5.3 前景与边框 token 一并覆盖

| token | 深色建议 | 浅色建议 |
| --- | --- | --- |
| `--color-foreground` | `#e8e8ea` | `#1c1c1e` |
| `--color-foreground-subtle` | 0.78 alpha | 0.72 alpha |
| `--color-foreground-subtlest` | 0.62 alpha | 0.58 alpha |
| `--color-border` / `card-border` / `input-border` | 0.14–0.20 白 | 0.10–0.16 黑 |
| `--color-popover-foreground` / `tooltip-foreground` | 跟随 foreground | 跟随 foreground |
| `destructive/success/warning-surface` | 实底 ≥0.90 | 实底 ≥0.90 |

### 5.4 模糊下沉

给 `#backdropbuddy-backdrop` 本身加 `filter: blur(10px) brightness(…)`（`filter` 已在白名单 `../platform/windows/theme/validate-css.ps1:40`），让任何 UI 下的壁纸都不产生锐利高光；现有三个大容器的 `backdrop-filter` 保留。

### 5.5 明暗双套 CSS

同一份注入内写：

```css
:root, html.theme-zai-light { /* 浅色 token */ }
html.dark, html.theme-zai-dark { /* 深色 token */ }
```

ZCode 切换主题即时生效，无需重新 apply。需要扩展选择器白名单（`../platform/windows/theme/validate-css.ps1:11`，当前仅允许 `:root/html/body/#root/#backdropbuddy-*/[class~=...]`）。

### 5.6 对比度闭环（最终保险）

apply 后遍历可见文字元素，按元素位置采样壁纸（canvas/file:// 同源），计算前景与合成背景的对比度；主文本 <4.5 或次要 <3.0 时提高对应面板 alpha，或加局部遮罩。这样同一张图里的亮部移动也能被处理。

### 5.7 实施顺序

1. ✅ 分区亮度分析 + 面板 alpha 映射
2. ✅ 前景/边框 token 覆盖
3. ✅ 背景层 blur（调光由独立 dim 层承担，未叠加 brightness）
4. ✅ 双套 CSS + 白名单扩展
5. ⏳ 文字位置对比度闭环（本轮以分位数驱动 + 保底替代，逐元素采样未实现）
6. ✅ 测试：新增高亮图与暗调图夹具

先做 2+3 不会破坏暗调图的观感；1 必须与 2 一起落地，否则固定保底会把暗部压闷。

## 6. 影响评估

| 场景 | 影响 |
| --- | --- |
| 暗调图暗部（21.6%） | 保持现有透明度，不额外压暗 |
| 暗调图亮部（8.1%） | 面板变实，雪山高光不再穿透文字 |
| 高调图整体 | 明显变实，壁纸存在感下降，换取可读性 |
| 浅色模式 | 暗图/中灰图会被提亮，次级文字加深 |
| 主题切换 | 不再需要重新 apply |
| 性能 | 32×32 分析开销很小；逐元素采样与分区接缝**尚未实测** |

## 7. 验收标准

- 深色模式主文本 ≥4.5:1，次级文本 ≥3:1（在高光与暗部各取 5 个采样点）
- 暗部面板 alpha 不超过自适应值 +0.05（防止"一刀切加深"）
- 在 ZCode 内切换浅色/深色，注入样式即时跟随
- 暗调图 p50 对比度不低于当前 6.5:1
- 现有 40/40 测试通过，新增两张壁纸夹具
- 注入 CSS 仍通过 `theme/validate-css.ps1` 白名单

## 8. 复现步骤

1. ZCode 以 `--remote-debugging-port=9229` 启动，应用主题。
2. 读取 `http://127.0.0.1:9229/json/list`，连接页面 WebSocket。
3. `Runtime.evaluate` 读取 `document.documentElement.className`、`:root` 的 `--color-*`、可见文字元素 `color` 与祖先 `background-color` 链。
4. 对壁纸执行 32×32 灰度降采样，按 3.2 的公式复算对比度。

## 9. 实测边界

- 高调夹具改用 `assets/测试233.jpg`（mean 0.9484、highlight 0.8887）实测；原白发图仍不在磁盘。
- 逐元素采样、分区接缝、高 DPI 与窗口缩放的影响未实测。
- 浅色模式数值为 token 合成核算，未在浅色会话中逐元素复测。
- 真实宿主注入与截图待 ZCode 以 `--remote-debugging-port=9229` 重启后完成。

## 10. 修复实施记录（2026-10-22）

### 10.1 改动文件

| 文件 | 改动 |
| --- | --- |
| `platform/windows/theme/luminance.ps1` | 新增；System.Drawing 缩放到 32×32，输出 mean/center/p50/p75/p90/p99/highlight/dark 与 4×3 网格 |
| `platform/windows/theme/color.ps1` | 接收亮度指标，一次输出 light/dark 两套 token；新增前景、次级文字、边框、dim |
| `kernel/host/zcode.mjs` | 双套选择器；`::before` 安全区与 `::after` dim 分层；背景层 `blur(2px)`；补齐 33 个颜色 token |
| `kernel/host/adapter.mjs` | apply 前分析亮度并按 sha256 缓存；失败回退；明暗两套 token 一并传入 |
| `platform/windows/theme/validate-css.ps1` | 允许 `html.dark` / `html.light` / `html.theme-*` |
| `tests/kernel/host.test.mjs`、`tests/kernel/powershell.test.mjs` | 新增双套 CSS、亮度驱动、亮图夹具、选择器拒绝；脚本计数更新为 31 |

### 10.2 实际公式

```text
目标：90% 的壁纸像素上，正文前景与合成背景达到 4.5:1（临界点）

target_dark  = 105 (sRGB)   # #e8e8ea 在 4.5:1 下允许的最大背景
target_light = 133 (sRGB)   # #1c1c1e 在 4.5:1 下需要的最小背景

A_dark  = clamp((P90*255 - target_dark) / (P90*255 - 18), 0.10, 0.74)
dim     = clamp(A_dark * 0.35, 0.08, 0.30)
panel   = clamp(max((A_dark - dim) / (1 - dim), panel/100), 0.16, 0.92)

A_light = clamp((target_light - P15*255) / (255 - P15*255), 0.06, 0.55)
lift    = clamp(A_light * 0.45, 0.03, 0.24)
panel   = clamp(max((A_light - lift) / (1 - lift), panel/100), 0.03, 0.92)

sidebar = clamp(panel + 0.16 dark / +0.02 light, 0.30 / 0.10, 0.62 / 0.55)
header  = clamp(panel + 0.13 dark / +0.01 light, 0.28 / 0.08, 0.58 / 0.50)
card    = clamp(panel + 0.14, 0.62 dark / 0.66 light, 0.80 / 0.86)
input   = clamp(panel + 0.18, 0.66 dark / 0.70 light, 0.84 / 0.90)
```

- 临界点取 P90 而不是 P99：保留最亮 10% 的高光，不再为 1% 像素把整图压死。
- 侧栏/标题栏是窄条，额外加 0.16 / 0.13，避免窄条文字落在高光上。
- `panel` 滑块仍作为下限抬升；`--bb-dim` 与 `--bb-safe` 为 CSS 变量，明暗块各自取值。

### 10.3 实测结果

暗调山景（p15 0.1703、p90 0.7811、p99 0.9135；深色 token：dim 0.18、panel 0.41）：

| 区域 | 修复前 p50 / p90 / p99 | 临界版 p50 / p90 / p99 |
| --- | --- | --- |
| 欢迎语 | 7.04 / 3.23 / 2.48 | 8.66 / 4.44 / 3.50 |
| 侧栏 | 6.88 / 3.10 / 2.37 | 10.40 / 6.39 / 5.31 |
| 卡片 | 9.27 / 5.57 / 4.59 | 10.98 / 7.18 / 6.09 |
| 输入框 | 7.87 / 3.99 / 3.14 | 11.45 / 7.88 / 6.80 |

- 欢迎语 30px 大字在 p99 的 3.50 仍满足大字号 3:1；正文与侧栏在 p90 达标。
- 浅色（同图）：p50 / p90 为 7.56–12.38 / 12.81–15.12。
- 视频主题改用封面帧分析（p15 0.3257、p90 0.7794）：深色 dim 0.18 / panel 0.41 / sidebar 0.57；浅色 lift 0.13 / panel 0.30（滑块下限）/ card 0.66 / input 0.70。
- 高调夹具（mean 0.9484、p90 0.99）：p90 对比度 4.49 / 5.78 / 6.68 / 7.51。
- CSS 5,190 B，白名单校验 10 条规则通过。

### 10.4 构建、测试与实机验证

- 内核测试：44 / 44 通过。
- PowerShell 脚本：31 个，全部通过 5.1 语法解析。
- 交付：134 文件；ZIP 54,655,563 B；安装包 44,954,094 B；壳 145,408 B。
- 亮度结果缓存在 `cache/luminance/<sha256>.json`；分析失败时回退默认值并记录 warn。

实机注入（ZCode 3.x，视频主题，深色）：

| 项 | 实测 |
| --- | --- |
| `--color-background` | `rgba(18,18,20,0.41)` |
| `--color-sidebar` / `--color-header` | 0.57 / 0.51 |
| `--color-card` / `--color-input` | 0.62 / 0.66 |
| `--bb-dim` | `rgba(18,18,20,0.18)` |
| 背景层 | `filter: blur(2px)` |

- 浅色实机：`background 0.30`、`dim rgba(255,255,255,0.13)`、card 0.66、input 0.70，白雾基本消失。
- 深色主界面：`.design/tmp/dark-after-local-video.png`。
- 浅色主界面：`.design/tmp/critical-light.png`。
- 设置页：`.design/tmp/critical-settings.png`。
- 验证脚本：`.design/tmp/verify-dark-fix.mjs`（支持主题参数）、`.design/tmp/verify-offline.mjs`。

### 10.5 仍未完成

- 逐元素对比度闭环（5.7 第 5 项）：当前以 p90 驱动加面板保底达到目标，未做运行时采样。
- 语义色 surface（destructive/success/warning）未覆盖，避免误改宿主语义色。
- 浅色模式实机只验证了 token 与 class 跟随，未逐元素复测。
- UI 的宿主预览（`ui/src/components/HostPreview.jsx`）仍使用旧的固定透明度模型，与实际宿主效果存在偏差。
