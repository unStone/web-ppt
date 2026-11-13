# 图表趋势线、误差线与数据表渲染

状态：SDK 能力已交付（解析 + 渲染 + chart-design 编辑命令）；官网图表面板入口待产品确认。实施记录与对照归因见[票据 003](../wayfinder/ppt-desktop-parity/tickets/003-chart-analysis-rendering.md)。

## 1. 问题

`c:trendline`、`c:errBars` 与 `c:dTable` 只在 edit-core 的保存链路里作为 XML 保留：`core/src/chart` 不解析也不绘制，用户看到的图表比 PowerPoint 少这三类元素。

## 2. 设计决策

### D1 拟合在 core，输出采样点

[chart/analysis.ts](../../packages/core/src/chart/analysis.ts) 提供六种拟合：linear / exponential / logarithmic / poly(2–6) / power / movingAvg。类目图 x 取 1..n（PowerPoint 口径），散点用实际 xVal；`forward` / `backward` 按类目（散点按 x 单位）延伸，越界部分用 Liang-Barsky 裁剪进绘图区。指数 / 对数 / 幂在正数域上线性化拟合（与 PowerPoint 一致），R² 在原始域上计算——与 PowerPoint 的线性化口径有微小差异，对照时按归因记录；movingAvg 不提供公式与 R²（PowerPoint 同口径）。poly 的法方程需要 x^(2·order) 次幂，幂表按 2·order+1 项生成。

### D2 视觉值：堆叠图按「累计顶」拟合

堆叠图的趋势线锚定在该系列的累计顶（正负分组累加，与 renderBars 同口径），百分比堆叠取累计占比——否则拟合值落在值轴之外会被整条裁剪。误差线在堆叠 / 百分比堆叠图上不绘制（锚点与累计基线耦合，边界记录在能力矩阵）；股价图无逐点锚点，同样不画。3D 图组不画趋势线与误差线。

### D3 趋势线是系列级叠加元素

趋势线画在所属系列之后；样式取 `c:spPr`，缺省沿用系列色与 2px 宽。图例按 PowerPoint 口径为趋势线追加独立条目（紧跟所属系列）：有 `c:name` 用原名，缺省自动生成「线性 (系列名)」；图例删除下标沿用顺序空间。公式与 R² 标签画在线段中点上方，numFmt 缺省 General，系数经 `formatNumber`。

### D4 误差线五类取值

`fixedVal` / `percentage`（|y| 的百分比）/ `stdDev`（样本标准差 × 倍数）/ `stdErr`（std/√n）/ `cust`（`c:plus` / `c:minus` 数值源，缺点取 0，允许上下不对称）。方向：类目图沿值轴（barDir=bar 时沿值轴水平方向），散点 / 气泡按 `c:errDir` 各画一条；柱的锚点复用 [barSlotGeom](../../packages/core/src/chart/plots.ts) 的柱心，线 / 面积取点。端帽除非 `c:noEndCap`。样式缺省 `m.textColor`、0.75pt。

### D5 数据表替换类目标签带

`c:dTable` 在底部横置类目轴下方占一条表带：绘图区先扣掉表带高度再算轴留白，类目轴刻度标签置 `tickLblPos=none`（表头行替代）。首行类目名，其后每系列一行；`showKeys` 时首列为图例键（线系画线 + 标记，柱系画色块，与图例样式一致）；列边界对齐类目边界（midCat 用相邻中心的中点）；`showHorzBorder` / `showVertBorder` / `showOutline` 分别控制行线、列线、外框。仅底部横置类目轴的 2D 图组渲染；其余配置出现 `c:dTable` 时忽略。

### D6 编辑面：ChartDesign 三个字段

`ChartDesign` 增 `trendlines?` / `errorBars?` / `dataTable?`，整值替换语义：`undefined` 保持原样，数组 / 对象重写，空数组与 `null` 移除。`applyChartDesign` 先移除旧元素再按 [dml-chart.xsd](https://learn.microsoft.com/) 序列位插入（trendline / errBars 在 dLbls 之后、cat / val 之前；dTable 在轴之后、spPr 之前）；`direction: 'both'` 写出 x / y 两条 `c:errBars`。normalize 校验：poly 阶数 2–6、movingAvg 周期 ≥2、forward / backward / intercept / value 有限数、cust 数组长度 ≤ `MAX_CHART_POINTS`、颜色 `#rrggbb`、字段白名单。官网图表面板入口与 012 同口径待产品确认。

## 3. 验收与对照归因

| 项 | 结果 |
|---|---|
| 固件 | [sample-chart-analysis.pptx](../../fixtures/)（由 make-chart-analysis-fixture.mjs 注入）：六种趋势线、五类误差线取值、数据表各有落点 |
| 拟合确定性 | 六个方程系数由固件数据唯一决定，test-chart-analysis 逐字断言 |
| 两条文本路径 | 原生 `<text>` 与 foreignObject 路径都含公式 / 图例名 / 表格文字（快照 + 断言双覆盖） |
| 矢量 PDF | 公式与图例名进入 PDF 文本层可搜索（test-vector-pdf，formula 样本字体 + PDFium 独立核对） |
| 快照 | 新增 20 个基线；其余 212 个基线逐字节不变 |
| 保存链路 | chart-design 写入后 `verifyChartDesignXml` 通过（序列含 ser/trendline/errBars/dTable）、保存重开一致、三次撤销 / 重做往返一致、非法输入原子拒绝 |
| 体积 | chart-edit 按需入口 93_187B（gzip 29_095B），预算按实测校准至 96_000 / 30_000；默认入口闭包不变 |

LibreOffice 对照（`npm run compare` 与整册 PDF 导出）：

- 第 2 页幂趋势线：LibreOffice 画出趋势线但系数口径与标签排布不同（线性化 R² 口径、标签定位策略差异）。
- 第 1 页对数趋势线：**LibreOffice 导入时丢弃**（整页无趋势线），本引擎按 ECMA-376 渲染。
- 第 8 页数据表：两侧都渲染表带并隐藏类目标签；LibreOffice 为双图组重复铺列且右半区渲染异常（轴标题竖排进单元格），本引擎按主类目数铺列，与 PowerPoint 语义一致。

## 4. 不做

- 堆叠图的误差线与 3D 图组的趋势线 / 误差线（锚点语义不成立，见能力矩阵边界）。
- 趋势线标签的手动布局（`c:trendlineLbl/c:layout`）——按线段中点自动定位。
