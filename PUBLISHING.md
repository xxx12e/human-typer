# 发布手册

三件事：把仓库推到 GitHub、把扩展上到 Edge Add-ons、把扩展上到 Chrome Web Store。仓库已经准备好（`git` 已初始化、文件已暂存、`.gitignore` 已生效），按下面顺序执行即可。

---

## 0. 发布物一览

| 产物 | 路径 | 用途 |
| --- | --- | --- |
| 源码仓库 | `repo/` | 推送到 GitHub |
| 商店包 | `repo/dist/human-typer-<版本>.zip` | 上传到两个商店；根目录就是 `manifest.json`，不再套一层文件夹 |
| 源码包 | `outputs/edge-human-typer/` | 本地加载调试 |
| 上架文案 | `repo/store/listing.md` | 中英文描述、权限用途说明 |
| 隐私政策 | `repo/docs/privacy.html` | 商店必填的隐私政策网址 |
| 图标 | `repo/icons/icon{16,32,48,128}.png` | 已在清单中引用 |

重新生成商店包：

```bash
cd repo
npm run check     # 版本一致、文件齐全、无远程代码、_locales 完整
npm run pack      # → dist/human-typer-<版本>.zip
```

---

## 1. GitHub

### 1.1 建仓库

网页上新建一个空仓库（不要勾选 README、.gitignore、License），记下地址，例如
`https://github.com/xxx12e/human-typer.git`。

### 1.2 推送

```bash
cd repo
git commit -m "初始版本"
git branch -M main
git remote add origin https://github.com/xxx12e/human-typer.git
git push -u origin main
```

> 文件已经 `git add` 过，直接 `commit` 即可。`dist/`、测试用的浏览器配置都在 `.gitignore` 里，不会被推上去。

### 1.3 打 tag 并做 Release

```bash
git tag v1.1.0
git push origin v1.1.0
```

GitHub → Releases → Draft a new release → 选 `v1.1.0` → 附件上传 `dist/human-typer-1.1.0.zip` → 正文粘贴 `CHANGELOG.md` 里 1.1.0 那段 → Publish。

### 1.4 托管隐私政策

仓库 Settings → Pages → Source 选 `main` 分支、目录选 `/docs` → Save。
一分钟后隐私政策地址为：

```
https://xxx12e.github.io/human-typer/privacy.html
```

这个地址要填进两个商店的表单。

---

## 2. Edge Add-ons

1. 打开 <https://partner.microsoft.com/dashboard/microsoftedge>，用 Microsoft 账号注册开发者（免费）。
2. **Create new extension** → 上传 `dist/human-typer-<版本>.zip`。
3. 填写上架信息（内容都写在 `store/listing.md` 里，直接复制）：
   - 显示名称：人类打字模拟器 / Human Typer
   - 短描述、详细描述：中文段 + English 段各一份
   - 分类：Productivity
   - 支持语言：简体中文、English
   - 隐私政策网址：第 1.4 步的地址
   - 截图：1280×800，3～5 张（面板常规模式、边想边打、运行中的进度条、续打提示、文档模式）
4. 权限说明按 `store/listing.md` 的「权限用途说明」逐条填。
5. 提交审核。首次审核通常几个工作日，期间可在 Partner Center 看状态。
6. 通过后扩展会自动上架，也可以在后台选择「手动发布」。

---

## 3. Chrome Web Store

1. 打开 <https://chrome.google.com/webstore/devconsole>，注册开发者账号（一次性 5 美元，信用卡）。
2. **New item** → 上传同一个 `dist/human-typer-<版本>.zip`。
3. 填写 Store listing（同上，中英文描述各一份）。
4. **Privacy practices** 一页要格外认真：
   - 单一用途说明：把用户提供的文字按设定节奏输入到用户选择的输入框。
   - 权限用途：`activeTab`/`scripting`/`sidePanel`/`<all_urls>`/`debugger` 逐条填（`store/listing.md` 里有中英两版）。
   - 数据使用：勾选「不收集用户数据」，与 `docs/PRIVACY.md` 保持一致。
   - 远程代码：选择「不使用远程代码」。
5. 提交审核。Chrome 的审核通常比 Edge 慢，遇到权限追问按下面的口径回复。

### 审核问答口径

| 审核问题 | 回复要点 |
| --- | --- |
| 为什么需要 `debugger` | Google 文档的编辑区是画布，只能通过浏览器调试接口逐字发送按键；该权限是**可选权限**，仅当用户主动开启文档模式时才申请，任务结束即断开，普通网页输入完全不使用 |
| 为什么需要 `<all_urls>` | 用户可能在任意网站输入文字；扩展只在用户点击「选择网页输入框」后操作该页面与其 iframe，不读取整页内容 |
| 这个扩展做什么 | 用户自己提供文字、自己选择目标输入框，扩展按设定节奏代替逐字敲入；不与其他用户交互，不生成虚假互动 |
| 是否收集数据 | 不收集、不上传，全部本地运行，无分析代码 |

---

## 4. 被拒怎么办

| 情况 | 处理 |
| --- | --- |
| 卡在 `debugger` | 出一版不含文档模式的包：清单删掉 `optional_permissions`，`popup.js` 里文档分支禁用，删除 `docs-target.js`、`docs-runner.js` 及其引用；普通网页功能不受影响 |
| 卡在 `<all_urls>` | 同上，另可考虑改为 `activeTab` + 用户手势注入（会失去跨域 iframe 能力） |
| 描述被认定误导 | 只描述功能，不写「模拟真人以规避识别」一类表述；当前文案已经按这个口径写过 |
| 需要演示视频 | 录 30 秒：选输入框 → 点开始 → 进度条推进 → 文本完成 |

---

## 5. 后续版本怎么发

版本号要同时改三处，`npm run check` 会校验一致性：

1. `manifest.json` 的 `version`
2. `package.json` 的 `version`
3. `CHANGELOG.md` 加 `## <版本>` 段

```bash
cd repo
npm test                # 5 个测试套件
npm run check
npm run pack
git add -A && git commit -m "v1.1.1"
git tag v1.1.1 && git push && git push --tags
```

两个商店后台上传新 zip、提交审核即可；已安装用户由浏览器自动更新（商店版），侧载用户需要手动重载。

---

## 6. 发布前检查清单

- [ ] `npm test` 全绿
- [ ] `npm run check` 通过（版本、文件、`_locales`、无 eval、无远程脚本）
- [ ] `dist/human-typer-<版本>.zip` 里 `manifest.json` 在根目录
- [ ] 图标四个尺寸都在包里
- [ ] 隐私政策网址可访问
- [ ] 截图 3～5 张，1280×800
- [ ] 商店描述与实际行为一致（不写规避检测的表述）
- [ ] 用解压后的 zip 在本机加载一次，确认面板能打开、能输入文字
