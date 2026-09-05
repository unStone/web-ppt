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

层级空槽如何继承、缓存层级顺序、缓存与工作簿不一致时的取值策略，以及零/负值在各图的退化规则仍须结合
真实 Office 产物与规范确认。不得把上表的设计约束视为已经完成了这些算法。当前地图规定 `regionMap` 永久
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
