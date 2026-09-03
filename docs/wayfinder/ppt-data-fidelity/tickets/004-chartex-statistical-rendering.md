---
title: 原生渲染统计与流程扩展图表
status: open
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
总计点，漏斗图实现稳定梯形比例；所有算法只消费解析后的格式无关模型，不能把 cx XML 逻辑塞进 `render/`。
无效数据、空序列、全负值、常量、极端离群值与标签拥挤均定义可复验退化行为。

验收覆盖六类原生 cx 与 regionMap fallback 的混合文稿，真实 Chrome、独立 SVG、打印、PNG、LibreOffice、
主题继承和性能门禁全绿；未知 cx 扩展逐字节保留，未启用入口时默认包体积不增长。
