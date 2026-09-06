# ChartEx 数据来源与原生布局输入边界

调查日期：2026-09-06。当前交付是只读探针与模型约束，**没有新增原生渲染入口**，票 002 保持打开。

## 已证实的数据来源

`chartData/externalData` 可以指向外部或内嵌工作簿；Excel 宿主也可直接引用自己的工作簿。
`strDim/f` 后的 `lvl` 缓存是可选的。不能把缺缓存当成空图表。
来源：[CT_ChartData](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/8a963284-245d-4c2a-935d-cc6aef448b09)、
[CT_StringDimension](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/ab157fdd-8e5a-4b42-8205-aaf41384d457)。

探针沿包关系读取工作簿、工作表和共享字符串，不猜测工作簿 part 名；只接受可定位的单矩形 A1 引用或直接
指向该矩形的全局定义名称。单元格值要结合类型解释：`t="s"` 是共享字符串索引，`v` 也可能是公式的缓存结果。
来源：[工作表与单元格](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/working-with-sheets)、
[定义名称](https://learn.microsoft.com/en-us/office/open-xml/spreadsheet/how-to-retrieve-a-dictionary-of-all-named-ranges-in-a-spreadsheet)。

以下为[哈希锁定的 9 个本地文件](../../../../fixtures/chartex-corpus.json)的 CLI 实测结果；PPTX/XLSX 证据不互换。

| 输入 | 引用矩形（行 × 列） | 对模型有影响的事实 |
|---|---|---|
| 漏斗 PPTX | 3 组 `cat 4×1 + val 4×1`，内嵌 XLSX | 有缓存；后两条系列隐藏，不能把 3 组数据都画出来 |
| treemap / sunburst XLSX | `cat 11×3 + size 11×1` | 类别矩形有 16 个缺失单元格；叶子 `C/D/E` 跨上层分支重复 |
| histogram XLSX | `val 5×1` | 原始观测值 `[12,10,11,13,15]`，不是已经分好的柱高 |
| Pareto XLSX | `val 10×1` | 原始观测值 `[3,4,5,3,4,3,4,1,2,1]`，重复值不可去重 |
| boxWhisker XLSX | 3 组 `val 9×1` | 每组是原始观测值；`quartileMethod="exclusive"` 是布局属性 |
| waterfall XLSX | `val 12×1` | `[2,5,4,6,-5,-6,-4,7,8,6,7,5]`；负值位于 C8/C9/C10 |
| funnel XLSX | `val 6×1` | `[4,5,7,12,3,5]`；不能假设源数据已经降序排列 |
| regionMap XLSX | `cat 10×1 + colorVal 10×1` | 读取数值不构成行政区几何或原生地图证据 |

`f/@dir` 默认 `col`，`col/row` 分别按列/行产生维度；探针保留物理矩形和方向，尚未把它们转成树。
来源：[CT_Formula](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/174c9b33-29d8-4764-a3c8-7ad71abf4424)、
[ST_FormulaDirection](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/dc4c0e17-c0a4-4ceb-ab6c-e3be112af187)。

## 后续实现的统一输入约束（设计，不是已发布 API）

```text
缓存层级 / 包内引用矩形（保留来源、类型与位置）
  → 维度集合 dataId → 各系列引用 + 布局属性
    → 六类几何布局 → 现有 SlideElement[] → 两条 SVG 路径
```

| 边界 | 必须保留 | 不能在解析阶段偷偷做 |
|---|---|---|
| 数据来源 | literal/cache/workbook/unresolved、公式、part、单元格地址、原始 `idx/ptCount` | 联网取外链、重算公式、将未解析当空数组 |
| 值 | 数值、文本、布尔、错误、日期原文；空白、缺单元格、无公式结果与无效值分别记录 | `Number('')=0`；把文本数字或共享字符串索引当作数值 |
| 层级维度 | 每层位置、方向、重复标签、所有空槽 | 删除空槽后错位；只按标签全局合并；未经证据确认就全列向下填充 |
| 系列 | 数据引用、顺序、隐藏状态、所属系列、名称/样式来源 | 将隐藏系列作为可见图形，或因隐藏而丢弃来源字节 |
| 布局 | 树状/旭日的层级路径与 size；统计图的原始观测；瀑布的小计索引；漏斗的源顺序 | 把统计摘要当原始数据；把小计等同于增量；用“通常降序”改写漏斗数据 |
| 回退 | 逐对象失败原因及原 Office 外壳、关系与预览 | 任一错误让整页丢失；未知扩展强行输出貌似正确的图 |

系列的 `dataId`、`hidden` 与 `ownerIdx` 属于独立语义；`layoutPr` 存放分箱、统计和小计等属性。
来源：[CT_Series](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/86df19ea-8e94-49fc-9160-377c1b40b985)、
[CT_SeriesLayoutProperties](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/1ff5c9ad-828a-4d0c-be72-07754eba3588)。

普通稀疏父类别继承已有产品团队说明，但任意空槽的规则、缓存层级顺序、两路不一致时的取值策略，以及零/负值
在各图的退化仍须结合真实 Office 产物确认，见[层级语义补充](chartex-hierarchy-semantics.md)。不得把上表的
设计约束视为已经完成了这些算法。当前地图规定 `regionMap` 永久
回退；这个产品范围不因探针读到了地图数据而改变。

## 可复验命令与限制

```bash
# 先构建 core/edit-core；下列测试不改发布包实现。
fnm exec --using=v24.3.0 npm run test:chartex:probe
# 另需从清单原址获取 9 个文件；逐文件校验 SHA-256，不下载或重新分发媒体。
fnm exec --using=v24.3.0 npm run test:chartex:probe -- --corpus
fnm exec --using=v24.3.0 node tooling/test-chartex-probe.mjs
```

默认契约使用确定性人工边界包并在临时目录清理；它覆盖任意包内路径、中文富文本/注音、引号工作表名、
空值类型、公式缓存、外链、重复坐标、作用域歧义和超大范围。`--corpus` 额外验证真实数据矩形与来源哈希。
探针不是公式引擎、日期格式化器或 SpreadsheetML 完整校验器：局部名称、表达式、间接名称与多区域引用
保守返回 `unresolved`；`resolved` 只表示引用矩形已定位，其中仍可能有 `invalid`、`error` 或 `uncalculated` 单元格。

本轮只改 `tooling/`、命令和研究记录，不往 core/edit-core/editor 的默认依赖图加入解析器，不修改体积预算。

## 缓存／字面值与工作簿的对齐报告

探针新增 `inlineData`、`workbookData` 和 `sourceComparison`；原始公式、`idx/ptCount`、缓存文字、物理矩形与
来源地址仍单独保留。这是 CLI 调查输出，不是发布包 API，也不决定原生图表的数据优先级。

| 输出 | 可复验行为 | 解释边界 |
|---|---|---|
| `inlineData` | 区分 `literal/cache`；按 `idx` 展开稀疏槽，保留层名和数字格式 | 缺点、空字符串和数值零不互换；不推断父继承 |
| `workbookData` | 按显式／默认 `dir` 产生物理维度，保留每个单元格地址和类型 | 不把首列自动解释为缓存首层，不求值公式或格式化日期 |
| `sourceComparison` | 两边各一层时核对原始类型、值和点数，差异带位置及两侧值 | `equal` 只表示这层原值一致，不代表图形、格式或整个图表等价 |
| 无法核对 | 无缓存、外部／未知引用、无效值或多层映射未知均返回 `not-comparable` | 不把“两边都无效”或“缺缓存”记为一致，不选择某一侧覆盖另一侧 |

数值点是 `xsd:double` 简单内容，`idx` 为无符号整数；层的 `ptCount` 为必填无符号整数，缓存与字面层来自
不同 schema 分支。来源：[CT_NumericValue](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/e3ae6c9c-786a-4b7d-920d-41e9a0f5a045)、
[CT_NumericLevel](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/06393495-73ef-4826-af89-4e119dc35e42)、
[CT_NumericDimension](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/37fbbd78-c3e6-4f33-9d0b-3fe428ad1c09)。

探针对重复／越界／缺失索引、无效点数和多个公式拒绝展开；每维度累计最多 10,000 个槽。数字空串、非数值、
非有限值保留原文并记为 `invalid`（这里表示不可用于有限几何，不等于完整 XSD 合法性结论）。只认数据路径的
直接子元素，不把扩展内同名节点或点内复杂内容拼成另一份合法数据。

`--corpus` 实测真实漏斗 6 个缓存维度各 4 点，均与内嵌工作簿一致；8 个原始 XLSX 均保持无缓存且可读取工作簿。
人工契约另测稀疏／乱序索引、空文本、冲突、点数不一致、行列方向、多层不误报、无效数及累计上限。默认人工
契约已接入 `npm run verify`，在构建后使用实际 dist；不依赖未入库语料或网络。原始语料契约仍显式用 `--corpus`。
