---
title: 复制页面并重建独立 OPC 身份
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./008-command-patch-history.md
  - ./014-editor-session-static-view.md
  - ./041-add-slide-from-layout.md
  - ./044-move-slide.md
  - ./045-remove-slide.md
---

## Question

如何让任意 UI 框架只提交可结构化克隆的公开命令 `DuplicateSlide { id: SlideId }`，就把来源页的当前有效
内容原位复制到它后面，同时为新页和全部元素分配独立稳定身份，使缩略图、多 view/edit、选区、动态页码、
相对跳页、历史和最终 `.pptx` 都不会与来源页串联？任意落点继续由独立 `MoveSlide` 表达，避免一个命令同时
承担复制和排序；本票不做跨文档页面复制、换版式、背景面板、隐藏或备注内容编辑。

命令拒绝额外字段、未知页、只读或非 OOXML 文档。复制的是提交瞬间的完整页面/元素树与稀疏覆盖，不是最初
解析态；页面和每个元素都获得新 `SlideId` / `ElementId`，组父链、绘制序、占位符语义、动态字段索引和
spid 在新 part 内保持，所有 OOXML 回写锚点改指向新页 part。一次复制只生成一个可逆 `SlideTreePatch`，
撤销/重做恢复同一批身份并保持来源页不变；批量任一失败必须在模型、身份水位、选择和历史变化前整笔回滚。
`createdSlides` 只报告副本，`removedSlides` / `movedSlides` 不得伪装变化，框架由新页身份决定是否切换当前页。

保存为副本分配新的 slide part、presentation sldId/rId 和同 section 的成员身份。slide XML 必须从来源页的
有效保存状态重建，slide rels 保留原 rId、外链和未知尾随内容；版式、媒体、图表、SmartArt、OLE、评论及
未知关系目标继续指向原资源，不复制共享字节。若来源存在 notesSlide，则克隆 notes part 与 rels、改写其
回指到新 slide，避免两个活动页共享可编辑备注身份；Content Types 同步增加 slide/notes Override。来源页
随后编辑或删除都不得改变副本，副本编辑也只写自己的 part。

来源可以是原包页、已保存的新页、未保存的 AddSlide 页或另一个未保存副本；保存必须解析复制链而不依赖当前
页序，也不能成环。复制后未保存即删除应净化为空操作；首次保存、连续保存、保存后撤销/重做均确定且可重开。
未触碰的 OPC part 与共享资源继续原始 ZIP 字节直通，section 未知属性/扩展保持。页码字段缓存按新页序更新，
相对跳页按副本位置重新求值。

确定性固件至少含四页、两个 section、高位非连续 sldId/rId、嵌套组、页码/相对跳页、独立 notes、共享图片、
图表/评论/未知关系和尾随未知 XML。Node 从公开命令验证原页/新增页/副本链、身份隔离、历史、非法批量、
来源删除、最小保存、关系图、notes 独立、重开和保存后历史；DOM/真实 Chrome 验证多 view/edit、来源 DOM
身份与框架订阅。60 元素页面复制提交 p95 不超过 16ms，200 页文档复制/撤销完整反馈 p95 不超过 16ms；
记录单次保存实测。独立进程比较来源与副本 HTML/SVG，再生成 Office 工件并让 LibreOffice 验证页数、页序、
notes 与渲染；Windows PowerPoint COM 留给已有自动清单环境。

## Resolution

公开命令采用最小语义 `DuplicateSlide { id }`：它深拷贝提交瞬间的页面树与稀疏覆盖，重新分配稳定
`SlideId` / `ElementId`，把父链、动态页码/跳页索引和 OOXML 锚点整体改到新 slide part，并紧邻来源插入。
任意落点仍由 `MoveSlide` 表达。一个可逆 `SlideTreePatch` 承载整棵副本，批量提交沿用事务回滚，因此撤销、
重做、选区与身份水位不会出现半成品；多 view/edit 和框架订阅只消费公开变化集。

保存层从不可变 `baseline ?? package` 重建副本，而不读取另一个副本的物化结果。原包页、AddSlide 页、已保存
新页和副本链因此都不依赖当前页序；删除→保存→撤销后的 detached source 也能继续复制。新页独占 slide、
presentation 与 notes 身份，slide/notes 关系只改互相回指，共享媒体、图表、评论、版式与未知目标保持原关系。
section 归属在删除来源成员前传播，来源随后删除也不会让副本掉出 section。来源 OPC part 和关系 ID 按规范
接受非 `slideN` / `notesSlideN` / `rIdN` 命名，只有本实现新分配的目标采用规范化路径。

| 验证 | 结果 |
|---|---|
| 公开命令、深拷贝、嵌套父链、覆盖隔离、非法/合法批量与历史 | `edit-core` 582 项通过 |
| 最小 OPC 保存、关系图、section、notes、四类来源与保存后历史 | 保存 198 项通过；4→5 页单次保存 2.4ms |
| view/edit 多视图、稳定 DOM 身份与框架变化集 | `editor` 262 项与真实 Chrome 通过；规格/规范两路复审均 0 findings |
| 性能 | Chrome 的 200 页、60 元素页面复制与撤销完整反馈 p95 均低于 16ms 预算 |
| 渲染与桌面兼容 | 结果 5 页 × HTML/SVG 独立指纹一致；LibreOffice 页序、渲染、独立 notes 与 44,351-byte PDF 一致 |
| 确定性 | 两固件 SHA-256 `11fa1bd6…f2a8` / `dd368603…d6dcb`；全固件树双生成哈希均为 `94d45820…9ae2` |
| 全仓门禁 | core 2120、图元 130、53 份固件 165 页的 330 对 SVG 指纹通过；五个发布包构建成功 |

Office 工件 `duplicate-slide.pptx` 已进入自动清单；当前 macOS 环境没有执行 Windows PowerPoint COM，不能
宣称该项已通过。跨文档页面复制、换版式、背景、隐藏、备注内容编辑与 section 管理仍保持独立票据边界。
