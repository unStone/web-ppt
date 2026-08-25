---
title: 用稳定页身份重排页面
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./008-command-patch-history.md
  - ./014-editor-session-static-view.md
  - ./041-add-slide-from-layout.md
---

## Question

如何让任意 UI 框架只提交公开纯数据命令
`MoveSlide { id, at: { after: SlideId | null } }`，就能把已有页或会话中新页移动到稳定身份锚点之后，
并让缩略图顺序、已挂载 view/edit 视图、动态页码、相对跳页、撤销重做和最终 `.pptx` 同时一致？
本票只做页序重排；删除、复制、换版式、背景、隐藏、备注和 section 管理分别拆票。

`id` 与 `at.after` 使用稳定 `SlideId`，不使用会因并发插页失效的数组下标；`after: null` 表示置首，
锚点不得等于目标页。命令必须是可结构化克隆的纯数据，拒绝未知页、未知锚点、畸形 `at`、额外字段和
只读文档；已经位于目标位置时返回空 patch、不得新增历史。多条 `MoveSlide` 可在一个事务中按提交顺序
求终态，任一条非法都必须在模型、选择和历史变化前整笔回滚。

页序 patch 必须只表达顺序，不通过删除再插入页面树伪装移动，避免复制整页元素快照并错误触发
`createdSlides/removedSlides`。提交、撤销与重做只失效真正受页序影响的动态页码/相对跳页和对应页面；
普通元素投影与未受影响 DOM 分区保持身份。当前选区不因移动清空，挂载在被移动页上的视图保持该稳定
页身份，其他视图只在自身动态内容变化时刷新。

保存只重排 `ppt/presentation.xml` 的 `p:sldIdLst/p:sldId`，并刷新确实含页码字段的 slide 缓存文字；
原 `@id` 与 `r:id` 必须保持不变；
`ppt/_rels/presentation.xml.rels`、slide part、notes、媒体、Content Types、section 成员及未知扩展均保持
逐字节或节点身份。若同一 section 内存在 `p14:sldIdLst`，成员顺序应跟随最终页序，但移动不得把页面
静默换到另一 section。保存后撤销/重做、连续保存、已有页与新增页混排都必须恢复精确顺序；动态页码
字段缓存与独立进程投影一致，LibreOffice 无修复打开。

确定性固件至少包含三页、两个 section、高位且非连续的 presentation slide id / rId、notesSlide、
相对跳页、页码字段和尾随未知 XML。Node 从公开命令验证置首/置中/置尾、已有页与新增页混排、批量、
空操作、非法输入、历史、动态字段、保存差异、重开和保存后历史；真实 Chrome 验证多视图稳定页身份、
view/edit 共用结果及框架订阅可据 `dirtySlides` 精确更新。200 页连续重排从命令到模型提交 p95 不超过
16ms；单次保存除 presentation 与含页码字段的 slide 外不重写其它 part，并记录实测。

## Resolution

公开命令采用稳定页身份与锚点：`MoveSlide { id, at: { after } }` 只生成专用
`SlideOrderPatch`，不复制页面树，也不伪造增删事件。合法批量按提交顺序在一个事务求终态；非法输入整笔
回滚；空操作不写历史。`movedSlides` 与统一的 `SlideChangeSets` 是框架订阅 seam，选区和已挂载 view/edit
视图继续绑定原 `SlideId`。

动态页码按形状、普通文本框和表格中的实际 `slidenum` 字段建候选索引，再按有效投影过滤失效与保存。
用户显式改写字段后会与 OOXML 写回一致地降级为普通 run，不再收到页序脏通知或触发页面字段重写；未改写
字段和相对跳页只增量刷新受影响分区。保存以 `sourceSlideParts` 做 O(n) 页序比较，只重排 presentation
中的页节点和 section 内成员顺序，并刷新仍含动态页码的 slide 缓存；原 slide id、rId、notes、关系、
Content Types 与未知 part 保持身份。

| 验证 | 结果 |
|---|---|
| 公开命令、历史、置首/中/尾、合法/非法批量、已有页与新增页混排 | `edit-core` 560 项通过 |
| 最小保存、字段普通化、重开、连续保存、保存后撤销/重做 | 保存 142 项通过；3 页单次保存 1.0ms，仅 4 个 part 变化 |
| view/edit 多视图、稳定 DOM 身份、框架订阅 | `editor` 252 项与真实 Chrome 通过 |
| 性能 | Chrome 200 页连续重排 p95 2.2ms，低于 16ms 预算 |
| 渲染与桌面兼容 | 3 页 × HTML/SVG 独立指纹一致；LibreOffice 无修复导出 41,563-byte PDF |
| 确定性 | 固件 SHA-256 `2f4fbc0b716e7db2d2179d33478e1d8e3aed7922717728fda23925c7b5546999`；全固件树双生成哈希均为 `0b3450da51f2a85f006fcdce1ce85729539044371e3d26c115f86f0d1c812013` |
| 全仓门禁 | core 2120、图元 130、49 份固件 149 页的 298 对 SVG 指纹通过；五个发布包构建成功 |

自动 Office 工件 `move-slide.pptx` 已进入清单；当前 macOS 环境没有执行 Windows PowerPoint COM，不能宣称
该项已通过。页面删除、复制、换版式、背景、隐藏、备注与 section 管理仍保持独立票据边界。
