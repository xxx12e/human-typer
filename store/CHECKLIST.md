# 上架评估与流程

## 结论

| 渠道 | 可行性 | 说明 |
| --- | --- | --- |
| GitHub 仓库 + Release | 直接可行 | 代码全部本地运行，MIT 许可，无第三方依赖 |
| Edge Add-ons | 可提交，需审核 | 免费开发者账号；`debugger` 已在清单中声明为可选权限，审核会重点看用途说明 |
| Chrome Web Store | 可提交，审核更严 | 一次性 5 美元注册费；`debugger` 属于高关注权限，通常要求可选 + 详细说明 |
| 侧载（开发者模式加载） | 随时可用 | 不需要任何审核，适合先给用户用 |

两个商店的政策文件都要求：单一用途、权限最小化、无远程代码、有隐私政策网址、描述与实际行为一致。当前实现符合前四项，隐私政策见 `docs/PRIVACY.md`。

## 已知风险与应对

1. `debugger` 权限
   - 现状：已从 `permissions` 移到 `optional_permissions`，只在用户点击「启用 Google 文档模式」时申请，任务结束即断开。
   - 应对：在权限说明里明确"仅用于向文档逐字发送按键"；如果审核仍不接受，可以发布不含文档模式的构建（删除 `optional_permissions` 与 `docs-target.js`、`docs-runner.js`，并在 `background.js`、`popup.js` 中去掉对它们的引用）。

2. `<all_urls>` 主机权限
   - 用途：用户可能在任意网站输入文字。审核通常要求说明"为什么不能收窄到具体站点"。
   - 应对：描述里写清楚只操作"用户点击选中的输入框"，并说明不读取整页内容。

3. 用途描述
   - 商店会把"模拟人类输入"读成规避自动化识别。文案里只描述功能（按设定节奏逐字输入、构思停顿、回改、续打），不写"绕过检测""不被发现"一类表述。

4. 名称里的"人类"字样
   - 保留无问题，但描述中避免声称可以让第三方系统认定为真人。

## 语言

界面语言在侧边栏内一键切换（中文 / English），扩展名称与简介由 `_locales` 跟随浏览器语言。商店后台的「支持语言」两项都要勾选，中文与英文描述分别在 `store/listing.md` 里，提交时按当前店铺语言填入。

## 提交步骤

1. 注册账号
   - Chrome Web Store：开发者账号，一次性 5 美元。
   - Edge Add-ons：Partner Center 免费账号。
2. 准备材料
   - `dist/human-typer-<version>.zip`（由 `npm run pack` 生成，只含运行文件与图标）
   - 隐私政策网址（GitHub Pages 或仓库 raw 链接）
   - 2～5 张截图，1280×800
   - 权限用途说明与单一用途说明（见 `store/listing.md`）
3. 提交审核，常见问题回复口径
   - 为什么需要 `debugger`：Google 文档的编辑区是画布，只能通过浏览器调试接口逐字发送按键事件；权限可选，用户主动启用才申请。
   - 为什么会输入文字：这是扩展的唯一功能，由用户点击开始、作用于用户选中的输入框。
4. 审核通过后发布；未通过时按拒绝理由补充说明，或改用不含文档模式的构建。

## 发布到 GitHub

```bash
git init
git add .
git commit -m "初始版本"
git branch -M main
git remote add origin https://github.com/xxx12e/human-typer.git
git push -u origin main
```

Release：打 tag `v1.0.0`，上传 `dist/human-typer-1.0.0.zip`，正文使用 `CHANGELOG.md` 中对应段落。

## 仓库卫生

- 不提交 `dist/`、测试用的浏览器配置目录（已在 `.gitignore` 中忽略）。
- 提交前运行 `npm test`、`node scripts/check.mjs`。
- 版本号需要同时更新 `manifest.json`、`package.json` 与 `CHANGELOG.md`，`scripts/check.mjs` 会校验三者一致。
