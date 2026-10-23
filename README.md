# HOYOMiXCreditsQuery

**HOYO-MiX 作品署名在线查询站** · 在线版：<https://ventelios.github.io/HOYOMiXCreditsQuery/>

> ⚠️ **这个仓库是自动生成的，请不要在这里提交任何改动。**
> 每次上游数据更新，工作流都会用 `git push --force` 覆盖本仓库 `main` 分支，
> 你在这里改的任何东西下一次发布就会消失。

---

## 这是什么

把 HOYO-MiX（米哈游音乐工作室）作品数据库 —— 作曲、编曲、作词、混音、母带、制作人、
各类乐手与演唱者等署名信息 —— 转成一个纯静态的查询网页。

- 纯前端：没有后端、没有数据库，所有数据在构建期就转成了 JSON
- 全部筛选选项与计数都从数据里实时算出，没有任何写死内容
- 数据规模：**3020 条记录 × 245 个字段**

## 怎么用这个站

| 筛选项 | 交互方式 |
|---|---|
| 曲名 | 框内输入关键词，实时过滤下拉列表 |
| 专辑 / 作曲 / 编曲 | 点开筛选面板：搜索 + 多选 + 每项显示出现次数，**点「确定」才生效** |
| 其他表头 | 先选列名（可搜索），再打开该列的筛选面板 |

- 同一个面板里选多个值 = **OR**；不同筛选项之间 = **AND**
- 结果区每条记录一张「表头 | 结果」表格，只显示有值的字段
- 「导出 CSV」导出当前命中的**全部记录**、**全部 245 列**，带 UTF-8 BOM，Excel 打开不乱码

## 目录

```
├─ index.html          页面
├─ style.css           样式
├─ app.js              前端逻辑（原生 JS，无框架无构建）
├─ vendor/             本地化的 tom-select（运行时不依赖任何 CDN）
├─ data/
│  ├─ meta.json        列名、筛选列映射、各列选项及出现次数、构建时间
│  └─ rows.json        数据行（字符串二维数组，与 meta.json 的 columns 对齐）
└─ .nojekyll           告诉 GitHub Pages 不要用 Jekyll 处理
```

## 数据是怎么更新的

**本仓库不做任何数据处理，只是产物。** 数据和源码都在上游的私有仓库里：

1. 维护者在上游仓库更新 Excel 数据源
2. 上游的 GitHub Actions 自动触发：Excel → JSON → 拼装静态站点
3. 构建结果被 `force-push` 到本仓库的 `main` 分支
4. GitHub Pages 自动重新发布

正常情况下，数据更新后 **1~2 分钟**本站就会变新。

> 页面上的「更新」时间戳就是最近一次构建的时间（北京时间）。
> 由于 GitHub Pages 的 CDN 有约 10 分钟缓存，刚发布完可能需要等一下才看到最新数据；
> 页面取数据时带了构建版本号，刷新页面即可。

---

*This repository is auto-generated. Do not commit changes here — they will be
overwritten by the next deployment. The site is built and published from a private
upstream repository.*
