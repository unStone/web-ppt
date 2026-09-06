---
title: 原生渲染统计与流程扩展图表
status: open
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./003-chartex-hierarchy-rendering.md
---

## Question

在层级扩展图表已建立统一 cx 解析 seam 后，如何原生渲染直方图/Pareto、箱线图、瀑布图和漏斗图，并让地图
仍可靠使用 fallback？

直方图实现确定分箱与累计 Pareto 线，箱线图实现五数概括、四分位算法选择和异常点，瀑布图实现累计基线与
总计点，漏斗图实现按源顺序居中的比例横条；所有算法只消费解析后的格式无关模型，不能把 cx XML 逻辑塞进 `render/`。
无效数据、空序列、全负值、常量、极端离群值与标签拥挤均定义可复验退化行为。

验收覆盖六类原生 cx 与 regionMap fallback 的混合文稿，真实 Chrome、独立 SVG、打印、PNG、LibreOffice、
主题继承和性能门禁全绿；未知 cx 扩展逐字节保留，未启用入口时默认包体积不增长。

## 已实现，等待来源验收

固定/自动分箱、左右闭合与上下溢出、类别聚合及 Pareto、四分位/均值/异常点、累计瀑布及漏斗已实现。
分箱计数和标签共用区间，隐藏异常点时可见均值仍留在轴域中；非有限值和歧义来源逐对象回退。
真实漏斗按 Office 输入采用横条比例，原先“梯形”描述不作为未经证实的要求。

与层级能力共享 104 项专项、八页 Chrome 四类导出和两条保存；真实漏斗另有三项输入回归。
本票保持开放：其余类型原始 PPTX 与 Office 原生布局对照尚缺，默认产品入口仍使用 Office fallback。
见[能力与来源边界](../../../chartex-native.md)。
