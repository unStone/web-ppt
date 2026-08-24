---
title: 实现元素复制剪切粘贴
status: closed
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

- `@web-ppt/edit-core` 公开版本化、纯 JSON 的 `copyElements` / `PasteElements`：复制只保留同父级最外层根，
  载荷身份与会话 id、源 part 路径无关；粘贴为目标 part 原子分配新 EditDoc id、spid、层级和世界坐标落点。
  嵌套组、翻转/旋转父空间、多选、跨页、连续再制与失败后的身份回滚共用一条 headless 命令路径。
- OOXML 宿主、关系闭包和媒体以 SHA-256 + base64 迁移；同内容媒体复用 part，复杂 SmartArt 等对象以内容关系图
  确认同包闭包，跨文档不能无损迁移时在落模前拒绝。解析期 blob/Worker asset 地址经公开 `OpcPackage.assets`
  变成可跨编辑器和源文档释放后使用的资源 token；媒体 part 分配、资源水合、去重和宿主校验均为单次索引。
- 保存、插入与再次复制复用统一的删除→嵌套插入→覆盖物化管线。原始组合的未保存后代修改与删除会进入副本；
  新粘贴树删除后代虽不留 tombstone，仍会按插入时固化的 spid 差集剪除失活宿主。保存重开契约验证组合子数
  `2/1/1`，无后代复活、spid 歧义或关系丢失。
- `@web-ppt/editor` 接通同步 `ClipboardEvent` 的 MIME/text 双写、cut 单事务和 `Ctrl/Cmd+D`；edit 事件视图独占，
  view、文本选区、表单/contenteditable、开放/封闭 Shadow DOM 与活动手势保留浏览器所有权。粘贴、撤销、重做
  只更新影响分区，未触碰兄弟与 defs 保持 DOM 身份；React、Vue、Web Component 宿主可直接映射相同生命周期和命令。
- 最终全量门禁通过：1987 项 core、352 项 edit-core、28 项 M1 保存、140 项 editor、162 个快照、37 份固件 /
  132 页 / 264 对独立进程 SVG 指纹及 130 项图元文件；五个发布包构建成功。真实 Chrome 的 10/20/40 根载荷
  体积保持线性，60 根可信剪贴板完整 DOM 反馈 p95 `8.0ms`，低于 `16ms` 预算。
- LibreOffice 无修复打开 `out/edit-save/element-clipboard.pptx` 并导出 `33494-byte` PDF；最终构建实测
  edit-core `16.56KB gzip`、editor `19.94KB gzip`。Spec 与 Standards 双轴审查发现的跨会话资源、完整子树
  物化、负手性组合、事件所有权及平方级路径均已回归，最终均 clean。
