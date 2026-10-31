# Chrome Web Store 提交对照表

开发者后台：<https://chrome.google.com/webstore/devconsole> → 左上「+ 新建项」。
下面按后台左侧的标签页顺序，逐项给出要填的内容。文案原文都在 [listing.md](listing.md)。

要上传的文件全部复制到了 `ze/store-assets/upload/` 这一个文件夹里，选文件时直接进这个文件夹即可。原始位置（相对仓库上一级目录 `ze/`）：

| 文件 | 路径 |
| --- | --- |
| 商店包 | `repo/dist/human-typer-1.1.0.zip` |
| 商店图标 128×128 | `repo/icons/icon128.png` |
| 截图 1280×800（中文） | `store-assets/screenshots/zh-1.png` ～ `zh-4.png` |
| 截图 1280×800（英文） | `store-assets/screenshots/en-1.png` ～ `en-4.png` |
| 小型宣传图块 440×280 | `store-assets/screenshots/promo-440x280-zh.png` / `promo-440x280-en.png` |

---

## 0. 账号设置（只需一次）

- 「交易者 / 非交易者」：免费个人项目选**非交易者**。选交易者要公开展示并验证地址、电话。
- 「个人资料 → 联系电子邮件」必须验证，否则不能发布。点验证后去 gmail 收信确认。
- 发布者显示名：会公开显示，默认是邮箱，可以改成昵称，例如 `YG`。

## 1. 程序包

上传 `human-typer-1.1.0.zip`。

## 2. 商品详情（Store listing）

| 字段 | 填写 |
| --- | --- |
| 说明 | 中文页填 listing.md「详细描述」代码块；切到 English 页填「Detailed description (English)」代码块 |
| 类别 | 工具（Tools）——在「生产效率 / Productivity」下 |
| 语言 | 默认中文（简体），再加 English。名称和简介取自 `_locales`，不用手填 |
| 商店图标 | `icon128.png` |
| 屏幕截图 | 中文页传 `zh-1~4.png`，English 页传 `en-1~4.png` |
| 小型宣传图块 | 中文页 `promo-440x280-zh.png`，English 页 `promo-440x280-en.png` |
| 首页网址 | `https://github.com/xxx12e/human-typer` |
| 支持网址 | `https://github.com/xxx12e/human-typer/issues` |
| 官方网址 | 留空（需要先在 Search Console 验证网站） |

## 3. 隐私权（Privacy practices）

审核员看英文更快，这一页建议直接填英文。

**单一用途说明（Single purpose）**

```
Types text that the user provides into the web field the user picks, at a rhythm the user sets. Every feature (rhythm settings, progress display, resume detection, Google Docs mode) serves this one purpose.
```

**权限理由**

| 权限 | 理由 |
| --- | --- |
| `activeTab` | `Gives the extension the context of the tab the user is working in, so the typing engine is injected only after the user presses "Pick a field".` |
| `scripting` | `Injects the typing engine into the tab and iframes the user picked, after the user presses "Pick a field". No other pages are touched.` |
| `sidePanel` | `The control panel is a native side panel so it stays open while the user clicks on the page to pick a field.` |
| 主机权限 `<all_urls>` | `The user may type into a field on any site, including rich-text editors inside cross-origin iframes, so the target cannot be limited to a fixed list of hosts. The extension only acts on the field the user clicks and does not read whole pages.` |
| `debugger` | `Used only by Google Docs mode: the Docs editor is drawn by the page, so individual key events have to be sent through the debugging protocol. It is attached only while typing into a Google Doc the user picked and detached as soon as the run ends. Plain web fields never use it.` |

**远程代码**：选「否，我不使用远程代码」。

**数据使用**：所有数据类别都**不勾**；下面三条认证声明**全部勾选**。

**隐私权政策网址**：`https://xxx12e.github.io/human-typer/privacy.html`

## 4. 分发（Distribution）

| 字段 | 填写 |
| --- | --- |
| 付款 | 免费 |
| 公开范围 | 公开 |
| 地区 | 所有地区 |

## 5. 提交审核

右上「提交以供审核」。弹窗里可以选「审核通过后自动发布」；想自己控制上线时间就取消勾选。
审核员如果追问权限，按 [PUBLISHING.md](../PUBLISHING.md)「审核问答口径」回复。
