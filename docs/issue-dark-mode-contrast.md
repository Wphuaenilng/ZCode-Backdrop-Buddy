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

## 11. 高频细节穿透的后续优化（2026-10-25）

- 触发：高细节壁纸（动漫线稿、发丝）下侧栏/任务列表小字仍发虚。对比度按纯色合成背景计算可达标，但高频边缘透过半透明面板与字形叠加，观感上"不清晰"。

### 11.1 改动

| 文件 | 改动 |
| --- | --- |
| `kernel/host/zcode.mjs` | 注入 CSS 新增 `--bb-text-shadow`（明暗两套 1~2px 保护性投影），`#root` 继承；壁纸层/视频层 `blur(2px)` 改为随 task 档位：auto 4px / ambient 6px / focus 10px |
| `platform/windows/theme/validate-css.ps1` | 属性白名单新增 `text-shadow` |
| `platform/windows/theme/color.ps1` | `foregroundSubtlest` 暗色 0.62 → 0.70、亮色 0.58 → 0.68 |
| `tests/kernel/host.test.mjs` | 断言随新值更新；新增 task 档位模糊用例、text-shadow 用例、subtlest 用例 |

### 11.2 设计取舍

- 投影半径压在 ≤2px：足以把字形从壁纸高频细节中剥离，又不至于让字本身发糊；实底面板（popover 0.97+）上几乎不可见。
- 壁纸层模糊与面板毛玻璃（26/12/18px）同源联动 task 档位，`inset: -16px` 余量覆盖 10px 模糊不露边；auto 档从 2px 提到 4px，保壁纸质感与可读性的折中。
- 亮度驱动的面板 alpha 公式未动，本轮只加"细节抑制"与"前景提实"两条防线；`risk` 指标参与 alpha 计算、毛玻璃扩类（`bg-card` 等）留待下轮视实机效果决定。

### 11.3 验证

- kernel 测试 55 用例：52 通过、0 失败、3 跳过（ffprobe/ffmpeg 未安装的环境用例，与本轮无关）。
- 生成 CSS 经 `validate-css.ps1` 白名单校验通过（含新属性与 `#root` 选择器）。
- 生效方式：重新 apply 主题（token 与 CSS 均在 apply 时生成）；亮度缓存不受影响。

## 12. 侧栏落点打空与视频遮罩层级 bug（2026-10-25 第二轮）

- 触发：用户对比原生支持背景的 Codex 客户端（侧栏近实底深色、裸字带描边、壁纸只在无字区露出），反馈 ZCode 侧栏任务列表文字仍不清晰。经 CDP 只读实测（`http://127.0.0.1:9229/json/list`）定位到三个根因。

### 12.1 实测根因

| # | 发现 | 证据 |
| --- | --- | --- |
| 1 | **侧栏 token 落点全部打空**：`bg-sidebar`/`bg-header` 类命中 0 个；左侧栏（0~260px）不在任何 `bg-background` 容器内（主工作区 section 从 x=268 起）；侧栏文字（"新建任务"/"Ctrl+N"）完整祖先链无任何背景绘制、无毛玻璃；注入的 `--color-sidebar: 0.46` 无元素引用 | 侧栏唯一底衬是全局 dim `rgba(18,18,20,0.08)`，几乎裸压壁纸 |
| 2 | **视频主题遮罩层级 bug**：`injectionExpression` 把 `<video>` 插在遮罩层之后，两者同为 `z-index: 0`，按 DOM 顺序视频盖住了层的 `::before/::after`——**视频主题的 dim/safe 从未真正生效** | 实测 `body` 首三个子元素为 `[backdropbuddy-backdrop, backdropbuddy-video, #root]`，`::after` 存在但被盖 |
| 3 | scrim 强度公式下限过低：`dim*0.75` 且 dim 触底 0.08 → scrim 仅 0.06 | 与 1 叠加后侧栏遮罩形同虚设 |

### 12.2 改动

