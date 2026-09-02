---
title: 补齐分布、替代文字、节与页面尺寸
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by: []
---

## Question

对齐、对象名称、页序与 `p14:sectionLst` 已有可复用基础设施，但编辑器仍缺少四组 PowerPoint 高频收尾能力：
水平/垂直等距分布、元素替代文字、节的增删改名/移动，以及整份演示的页面尺寸。如何把它们做成严格命令与
公开查询 seam，并保持一个用户动作对应一个原子历史单元？

分布只接受同页至少三个可移动最外层对象，复用世界 AABB 与父空间逆变换；替代文字写 `cNvPr@title/descr`
且与对象名称互不覆盖；节以稳定 SlideId 重建成员关系；页面尺寸 0.6 只开放“最大化”语义，不暗中执行
PowerPoint“确保适合”的全元素重排。所有命令都必须支持来源恢复、恢复日志、协同与保留型保存。

验收：每组能力有确定性固件和严格非法输入契约；撤销重做、跨页/组边界、删除/复制页后的节不变量、补丁与
生成保存、LibreOffice 打开/几何 oracle、公开 editor/adapter seam 和真实 Chrome 反馈预算通过，四段仓库
门禁全绿。

## Answer

`DistributeElements` 与对齐共用格式无关的世界 AABB，再把中间对象的世界位移逆变换回各自父空间；命令只
接受同页至少三个可移动最外层对象，固定视觉首尾并原子提交全部稀疏坐标覆盖。替代文字从 `cNvPr@title`
与 `@descr` 建立独立 Source Value / Override，和对象名称互不覆盖，两个字段都可分别用 `null` 恢复来源。

节状态以稳定 `SectionId` / `SlideId` 建模。普通复制、删除与移动页只增量维护来源 section XML；显式节命令
才把 `edited` 置真并按模型重建 `p14:sectionLst`，因此无编辑保存仍逐字节相同。节补丁虽保留完整快照用于
精确撤销，却按“目标节 + state/name/order”寻址；协同接收端只合并对应意图，改名不会覆盖并发复制页产生
的新成员。新增/移动节的锚点意图按逻辑时间、补丁次序与稳定身份形成全序，再从共同基线统一物化；删节与
复制成员页并发时删除旧归属、保留未分节副本。
`SetSlideSize` 严格接受 OOXML `ST_SlideSizeCoordinate` 对应的 96–5376px 闭区间，只写文档画布覆盖，
明确采用 PowerPoint“最大化”语义，不移动或缩放任何元素；
挂载视图在同一提交帧同步 stage、静态 SVG 与交互 viewBox。

## Evidence

- 确定性固件 `sample-editor-common-commands.pptx` 覆盖 3 页、5 个对象、来源替代文字、未知 XML 属性、
  两个节与 1280×720 画布；连续生成 SHA-256 均为
  `c52388f17d6b88a9d5d36e5d05fb78b74bff7abb652d6eb6233e2e7c1944f07a`。
- 模型、非法输入、单帧恢复、撤销重做、复制/删除页节不变量、字段级协同、补丁/生成保存和 67/67 份
  无编辑保存逐字节同一均通过；全固件达到 76 份 / 252 页 / 504 对原始 SVG 等价指纹。
- LibreOffice 打开并导出 9,725-byte PDF；对象分布 frame/间隙最大偏差为 1.8/2.0 SVG unit，页面为 16:9。
  真实 Chrome 分布误差 0.012px、反馈 p95 0.2ms，页面尺寸三层同步 p95 0.2ms。
- `npm run check && npm test && npm run build && npm run verify` 全绿：4,394 项断言，其中 core 2,188、
  edit-core 1,050、保存 482、PowerPoint 证据 9、editor 405、adapter 9、collab 121、metafile 130。
