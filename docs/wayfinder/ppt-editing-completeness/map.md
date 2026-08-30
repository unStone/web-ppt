---
title: 补齐 0.6 高频编辑能力
status: open
labels:
  - wayfinder:map
tracker: local-markdown
---

## Destination

让 Web-PPT 0.6 从“可以编辑”走到“高频编辑够用”：表格结构、项目符号、预设形状、字符格式、常用对象与
页面命令、触屏操作和批量图片导出都通过公开无框架 API、历史、恢复、协同、两种保存路径和真实浏览器验收；
默认查看路径与未使用能力不承担新增运行时成本。完成态是代码与文档达到可发版状态，不包含外部 tag 或发布动作。

## Notes

- 领域词汇沿用 [CONTEXT.md](../../../CONTEXT.md)；路线与取舍见[能力盘点与演进路线](../../roadmap.md)，
  既有基础设施与历史决策见[纯 Web PPT 编辑能力](../ppt-editor/map.md)。
- 必须遵守根目录 `AGENTS.md`：`render/` 只依赖 `types.ts`，格式按魔数识别，两条文本路径不合并，
  `core` / `edit-core` 不依赖 DOM；新能力必须是按需入口或可 tree-shake 的零默认成本加法。
- 命令必须是严格纯数据边界，`null` 表示恢复 Source Value，显式“无”使用独立值；历史、恢复与协同不能
  通过数组下标寻址会漂移的结构。
- 每张实现票都必须覆盖确定性固件、模型不变量、撤销重做、恢复/协同、补丁保存与生成保存、独立进程
  等价指纹、LibreOffice ground truth、公开 editor seam 和真实浏览器性能；Windows PowerPoint 证据只登记
  工件，不伪造本机没有的成功报告。
- 完成后运行 `npm run check && npm test && npm run build && npm run verify`；性能预算沿用旧地图，
  不因功能变多而放宽。
- 本地 Markdown 票据以 `tickets/*.md` 表示；`status: open`、无 `assignee` 且 `blocked_by` 全部关闭的票据
  位于前沿。一次会话最多关闭一张票，开始实现前先写 `assignee: /root`。

## Decisions so far

<!-- 已关闭票据只在这里留一句索引；详细答案只写进对应票据。 -->

- [表格结构编辑](tickets/001-table-structure-editing.md)：稳定行列身份、tombstone 可见性与完整合并真值共同保证
  插删、合并、保存和协同始终指向同一逻辑单元格。

## Not yet specified

- 图片透明度/灰度/双色调、画布 AT 语义与 File System Access 都是真实缺口，但现有路线没有证据证明它们
  应挤进 0.6。等七条既定能力产生产品使用证据后，再判断是补入本地图还是进入后续地图。
- 0.6 的 beta 反馈周期、精确版本号与迁移提示取决于最终公开 API 形态；在集成验收票关闭前不提前写死。

## Out of scope

- 主题、版式、母版与模板编辑属于后续“模板与主题”地图；图表数据、chartex、媒体插入与官网国际化属于
  后续“数据与保真”地图。
- `.ppt` 二进制写回、SmartArt/OLE/墨迹内部编辑、宏、真三维、模板市场、AI 生成与服务端转换维持既有
  非目标；框架对象仍只开放 frame 能力。
- 直接 PDF 写入器、字体子集化与视频导出不进入 0.6；已有打印 HTML 保持矢量 PDF 路径。
- 创建 tag、推送、npm 发布与 dist-tag 变更是外部发布动作，必须由用户另行授权。
