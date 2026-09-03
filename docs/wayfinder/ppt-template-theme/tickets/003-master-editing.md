---
title: 把母版与文字默认值作为设计画布编辑
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./002-layout-editing.md
---

## Question

如何在版式设计画布之上开放母版，而不把母版图形复制进每个版式或页面，也不把 `p:txStyles` 伪装成普通文本框？
母版目录必须保留 OPC part、主题关系和直属版式集合；母版画布复用版式票据建立的元素/背景编辑接口，文字默认值
则以 title/body/other × 9 级的结构化 Source Value / Override 单独查询和修改。

母版图形、背景或文字默认值变化时，反向依赖索引只失效该母版下版式所引用的页面；`showMasterSp="0"`、页面
`showMasterSp="0"`、版式/占位符/段落/run 直设继续按原优先级压过母版。修改文字默认值必须触发九级列表、
主题字体与自动编号重新求值，不能把有效值烘进子级；不同类别和级别在协同中独立收敛。

补丁保存最小修改目标 master part 和必要关系/资源，未触碰的 `hf`、`clrMap`、扩展及未知 XML 保留；生成保存与
`.ppt → .pptx` 物化有效母版和 `p:txStyles`。确定性固件覆盖一个母版多版式、两个母版、母版静态图形、三级以上
文字继承、局部直设和 master-shape 屏蔽；独立进程指纹、LibreOffice 几何/文字 oracle、真实 Chrome 多页传播、
历史/恢复/协同及公开 adapter 全部通过，最终四段仓库门禁全绿。

## Outcome

- `core` 与 `edit-core` 交付母版目录、稳定设计画布和 title/body/other × 9 级文字默认值查询/覆盖；母版元素、
  背景与文字默认值沿既有继承链局部传播，同时保留 `showMasterSp`、占位符、段落和 run 直设优先级。
- 补丁保存最小修改 master part 并保留未知 XML，生成保存与 `.ppt → .pptx` 物化有效母版和 `p:txStyles`；历史、
  恢复、字段级协同、公开 adapter、确定性固件、独立指纹、LibreOffice 与真实 Chrome 证据均完成。
- 修复结构编辑校验误把当前版式当成“设计已变化”而对全部页面元素重复投影的性能回归；改用显式设计变化判定后，
  浏览器结构编辑预算与 `npm run check && npm test && npm run build && npm run verify` 全部通过。
