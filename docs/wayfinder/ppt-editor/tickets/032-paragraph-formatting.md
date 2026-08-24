---
title: 实现文字段落格式编辑闭环
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./031-run-formatting.md
---

## Question

如何沿用已经稳定的扁平文本模型、DOM Range、公开工具栏 seam 与最小 OOXML 写回，让用户对当前段或跨段选区设置
水平对齐、行高、段前、段后、左边距和首行缩进，同时保持继承、撤销重做、多视图与预览排版一致？

发布命令为纯 JSON `SetParaProps { id, range, props }`。P0 `props` 只允许 `align`、`lineHeight`、
`spaceBefore`、`spaceAfter`、`marginLeft`、`indent`；`null` 删除当前段的直接覆盖并恢复形状列表样式、版式、母版或
文档默认的继承结果。折叠选区立即修改光标所在段，非折叠选区修改首尾段在内的全部段；空段、RTL 段、公式段、
字段段及由 Enter 新建且共享来源的段都使用相同语义。命令必须原子校验，无变化时不得制造历史。

`lineHeight` 沿用 core `Paragraph.lineHeight` 的有效行盒倍数；百分比行距写回 `spcPct` 时必须反算 1.2 字体行高基准，
并补回 `normAutofit@lnSpcReduction`，保证有效投影与保存重开相等。段前后以幻灯片 px 暴露并写成 `spcPts`，左边距和
缩进以幻灯片 px 暴露并写成 EMU。混合选区按逐属性三态查询；外置无框架工具栏、React/Vue/Web Component 适配层
只能消费公开 `queryParaProps` / `setParaProps`，不能把段落真相藏进 DOM。

保存只修改目标 `a:pPr` 的对应属性或 `a:lnSpc/a:spcBef/a:spcAft`，新建节点严格遵守 OOXML sequence；未知属性、
项目符号、`defRPr`、`extLst`、注释、处理指令、相邻 run、段落顺序和未触碰 ZIP 条目必须原样保留。只有文本内容或
段落数量已经改变时才允许沿既有重建路径克隆来源段落，不能为了段落格式重建整个 `a:txBody`。

确定性固件覆盖形状 `lstStyle` 继承、直接绝对行距、自动缩放行距压缩、跨段与空段、负首行缩进、未知 pPr 节点；
保存重开后的逐段属性、HTML 与原生 SVG 独立进程指纹必须等于编辑投影，LibreOffice 打开不得修复。真实 Chrome 验证
Range 保留、外置工具栏、多视图和 view 模式隔离，文字完整上屏 p95 继续不超过 `30ms`。

本票不实现项目符号、段落级 RTL/层级、制表位、竖排/分栏/内边距、富文本粘贴、表格单元格、产品工具栏 UI 或
框架适配包；它们后续复用本票稳定的段落命令与查询 seam。

## Resolution

- 以稀疏 `paragraphOverrides`、来源直设字段索引和继承有效值建立段落真相；`SetParaProps` / `queryParaProps`
  覆盖六个 P0 属性、折叠/跨段/空段、严格 no-op、原子校验、撤销重做与远端 Patch 白名单。
- `SlideEditor` 公开无框架 `queryParaProps` / `setParaProps`，复用真实 DOM Range；外置工具栏不会抢焦点，
  多视图同步且 view 模式隔离。真实 Chrome 连续 40 次完整提交 p95 为 0.4ms（预算 30ms）。
- 保存仅就地补丁目标 `pPr`；同类 spacing 子节点保留厂商属性，未选中的注释/PI-only `pPr` 不触碰；
  文本重建路径先挂接命名空间再克隆，保存重开后的 HTML/SVG 独立进程指纹与投影一致。
- 确定性固件连续两次聚合 SHA-256 均为 `8b6bdcd495ab3e2b97d2312c7ee3267c2458a019306078726b3c2748014f6325`；
  LibreOffice 无修复打开并导出 47,932-byte PDF。双轴复审修复 5 项后，规范/规格 finding 均为 0。
- `npm run check && npm test && npm run build` 全绿：1987 core、395 edit-core、32 保存、169 editor、
  38 份固件 133 页 266 对双文本路径指纹、130 metafile；210 页内存 +9.9%，50.6MB 改 3 页保存 120.2ms。
  发布实测 edit-core 主入口 43.48KB gzip，editor 24.76KB gzip，两个 tarball dry-run 均通过。
