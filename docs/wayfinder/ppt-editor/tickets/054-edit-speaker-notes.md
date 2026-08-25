---
title: 编辑并保存演讲者备注
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./006-preserving-xml-tree.md
  - ./007-zip-passthrough.md
  - ./008-command-patch-history.md
  - ./014-editor-session-static-view.md
  - ./041-add-slide-from-layout.md
  - ./044-move-slide.md
  - ./045-remove-slide.md
  - ./046-duplicate-slide.md
---

## Question

如何通过稳定 `SlideId` 提供 `SetNotes { id, text }` 与 `querySlideNotes(ids)`，让任意 UI 框架用普通 textarea 编辑演讲者备注，并对已有 notesSlide、没有备注的旧页面和会话中新页都得到同一套可撤销、可保存语义？

备注 v1 是纯文本而不是富文本编辑器：换行映射为段落，空字符串表示显式清空；查询返回 effective/source/mixed/direct，工具栏不能读取 `src/ovr`。命令必须 JSON 可序列化、批量事务原子、只使备注订阅分区变脏而不重绘画布；view 模式只读。页面移动、复制、删除、换版式、新增、撤销重做和保存点恢复后，备注始终跟随稳定页身份，不按瞬时页码绑定。

已有 notesSlide 只修补 body 占位符的 `a:txBody`，保留 notesMaster 关系、slide 回指、其它占位符、格式、外链、图片和未知扩展。原来没有 notesSlide 时，第一次写入才确定性分配 notes part、slide 关系、Content Types Override 与必要回指；清空或撤销不能留下重复关系或在连续保存中持续新建 part。畸形共享 notes 不能被一页编辑而污染另一页：要先获得独立身份或明确拒绝，不能原位改共享 part。未编辑页及其 notes 字节继续直通。

确定性固件覆盖已有多段备注、空备注、无 notes part、新增页、复制页、非规范 part/rId、共享 notes、notesMaster/外链/未知扩展和页面重排。Node 验证命令、混合态、订阅、历史、保存幂等与重开文本；viewer 搜索/备注展示继续读取同一投影。真实 Chrome 验证双编辑视图与 view 只读边界，2,000 字符输入提交 p95 小于 16ms；LibreOffice 验证页面—notes 归属和文本 roundtrip，产物进入统一 PowerPoint 清单。
