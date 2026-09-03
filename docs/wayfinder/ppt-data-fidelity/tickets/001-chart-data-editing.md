---
title: 编辑经典图表的数据集
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

经典图表当前只是 `frame` 对象。如何提供按需的数据编辑 seam，让用户可增加、删除、重命名系列，增加、删除、
重命名类别，并修改柱线饼面积等类别图以及散点/气泡图的数值，同时保证屏幕投影、图表缓存和内嵌工作簿只有
一份语义真值？

从带真实内嵌工作簿的 Office / Apache POI 语料提炼确定性固件，保留 `c:idx`、公式引用、数字格式、空值、共享
字符串、inline string、多工作表与稀疏单元格等真实结构。定义稳定 `ChartSeriesId` / `ChartPointId`、
`ChartDataset`、来源 `ChartDataBinding` 与稀疏覆盖；按需入口负责读取、校验和生成命令，主编辑模型只在用户实际
触碰图表后承载覆盖。图表命令必须进入既有原子历史、恢复帧与字段级 LWW 协同，且不能通过 `frame` 子元素
绕过普通元素权限。

补丁保存以一个语义提交同时更新 `c:numCache` / `c:strCache`、公式范围、图表关系指向的 `.xlsx` 工作表和必要的
shared strings；工作簿缺失或绑定无法无歧义解释时明确降级为只改 literal/cache 或只读，不伪造 Excel 已同步。
生成保存为新建图表预留同一数据集模型，但本票不新增图表类型选择器。公开 editor/React/Vue seam 与官网数据表
只消费同一入口；默认包不静态引入图表编辑器或 SpreadsheetML 补丁器。

验收覆盖类别图、散点图、气泡图、组合图，多系列增删、多行增删、空值、恶意公式/索引、撤销重做、恢复、并发
收敛、保存重开及“PowerPoint 显示值 = 双击编辑数据看到的值”；真实 Chrome 与 LibreOffice 通过，生成的 Office
工件进入 0.8 单一清单，全部仓库门禁全绿。