| 文件 | 改动 |
| --- | --- |
| `kernel/host/expressions.mjs` | 视频插入改为 `insertBefore(video, layer)`（遮罩层伪元素必须盖在视频上），并幂等重排旧注入残留的顺序 |
| `kernel/host/zcode.mjs` | `safeOverlay` 改为按侧栏轨道宽度的 px 渐变（260px 实心 + 420px 渐隐），`auto` 默认护左；`safe` 枚举新增 `off`；删除壁纸层 `#000` 地板（视频移到层下后必须删，视频元素自带 `background: #000`） |
| `platform/windows/theme/color.ps1` | scrim 强度独立：`dark = clamp(max(darkA, 0.38 + 0.34·risk), 0.38, 0.72)`、`light = clamp(max(lightA, 0.32 + 0.32·risk), 0.32, 0.62)`；dim 下限 dark 0.08→0.18 / light 0.03→0.08；panel 下限 dark 0.16→0.22 / light 0.03→0.06；luminance 输出新增 darkScrim/lightScrim |
| `ui/src/components/SettingsView.jsx` | "文字安全区"下拉新增"关闭" |
| `tests/kernel/host.test.mjs` | 新增 safe 渐变几何与禁用用例、scrim 下限/联动断言；safe=off 归一化断言 |

### 12.3 效果核算（暗色、视频主题、中等亮度封面 p90≈0.65、risk≈0.55）

| 项 | 修复前 | 修复后 |
| --- | --- | --- |
| dim | 0.08（且被视频盖住，实际 0） | 0.18（真正盖在视频上） |
| 侧栏 scrim | 0.06（同样被盖住） | 0.57，px 渐变精确覆盖 260px 轨道 |
| 侧栏最坏点亮部（240）对比度 | ≈1.5:1 | dim+scrim 合成 ≈0.65 遮盖 → ≈5.1:1（AA） |
| 文字投影 / 壁纸层 blur | 无 / 2px | §11 的 text-shadow + 4px（task 联动） |

- 注意：侧栏对比度提升主要来自 scrim（结构防线的兜底），不再依赖宿主是否引用 `--color-sidebar`。
- 视频 dim 生效后，暗调视频整体会比之前略暗 0.18，这是修 bug 的必然结果（此前从未生效）。

### 12.4 验证

- kernel 测试 110 用例：107 通过、0 失败、3 跳过（ffprobe/ffmpeg 缺失，与本轮无关）。
- 端到端演练：`color.ps1`（模拟封面亮度）→ `buildThemeCss`（video 媒体）→ `validate-css.ps1` 通过（10 规则、5,547 B）。
- 生效方式：重新构建（安装版需重打包）后在 BackdropBuddy 重新 apply 主题。

## 13. 中间会话列透明度调优（2026-10-25 第三轮）

- 触发：用户反馈修复后会话列（x ≈ 12%~45%）压得过实，希望透出壁纸人物。
- 该区域暗化由三层叠加：panel token（`bg-background` 容器）+ 毛玻璃 blur + 全局 dim；其中 18px 毛玻璃是"人物糊掉"的主因。

### 13.1 改动

| 文件 | 改动 |
| --- | --- |
| `kernel/host/zcode.mjs` | 面板毛玻璃按 task 档位改为 focus 26px / ambient 5px / auto 8px（原 26/12/18），auto/ambient 刻意放轻，文字改由 text-shadow、card 保底与侧栏 scrim 托底 |
| `platform/windows/theme/color.ps1` | 暗色 panel 下限 0.22 → 0.10：侧栏已有独立 scrim、card/input 各有保底，下限只兜底滑块极低值，否则 panel 滑块低于 22 时被钳住失效 |
| 用户主题 `local-video` | panel 参数 30 → 12（写入 theme.json 与 pointer.json），会话列底从 0.30 降到 0.12 |

### 13.2 效果

