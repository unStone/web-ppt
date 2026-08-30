---
title: 建立可持久化操作日志与确定性恢复原语
status: done
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./008-command-patch-history.md
  - ./054-edit-speaker-notes.md
---

## Question

如何让 headless `Editor` 的每次已应用模型变化都产出可直接写入持久化介质的 JSON 日志，并能在新解析出的同一份文档上安全回放，而不让 `edit-core` 依赖 DOM、IndexedDB 或具体产品生命周期？

日志必须覆盖普通事务、`undo`、`redo` 和 `recordHistory:false` 写入；每帧保存实际应用的完整 patch（包括图片资源）、恢复后的选区、`dirty` 状态和完整身份水位。结构新增后崩溃重开，再新增页、元素、表格行或 OPC 关系时不得复用旧 ID。订阅者异常不能影响已经提交的事务，回放本身不能再次产生日志或历史项。

公开恢复帧需要版本号与严格递增序号，经过 `JSON.stringify` / `JSON.parse` 后语义不变。回放只接受身份前缀匹配、帧结构合法且能通过完整模型不变量的日志；任一帧损坏时不得把目标文档留在部分恢复状态。恢复后 `Editor.isDirty()`、选区和投影必须与崩溃前一致，历史栈从空开始，后续新编辑仍可正常撤销、保存并由 PowerPoint/LibreOffice 打开。

用现有真实固件覆盖文字、变换、图片资源、元素新增、页面新增、撤销与重做的混合日志；对照崩溃前后 `EditDoc` 的 JSON 模型、独立进程 SVG 指纹和保存回环。另加大日志的序列化/回放基准，证明恢复开销随 patch 量增长而不是随原包字节增长。源文件指纹、IndexedDB 追加队列、清理策略与用户恢复提示不属于本票，下一票只通过此公开原语实现。

## Resolution

- `@web-ppt/edit-core` 公开版本化 `RecoveryFrame`、`Editor.subscribeRecovery()`、构造期
  `recoveryFrames` 与 `restoreRecoveryFrames()`。普通事务、非历史写入、undo/redo、选区和保存点都按严格
  序号广播；同步重入仍保持因果顺序，订阅者异常互相隔离，未订阅时不做日志深拷贝。
- 回放先克隆可变模型，逐帧验证后一次性交换；任一坏帧都不会污染目标。恢复保留选区与 dirty/savepoint，
  历史栈从空开始，序号从已恢复尾帧继续。`openEditor()` 在任何 DOM 挂载前完成同一回放，框架 adapter
  以不可变数组引用作为 O(1) options 身份。
- Patch 中的会话图片 URL 改写为 NUL 保留 token 并强制一一对应资源闭包：`.pptx` 以 `sourcePart`
  绑定新解析会话，`.ppt` 内嵌规范 Base64 字节；缺失、多余、非法 MIME/Base64 都原子拒绝。
- 身份校验不信任 `created` / `editable` 等可篡改标志。逻辑 ID、表格 rowId、owning-part spid、slide part、
  presentation slide id/rId 与 notes part 均从原包真实分配器、实际结构 Patch 和历次占用共同推导下界；
  母版/版式继承记录必须与版式目录中的真实 anchor 和完整来源逐字段匹配。空白新页以根组保留
  `nextSpid=2`，新建/复制/备注分叉的实际 OPC 身份不得复用原包或已删除身份。
- 契约覆盖文字、表格追加后撤销、图片、元素/页面新增、空白版式、备注分叉、资源重绑、坏前缀/尾帧/
  序号/选区/时间/身份及独立进程双文本 SVG 指纹；恢复产物保存重开后投影一致。LibreOffice 将最终
  `recovered.pptx` 转为 PDF 1.7，2 页可读。Windows PowerPoint 真机成功不在本机伪造，仍由
  [010 外部验收票](010-prove-m1-save.md) 追踪。
- 最终门禁：core 2135、edit-core 778、保存 307、PowerPoint 证据契约 9、editor 308、框架适配器 8、
  61 份固件 372 对独立 SVG 指纹、图元 130 项全部通过，七个发布包构建成功。210 页 / 50MB、
  1,000 帧实测日志 316.3KB，JSON 序列化 1.6ms、原子回放 269.9ms，低于 500ms 预算；编辑内存
  增量 11.5%。两路独立最终审查均为 0 findings。

下一票只负责源文件指纹、IndexedDB 追加/压缩/清理和面向用户的恢复提示，不把浏览器生命周期反向
引入 headless 包。
