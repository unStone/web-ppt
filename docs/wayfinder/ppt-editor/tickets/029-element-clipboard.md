---
title: 实现元素复制剪切粘贴
status: open
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./028-element-alignment.md
---

## Question

如何通过公开、版本化、可 JSON 序列化的 `ElementClipboardPayload` 与
`PasteElements { payload, at: { parentId, x, y } }`，让 headless `Editor`、无框架 DOM 编辑视图及不同
React/Vue/Web Component 宿主之间复制、剪切、粘贴一个或多个元素树，同时保持用户看到的世界坐标相对布局、
组层级、样式、文本、框架对象预览和可撤销历史？`copyElements(doc, ids)` 只收最外层可复制根并输出与会话 id、
源 part 路径无关的载荷；粘贴必须为每个记录分配新 EditDoc id、为目标 slide part 分配不冲突的新 spid，
插入到目标父级最上层并把选区切到新根。粘到组合内时先以幻灯片坐标定位，再反算到目标组子空间；目标点是
全部复制根视觉 AABB 的新左上角，多根与组内后代保持相对位置和绘制顺序。

载荷既要保存可直接建立有效投影的纯数据子树，也要携带补丁保存所需的 OOXML 宿主片段、关系闭包与二进制
资源（base64 + SHA-256）。同一文档、跨页及跨编辑器实例都走同一命令；目标包已有相同 SHA-256 媒体时复用
part，不重复字节，否则分配新媒体 part、Content Type 和目标 rel，重写片段内 `r:id`。图表、SmartArt、
OLE、墨迹、音视频等关系闭包若不能无损迁移，整次跨文档粘贴必须在落模前明确拒绝，不能静默降级成图片或
留下悬空关系；同文档复制仍可安全复用它们的现有关系目标。只读文档、只读/锁定根、无效版本、重复或嵌套
根、跨来源混合载荷、非法 base64/hash、不可写目标组及身份/关系冲突都必须原子拒绝。

编辑视图监听同步 `copy` / `cut` / `paste`，以 `application/x-web-ppt-elements+json` 与 `text/plain` 双写；
`Ctrl/Cmd+C/X/V` 由可信剪贴板事件完成，不能直接调用受权限限制的 `navigator.clipboard`。只有收到事件的
edit 视图拥有操作；view 模式、文本/表格选区、普通或 Shadow DOM 表单/contenteditable、活动 pointer 手势
保留浏览器所有权。cut 先成功写入载荷，再以一个事务删除全部根；`Ctrl/Cmd+D` 不碰系统剪贴板，按当前视觉
边界偏移 `10px` 原位再制。粘贴或再制形成一个撤销单元，撤销/重做恢复元素树、选区、dirty、资源引用和 DOM；
未触碰兄弟与 defs 保持身份，大批量才允许整页回退。

保存后重开必须保留新元素、关系与资源，两条 SVG 文本路径独立进程指纹与保存前有效投影一致，未触碰 OPC
条目原始直通，LibreOffice 打开不得报告修复。确定性固件覆盖普通/旋转元素、多选、嵌套组、图片重复媒体、
超链接、框架对象、只读与跨页/跨文档；真实 Chrome 中 60 元素复制后粘贴到完整 DOM 反馈 p95 不超过
`16ms`，载荷大小与粘贴耗时必须随复制子树/资源线性增长。

TDD 只从三条既定公共 seam 验收：发布的 `copyElements` + `Editor.exec(PasteElements)`；
`openEditor(...).mount(...)` 的真实 ClipboardEvent/可信快捷键与增量 DOM；`editor.save()` + core 重开、独立
进程指纹与 LibreOffice。本票不实现文本编辑态粘贴、外部图片/HTML 导入、分布/组合、新建任意形状或资源
可达性清理；这些能力只能复用本票建立的身份、关系和媒体插入边界，不能另建旁路。

## Resolution

<!-- 完成后记录答案、证据与后续发现。 -->
