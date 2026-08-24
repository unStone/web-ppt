---
title: 实现元素删除与占位符两段式清空
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./025-history-shortcuts.md
---

## Question

如何让聚焦的 edit 视图通过 `Delete` 或 `Backspace` 删除当前元素选区，并把一次用户操作作为一个可撤销
事务最小写回 `.pptx`？删除组时必须递归移除组内记录，撤销后稳定恢复原 parent、z 序、选区、dirty
状态和增量 DOM；多选删除不能因祖先与后代重复出现而产生孤儿。图表、SmartArt、OLE、墨迹与媒体虽然
内部不可编辑，但其框架本身必须可以删除，相关媒体和关系字节暂不做可达性清理，避免误删共享资源。

占位符遵循 PowerPoint 两段式语义：仍有用户内容时第一次删除只清空文本并保留 `p:sp`、溯源身份与版式
继承，使编辑态回到空占位符；再次删除才移除占位符节点。一次多选中，普通元素与空占位符删除，有内容的
占位符仅清空，整体仍是一个历史事务；提交后的选区只保留仍存在的占位符，否则变为 none。

只有收到事件的 edit 视图拥有快捷键；view 模式、普通或 Shadow DOM 表单与 contenteditable 必须保留
浏览器所有权。恰好无 Alt/Ctrl/Meta 修饰的 `Delete` / `Backspace` 才识别，Shift 不改变语义；活动 pointer
手势只消费默认行为而不打断预览或修改历史。没有元素选区时仍消费已识别键，但不创建历史。嵌套挂载只由
最内层视图处理一次，事件视图回显历史恢复页，其它共享视图保持原页。

验收只经过发布的 `openEditor(...).mount(...)`、公开 headless 命令/历史/选区、保存重开、独立进程 SVG
指纹与真实 Chrome 可信键盘输入。未触碰的 zip 条目必须原始直通；目标 slide part 只删除目标 `p:sp` /
`p:pic` / `p:graphicFrame` / `p:grpSp` 节点或最小清空目标 `a:txBody`，LibreOffice 打开不得报告修复。
60 元素多选删除、撤销与重做到完整 DOM 反馈 p95 均不超过 `8ms`。

本票不实现剪贴板、资源垃圾回收、选择窗格、层级命令、删除幻灯片、文本光标态退格、空占位符提示 UI，
也不提前建立完整 M3 的扁平富文本编辑面；占位符清空只建立后续 `EditText` 可复用的最小模型与写回边界。

## Resolution

- `@web-ppt/edit-core` 新增纯 JSON `RemoveElement` 与结构/空文本双向 patch：组合快照递归保存，逆向按稳定
  z 序恢复 parent、选区与 dirty；同批重叠树和会产生顺序依赖的“修改后删除”在落模前拒绝，事务失败整体回滚。
- 占位符两段式语义落在 headless 命令而非 DOM：有内容时先写 `{ text: { kind: 'empty' } }`，再次执行才
  进入删除集。保存只移除目标 OOXML 宿主或替换 `a:p` 序列，保留 `bodyPr`、`lstStyle`、rels 和媒体。
- `@web-ppt/editor` 只在 edit 事件视图接管无 Alt/Ctrl/Meta 的 `Delete` / `Backspace`；多选先归一祖先根。
  删除与撤销增量移除/插回 markup/defs 分区，两个共享视图的未触碰兄弟 DOM 身份保持不变。
- 确定性固件 `sample-editor-delete.pptx` 连续两次生成均为
  `e22f19380a42f94601fc5b3a898107cb657bf30e851fab04dccd6acdc3ae7e9d`；覆盖普通形状、组合子树、图片、
  图框、两种占位符、共享资源与跨页元素。
- 全量验收通过：1987 项 core、268 项 edit-core、15 项 M1 保存、128 项 editor、162 个快照、35 份固件 /
  128 页 / 256 对独立进程 SVG 指纹、130 项图元文件；`npm run check`、`npm test`、`npm run build` 全绿。
  真实 Chrome 60 元素删除/撤销/重做 p95 为 `3.4/1.5/0.9ms`，可信 Delete/Shift+Backspace 通过。
- 保存产物由 LibreOffice 无修复打开并导出 30361-byte PDF；npm dry-run 确认 `RemoveElement` 类型、保存声明
  与键盘删除声明进入 tarball。实测 gzip：edit-core 初始入口 `11.84KB`、首次保存增量 `14.05KB`，editor
  `18.89KB`。
- 标准审查初检发现过时保存注释与占位符结构删除判定重复，规格审查发现 closed Shadow DOM 会隐藏内部
  input；已分别改为解释保存基线原因、共享单一领域谓词，并把画布键盘所有权收紧为只处理视图根直接事件，
  新增 closed-shadow 回归。修复后沿用同一两位审查者复核，Standards 与 Spec 两轴剩余问题均为 0。
