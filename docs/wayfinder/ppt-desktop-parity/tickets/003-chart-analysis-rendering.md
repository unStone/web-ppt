---
title: 图表趋势线、误差线与数据表渲染
status: open
priority: P1
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

文件里已有的趋势线、误差线和图表数据表，怎样在两条文本路径和 PDF / 图片导出中如实画出来？

## 现状

`c:trendline` 与 `c:errBars` 只在 `edit-core/chart-design` 与 `chart/materialize` 中作为 XML 保留；`core/src/chart` 不解析也不绘制，`c:dTable` 同样不渲染。用户看到的图表比 PowerPoint 少这些元素。

## 范围

| 元素 | 说明 |
|---|---|
| 趋势线 | linear、exp、log、poly（阶数）、power、movingAvg；前推 / 后推、截距、公式与 R² 标签；线条样式 |
| 误差线 | 固定值、百分比、标准差、标准误差、自定义（`c:plus` / `c:minus` 数值与引用）；方向、端帽、线条样式 |
| 数据表 | 图例键、边框（水平 / 垂直 / 外框）、字体；绘图区随之收缩 |
| Schema | 先进 `types.ts` 的图表模型，`render/` 消费，`.ppt` 经 EMF 预览的路径不变 |
| 编辑 | `edit-core/chart-design` 增加三类元素的开关与参数命令，官网图表面板入口（产品待确认） |

## 完成条件

- 每类元素有确定性固件；与 LibreOffice 渲染做 `npm run compare` 对照，差异逐项归因。
- 原生 `<text>` 路径与 `foreignObject` 路径都包含公式标签与数据表文字；矢量 PDF 可搜索到这些文字。
- 快照基线按新增内容更新，其余快照逐字节不变。

## Answer（2026-11-14，SDK 能力已交付；产品入口待后续）

设计与实施见[设计文档](../../../design/chart-analysis-rendering.md)。已交付：

| 层 | 交付 |
|---|---|
| core | `chart/analysis.ts`：六种拟合（类目 x = 1..n、散点实际 x、Liang-Barsky 裁剪、poly 法方程 2·order 幂表）、误差线五类取值求解、数据表渲染；`Series.trendlines` / `Series.errBars` / `ChartModel.dTable` 解析（序列按 dml-chart.xsd） |
| 渲染 | 趋势线挂系列后 + 图例独立条目（`c:name` 或「类型 (系列名)」）+ 公式 / R² 标签；误差线端帽与方向；数据表替换类目标签带（表头行 + 键列 + 行列外框线）；堆叠图按累计顶 / 占比拟合 |
| edit-core | `ChartDesign.trendlines / errorBars / dataTable`（整值替换），`applyChartDesign` 按序列位写入与移除；normalize 校验（阶数 / 周期 / 有限数 / 数组上限 / 颜色） |
| 验收 | 固件 `sample-chart-analysis.pptx` 六型全覆盖；test-chart-analysis（拟合逐字断言、两条文本路径、编辑写入、`verifyChartDesignXml`、保存重开、三次撤销重做、原子拒绝）；test-core 新增 6 项断言 + 20 个快照（其余基线逐字节不变）；矢量 PDF 文本层可搜索（test-vector-pdf + formula 样本字体）；LibreOffice 对照与归因见设计文档 |

完成条件核对：

- ✅ 每类元素有确定性固件；快照基线按新增内容更新，其余逐字节不变。
- ✅ 两条文本路径包含公式标签与数据表文字；矢量 PDF 可搜索。
- ✅ 差异归因：LibreOffice 丢弃对数趋势线、双图组数据表重复铺列为其导入器行为；幂趋势线系数口径差异按线性化 R² 口径记录。
- ⚠️ 编辑命令已交付；官网图表面板入口标注「产品待确认」，与 012 同口径留待产品流程。

## 参考

上游 `packages/preview/src/render-slide.ts`（趋势线拟合与采样位于 `trendlinePath` 附近）与 `src/internal/chartml/chart-reader.ts` 的读取字段（MIT，`18b7e75`）。