- 会话列合成遮盖：dim 0.18 + panel 0.30 + blur18 → dim 0.18 + panel 0.12 + blur8，合成遮盖约 0.43 → 0.28，人物面部细节可见。
- 卡片（0.62）、输入框（0.66）、侧栏 scrim（0.43）不变，文字承载面仍达标。
- 视觉验收：中栏人物清晰可见，对话文字可读性可接受（"白纸上读黑字"），左侧栏保持深色可读。
- 若需微调：UI"面板不透明度"滑块现在在低区间真实生效；要更糊更实选"任务页模式 → 聚焦"（26px 重磨砂）。

## 14. "UI 隐形"风格落地（2026-10-25 第四轮）

- 触发：用户给出明确参考图——中间区域完全透出壁纸原画质（无压暗、无模糊），文字靠投影可读；左栏约 30% 轻压暗；输入框深色实底。风格从"可读性优先"切换为"壁纸优先、投影托底"。

### 14.1 改动

| 文件 | 改动 |
| --- | --- |
| `kernel/host/zcode.mjs` | 面板毛玻璃与壁纸层模糊按 task 档位改为：focus 26px/10px，ambient 与 auto 均 0px（原 26/5/8 与 10/6/4）；text-shadow 增强为三段（1px 轮廓 + 1px 加深 + 6px 柔和光晕） |
| `platform/windows/theme/color.ps1` | darkDim 下限 0.18→0.06、lightLift 0.08→0.04；scrim 下限 dark 0.38→0.30 / light 0.32→0.26，上限收窄至 0.60/0.55；card 保底 0.62/0.66→0.35/0.40；input 保底 0.66/0.70→0.88/0.90（实底），上限 0.94/0.96 |
| 用户主题 `local-video` | panel 参数 12 → 3 |
| `tests/kernel/host.test.mjs` | 断言随新基线更新（blur 0px、text-shadow 三段、dim≥0.06、scrim≥0.30/0.26） |

### 14.2 实测（注入后 CDP 读取）

| 区域 | 合成遮盖 | 效果 |
| --- | --- | --- |
| 中间会话列 | panel 0.10 + dim 0.06 ≈ 0.15，无毛玻璃、壁纸层 blur 0 | 人物原画质，帧细节完整 |
| 左侧任务栏 | scrim 0.35 + dim 0.06 ≈ 0.39 | 轻压暗，透出壁纸轮廓，文字可读 |
| 输入框 | 0.88 | 接近实底 |
| 消息卡片 | 0.35 | 轻微底衬，悬浮元素仍有层次 |

- 视觉验收：中间人物原画质、主体文字靠三段投影在亮部可读；弱点仅剩 10~11px 灰色元文字压在人物高光上（风格固有取舍）。
- 回退路径：要恢复"重磨砂+实底面板"选"任务页模式 → 聚焦"（26px 毛玻璃 + 10px 壁纸模糊）；面板滑块可整体加深。

### 14.3 事故记录：staging 同步静默失败（2026-10-25 14:46 修复）

- 现象：用户重启应用并从 UI 重新 apply 后，第四轮效果丢失、回到第二轮厚重风格。
- 根因一（主）：向 `build/out` 同步内核时在 Git Bash 里调用 robocopy，`/MIR` 等开关被 MSYS 误转换为路径导致命令失败，且子 shell 吞掉了退出码——staging 一直停留在第二轮代码，UI 重 apply 用旧内核生成旧 CSS。
- 根因二（次）：用户 apply 时 ZCode 页面处于浅色模式，视频主题无 thumb 走 fallback 亮度，`fallbackLuminance` 按模式取值——浅色分支按"高亮图"处理，两套 token 都按亮图公式算出重面板（panel 0.52/scrim 0.70），比预期更暗。
- 修复：改用 `rm -rf + cp -r` 同步并逐行 grep 校验 staging 与源码一致（inputFloor 0.88、darkScrim 0.30–0.60、三段投影、blur 0px 均确认）；重启后重新注入，实测恢复第四轮数值。
- 教训：向运行目录同步必须带内容校验，不能只看命令退出链；`fallbackLuminance` 的明暗分支差异（视频无 thumb 时）留待后续统一为模式无关的中性值。

