---
title: 确认扩展图表回退与真实语料边界
status: open
labels:
  - wayfinder:research
parent: ../map.md
blocked_by: []
---

## Question

真实 Office 2016+ 文件如何把 `cx:chartSpace`、`mc:AlternateContent`、fallback 图片、关系和内嵌工作簿连接起来，
现有解析器是否确实在全部七类扩展图表上显示 fallback，而不是因为某种生产者差异偶然成功？

收集来源可追溯且可合法用于回归的树状图、旭日、直方图/Pareto、箱线、瀑布、漏斗和地图真实样本；记录各版本
命名空间、关系图、数据维度、空值/负值/重复类别、fallback 形态与 PowerPoint/LibreOffice 行为。从真实样本
最小化出确定性生成固件，但保留决定解析分支的全部结构，并把原样本哈希、来源和探针结果写成可复验清单。

验收必须先证明当前 fallback 在真实 Chrome 和独立 SVG 两条文字路径中可见；再明确六类可原生渲染图的统一数据
模型与 regionMap 永久 fallback 边界。不得把仅由自己编写的 XML 当成真实语料证据，也不得在没有行政区边界数据
时伪造地图原生渲染。
