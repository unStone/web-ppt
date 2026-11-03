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

## 参考

上游 `packages/preview/src/render-slide.ts`（趋势线拟合与采样位于 `trendlinePath` 附近）与 `src/internal/chartml/chart-reader.ts` 的读取字段（MIT，`18b7e75`）。