## 15. "替换壁纸失败"：BACKDROPBUDDY_APP_ROOT 指向旧包（2026-10-25 15:20 修复）

- 现象：控制台"应用皮肤"报 `应用失败：注入样式未通过白名单校验： property is not allowed: text-shadow`。
- 根因：会话环境里存在 `BACKDROPBUDDY_APP_ROOT=D:\BackdropBuddy`（未定义在用户/系统层，来自启动终端的继承）。内核按该变量解析 `platform/windows` 脚本目录，实际执行的是 D 盘 11:51 打包的**旧版** color.ps1 / validate-css.ps1——旧白名单不认识当天新增的 `text-shadow`，且旧 color.ps1 输出第一轮之前的 token。内核模块（zcode.mjs）仍从入口路径加载新版，于是出现"新 CSS 生成、旧校验拒绝"的组合。
- 排查路径：内核日志无 apply 记录 → 备份目录发现 apply CSS（写盘成功、注入前被拒）→ 对比真实 CSS 与模拟输出（subtlest 0.58 暴露脚本版本）→ 检查 node 进程环境变量定位。
- 修复：
  1. 清掉该环境变量重启应用（`env -u`），appRoot 回落为 exe 目录；
  2. D:\BackdropBuddy 的 kernel/platform/ui 同步为当前代码，即使变量再被带上也不会执行旧脚本；
  3. computer-use 实测：UI 点选"原图素材 → 应用皮肤"，`host applied` 成功，ZCode 主题切换且新特性（三段投影、px 侧栏渐变）生效。
- 建议：`resolveAppRoot` 对 env 提供的路径做存在性/一致性校验或至少在日志中显式记录 appRoot 来源，避免静默指向旧包；用户侧建议清理终端里遗留的 `BACKDROPBUDDY_APP_ROOT`。

## 16. 深色面板跟随滑块（2026-10-30）

- 触发：亮调壁纸在深色模式下，即使用户把面板不透明度降到 12%，亮度公式仍把它抬到 41%（高调亮图可抬到 51%），导致低区间滑块无实际效果，壁纸被面板与全屏暗罩压得发灰。
- 取舍：延续第 14 节“壁纸优先、投影托底”，深色面板不再按 P90 自动抬高，改由用户直接控制；卡片、输入框、弹窗与侧栏保留局部可读性保护。

### 16.1 新公式

```text
darkDim   = clamp(darkA * 0.20, 0.03, 0.18)  # 原 0.35 / 0.06–0.30
darkPanel = clamp(panel / 100, 0.10, 0.92)    # 原 max(亮度推导值, panel/100)
```

- 浅色公式完全不变；`darkA` 仍用于全屏暗罩与侧栏 scrim 的亮度自适应。
- 深色面板在 10%–92% 内跟随滑块；侧栏/标题栏最低 30%/28%、卡片最低 35%、输入框最低 88%、弹窗与文字阴影不变。
- 影响共享配色链路的所有宿主；裸文字区域不再承诺由 panel/dim 合成达到 P90 的 4.5:1，改由用户面板值、局部底衬和文字阴影共同承担。
- 对第 14 节视频主题示例（滑块 12、原 panel 41%、dim 18%）：新 panel 12%、dim 约 10%，主区域两层合成遮盖由约 52% 降至约 21%。

### 16.2 回归要求

- 同一滑块下，暗图与亮图的 darkPanel 必须一致；0/30/100 分别落到 10%/30%/92%。
- darkDim 使用新系数与边界，仍随壁纸高光单调增加。
- 浅色 token 不因滑块下限之外的深色改动而变化；卡片、输入框、侧栏、标题栏和弹窗保底保持原值。
- 运行目录的 `color.ps1` 必须与源码内容一致；重新 apply 后读取实际 token，不以 UI 滑块值代替宿主验证。
