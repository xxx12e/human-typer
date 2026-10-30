# 更新记录 / Changelog

## 1.1.1

- 右上角语言切换改成高亮的「中文 | EN」双段按钮，当前语言实心显示，一眼就能找到
  The language switch in the top-right is now a highlighted 中文 | EN pill; the active language is filled
- 浏览器语言既不是中文也不是英文时（德语、日语等），面板默认显示英文，不再回退到中文
  Browsers in other languages (German, Japanese, …) now default to English instead of Chinese
- 清单默认语种改为英文，扩展名改为中英双语：人类打字模拟器 (Human Typer)
  Default manifest locale is now English; the extension name is bilingual: Human Typer (人类打字模拟器)
- 面板标题旁的版本号改为从清单读取
  The version next to the panel title is read from the manifest

## 1.1.0

- 侧边栏新增语言切换按钮，一键在中文与英文之间切换，选择会被记住
- 首次打开时跟随浏览器语言（`zh-*` 用中文，其余用英文）
- 面板文案、滑动条读数、进度与状态消息、Google 文档适配全部双语
- 扩展名称与简介通过 `_locales` 本地化，扩展管理页与商店列表跟随浏览器语言
- 新增文案一致性测试：中英文键、占位符、面板与代码引用全部对齐

## 1.0.0

首个公开版本。

- 侧边栏控制面板，支持常规节奏与「边想边打」两种输入模式
- 常规节奏：随机间隔、标点停顿、节奏波动、单字错字纠正、随机思考停顿
- 边想边打：按段落／句子／分句／词语生成节奏计划，包含构思停顿、成句输出、回改重写、延迟发现错字与走神长停顿
- 参数滑动条，实时显示该参数产生的次数与耗时
- 总时长预算：只缩放构思停顿，不改变书写速度与回改序列
- 进度按时间显示，精确到小数点后两位
- 续打检测：目标里已写好的开头可以跳过，不重复输入
- 支持普通输入框、iframe 富文本编辑器与 Google 文档
- Google 文档使用调试接口逐字发送真实按键事件（可选权限，按需申请）
- 严格字符清洗与外部改动即停的保护
