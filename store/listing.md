# 商店上架材料

Chrome Web Store 与 Edge Add-ons 共用以下文案。提交前把占位符换成实际内容。

## 基本信息

- 名称：人类打字模拟器 / Human Typer
- 短描述（≤132 字符，Chrome）：
  `在网页输入框里按设定节奏逐字输入文字。支持构思停顿、回改与断点续打，可写入普通输入框和 Google 文档。`
- 短描述（English，≤132 字符）：
  `Types text into web fields at a set rhythm, with composing pauses, revisions and resume. Works in plain fields and Google Docs.`
- 分类：生产工具 / Productivity
- 语言：简体中文、English（界面内一键切换；扩展名称与简介随浏览器语言）
- 支持网址：`https://github.com/xxx12e/human-typer/issues`
- 隐私政策网址：`https://xxx12e.github.io/human-typer/privacy.html`（GitHub Pages 托管仓库内的 `docs/privacy.html`）

## 详细描述

```
人类打字模拟器把文字按设定节奏逐字输入到你选择的网页输入框里，适合长文录入、录制演示、批量填写自己表单等场景。

两种节奏
· 常规节奏：在设定间隔内逐字随机输入，可叠加标点停顿、节奏波动和单字错字纠正。
· 边想边打：先按段落、句子、分句切分文字，再规划成一串输入步骤，在分句与句末停下构思，成段输出，走到词或分句边界时会回删几个字重写，打错了也可能过几个字才纠正。

进度按时间显示
按钮下方的进度条显示已完成百分比与剩余时间，精确到小数点后两位。边想边打使用计划中的真实等待时间，构思停顿期间也会持续减少。

断点续打
点击开始前会检查目标里已有的内容，如果开头已经写好，可以直接从那里继续，不必重复输入。要输入的文字已经整段存在时会给出提示。

Google 文档
通过浏览器调试接口逐字发送真实按键事件，英文字母与标点走 keydown/keyup，中文走输入法提交通道。该模式使用可选权限，只在你主动启用时申请；普通网页输入不需要它。

隐私
所有代码在本地运行，不联网、不上传任何文字，不读取整页内容，也不包含分析或广告代码。

界面语言
侧边栏标题右侧有一个语言按钮，点一下就能在中文与英文之间切换，设置会被记住；首次打开时跟随浏览器语言。

说明
本扩展通过浏览器事件输入文字，不是物理键盘硬件信号。网页仍可修改接收到的内容或拒绝输入事件；检测到页面内容、光标或目标发生变化时会立即停止。
```

## Detailed description (English)

```
Human Typer types text into the web field you pick, character by character, at a rhythm you choose. It suits long-form entry, screen recordings and filling in your own forms.

Two rhythms
· Fixed rhythm: characters go in at a randomised interval, optionally with pauses on punctuation, rhythm drift and single-character typo fixes.
· Think-as-you-type: the text is split by paragraph, sentence and clause, then planned as a sequence of steps. The run pauses to compose at clause and sentence ends, types in bursts, and now and then backspaces a few characters to rewrite. Typos can survive a few characters before being noticed.

Time-based progress
The bar under the buttons shows the completed percentage and the time left, to two decimals. Think-as-you-type uses the real waits from its plan, so the reading keeps moving during a composing pause.

Resume
Before starting, the target is checked for text that is already there. If the opening is in place, the run continues from that point instead of retyping it. If the whole text is already present, the panel says so.

Google Docs
Keystrokes are sent through the browser debugging interface: letters and punctuation as keydown/keyup, Chinese through the input-method path. This mode uses an optional permission that is requested only when you turn it on; plain fields never need it.

Privacy
Everything runs locally. No network requests, no uploaded text, no page-wide reading, no analytics or ads.

Language
A button next to the panel title switches between Chinese and English, and the choice is remembered. The first launch follows the browser locale.

Note
Input is delivered through browser events, not hardware keyboard signals. A page can still alter or reject what it receives; the run stops as soon as the text, caret or target changes.
```

## English permission justifications

- `activeTab` / `scripting`: inject the typing engine into the tab the user picked, and its iframes, after the user presses "Pick a field".
- `sidePanel`: the control panel uses the native side panel so it stays open while the user clicks on the page.
- `host_permissions: <all_urls>`: the user may type into a field on any site, including cross-origin iframes, so the field cannot be limited to specific hosts.
- `optional_permissions: debugger`: used only by Google Docs mode to send individual keystrokes to the document; requested when the user enables that mode and disconnected as soon as the run ends.

## 权限用途说明

Chrome 审核会逐条核对权限，提交时按下面这段填写：

- `activeTab` / `scripting`：用户点击「选择网页输入框」后，向所选标签页及其 iframe 注入输入引擎；不注入其他页面。
- `sidePanel`：控制面板使用浏览器原生侧边栏，避免点击网页时面板被关闭。
- `host_permissions: <all_urls>`：用户可能在任意网站的输入框里输入文字，需要在任意站点与跨域 iframe 中定位该输入框。
- `optional_permissions: debugger`：仅 Google 文档模式使用，用于逐字发送按键；启用时单独向用户申请，任务结束立即断开。不使用该权限时扩展只能操作普通输入框。

## 单一用途说明

单一用途：把用户提供的文字按设定节奏输入到用户选择的输入框。所有功能（参数设置、进度显示、续打检测、文档模式）都服务于这一目的。

## 截图

需要 1280×800 或 640×400 的 PNG/JPEG，建议 3～5 张：

1. 侧边栏「常规节奏」面板与参数滑动条
2. 侧边栏「边想边打」面板与节奏预览
3. 正在输入时的进度条（显示百分比与剩余时间）
4. 续打检测提示面板
5. Google 文档模式运行中（可选）

## 提交前自检

```bash
npm test          # 4 个 Node 测试
npm run pack      # 生成 dist/human-typer-<version>.zip
node scripts/check.mjs
```

上传 `dist/human-typer-<version>.zip`，不要上传整个仓库。
