---
title: 编辑经典图表的数据集
status: closed
assignee: /root
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

## Progress

- `@web-ppt/core/chart-edit` 读取经典图表来源，`@web-ppt/edit-core/chart` 定义稳定 `ChartSeriesId` /
  `ChartPointId`、稀疏字段补丁和命令；editor、React、Vue 只做薄转发，官网检查器按选择动态加载。未触碰图表时，
  默认包、模型和官网初始静态闭包不承载解析器或 SpreadsheetML 写回器。
- 类别图、散点图、气泡图与组合图共用一个 `ChartDataset`，支持系列、类别和数值的增删改。补丁进入既有原子
  历史、恢复帧与字段级 LWW；缺失父对象可从稀疏子字段确定性物化，乱序三副本仍收敛。图表 frame 是一个 DOM
  编辑身份，后代记录保留只读，不能绕过权限。
- 保存事务同时更新 `c:numCache` / `c:strCache`、公式范围、内嵌工作表与 shared strings，并把稳定语义 ID 写入
  `c:extLst` 清单，保存重开、删空后重建及已保存撤销都不丢身份。工作簿写入只占用计划内单元格，不覆盖未知
  稀疏数据；共享 chart part、共享 workbook、歧义绑定、外部数据和恶意范围显式只读。
- 确定性固件从 Apache POI `bar-chart.pptx` 真实嵌入工作簿语料提炼，保留多种字符串、稀疏单元格、替代 XML
  前缀、无 cache 与扩展节点顺序。194 项专项断言覆盖模型、保存重开、恶意输入、冷启动恢复与协同；真实 Chrome
  完成数据编辑上屏，LibreOffice 打开生成工件并确认 cache 与双击工作簿值一致。
- 全仓 `npm run check && npm test && npm run build && npm run verify` 尚未整轮通过：4826 项断言、186 个快照、
  544 对编辑等价指纹及八包构建通过；真实 Chrome 删除 p95 为 8.5ms，超过原 8ms 门槛，环境自检受扰。
  core / edit-core / editor 主入口均回到原体积预算内；图表按需入口实测为 core 25,453B gzip、
  edit-core 23,028B gzip。薄框架转发不复制实现，身份与分数序、
  XML 与 OPC 均复用已有入口。

## 性能受扰调查记录（已解除）

2026-09-05 在独立临时目录检出已提交基线 `e0cd9ae`，使用相同 Node 24.3.0、Chrome 和未改动的性能门禁对照：

| 版本 | 60 元素删除 p95（预算 8ms） | 其他失败 | 固定计算自检（预算 5.8ms） |
|---|---|---|---|
| 当前工作树 | 8.5ms | 无 | 测前 27.5ms / 测中 31.3ms |
| 已提交基线 `e0cd9ae` | 8.4ms | 表格末格追加 33ms > 30ms | 测前 25.5ms / 测中 32.5ms |
| 后续工作树复验 | 8.6ms | 无 | 测前 27.4ms / 测中 31.1ms |

两者均在自带的一次重测后失败，不能把当前受扰机器上的结果当成可靠回归判断。4826 项功能断言、186 个快照、
544 对等价指纹、八包构建与完整 `npm run verify` 均通过；两个 LibreOffice 工件已重新打开，规范与需求复核
没有剩余阻塞问题。当时保持票据打开且不提交，等待空闲环境重跑原四项门禁；不改性能阈值、不停止用户应用或系统安全扫描。

后续复验发生在先前高 CPU 的安全扫描已不在高负载进程列表之后，仍未通过原门禁及其自带的一次重测；
Chrome 与 WindowServer 当时仍有负载。不再无条件重复同一性能运行，先推进独立的 ChartEx 真实语料调查。

## Answer

2026-09-05 完成最终 `check → test → build → verify` 整轮验收，四项退出码均为 0。本票关闭；同时在开发的 MC
回退增量仍单列在票 008，不以本票关闭表示全部 ChartEx 已完成。

| 验收 | 最终证据 |
|---|---|
| 自动测试 | 4920 项断言（含图表数据 194、MC 回退 93），186 个原快照，83 份固件 / 273 页 / 546 对独立进程指纹 |
| 真实 Chrome | 数据检查器与兼容图片四路径通过；60 元素删除 p95 7.7ms ≤ 8ms、表格末格追加 13.5ms ≤ 30ms，原性能契约通过 |
| 构建边界 | 八包通过；edit-core 默认入口 82500B gzip ≤ 原 82503B，editor 主入口 282169B / 69743B gzip，图表实现仅在按需入口 |
| 一致性 | 341 项一致性检查、28 项 0.6 审计、18 项 0.7 审计通过 |
| Office | 两份本轮工件由 LibreOffice 打开并导出 PDF，图表缓存与工作簿同值；Windows PowerPoint 真机仍缺 runner，不伪称通过 |
| 双轴审查 | Standards 与 Spec 最终均 PASS；按审查收敛框架身份、共享 ID 扫描与格式覆盖语义，未放宽预算 |
