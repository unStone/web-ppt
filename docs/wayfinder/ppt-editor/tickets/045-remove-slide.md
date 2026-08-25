---
title: 删除页面并完整清理其 OPC 身份
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
---

## Question

如何让任意 UI 框架只提交可结构化克隆的公开命令 `RemoveSlide { id: SlideId }`，就能删除已有页或会话
新增页，并让页序、缩略图、多 view/edit 挂载、选区、动态页码/相对跳页、历史和最终 `.pptx` 同时一致？
本票只删除整页；页面复制、换版式、背景、隐藏、备注内容编辑与 section 管理分别拆票。

命令使用稳定 `SlideId`，拒绝未知页、额外字段、只读文档和删除唯一剩余页；保留至少一页是编辑文档与
已挂载视图的可用性不变量，UI 可直接据 `slideOrder.length` 禁用最后一次删除。一次删除只生成一个可逆
`SlideTreePatch`，快照包含完整页面/元素树与删除前相邻身份；撤销/重做恢复同一 ID、元素、覆盖、选区和
原位置。批量删除按命令顺序执行，任一失败必须在模型、身份水位、选择和历史变化前整笔回滚。

`TransactionResult` / `EditorChange` 只把目标放入 `removedSlides`，不得伪装移动；同时公开
`removedSlideFallbacks`，为每个被删页给出最终仍存活的最近后继，若无后继则取最近前驱。框架和基础 DOM
视图都消费该映射：挂载在被删页上的 view/edit 自动切到同一 fallback，关闭输入与手势并完整重渲；其它
视图只更新真正受页数变化影响的动态字段，静态 DOM 身份保持不变。被删页内的全局选区必须清空。

保存从 `sourceSlideParts` 与当前页序推导删除集，不为整页另存一份可变 tombstone。必须从
`ppt/presentation.xml` 删除对应 `p:sldId` 和所有 section 成员引用，从 presentation rels 删除对应关系，
删除 slide part 与其 `.rels`，并删除仅由该页拥有的 notesSlide 及 notes rels；若畸形文件让 notes 被其它
活动页共享则保留。`[Content_Types].xml` 删除相应 slide/notes Override。媒体、图表、版式、notesMaster、
评论或未知关系目标不做级联删除，避免误删共享/未知数据。未触碰 part 原始 ZIP 字节必须直通。

会话新增页在首次保存前又删除应净化为空操作；新增页保存后再删除则完整清理其已生成 parts。删除前发生的
元素编辑不得让已删 slide part 被基线逻辑复活。保存后撤销恢复原包逐 part 内容，重做再次得到确定性删除包；
连续保存进入 identity。section 节点及其未知属性/扩展保持，只删除成员身份；页码字段缓存与独立进程投影
一致，LibreOffice 无修复打开。

确定性固件至少含四页、两个 section、高位非连续 sldId/rId、每页动态页码/相对跳页、独立 notes、共享媒体、
presentation/关系/Content Types/section 尾随未知内容。Node 从公开命令验证首/中/尾删除、最近 fallback、
合法/非法批量、最后一页保护、历史、选择、动态字段、已有/新增页生命周期、最小保存、重开和保存后历史；
真实 Chrome 验证多个 view/edit 的 fallback、未删视图 DOM 身份与框架订阅。200 页连续删除到 1 页的模型
提交 p95 不超过 16ms；单次保存只改/删必要 part 并记录实测。生成 Office 工件，LibreOffice 验证页数、
notes 归属与渲染；Windows PowerPoint COM 留给已有自动清单环境。

## Resolution

公开命令采用稳定页身份：`RemoveSlide { id }` 生成一个可逆 `SlideTreePatch`，快照保留完整页面树及前后
邻居，因而撤销能恢复同一页面、元素覆盖、选区与位置。批量命令仍只形成一条历史；删除唯一剩余页、未知页、
额外字段或只读提交都会整笔拒绝。`removedSlideFallbacks` 把最终仍存活的最近后继（否则前驱）公开为框架
订阅 seam，基础 DOM view/edit 同样消费该映射并关闭旧页输入与手势，未删视图保持 DOM 身份。

保存删除集由 `sourceSlideParts`、当前页序与会话新增 part 精确求差：移除 presentation 页身份、关系、section
成员、slide part/rels、仅由该页拥有的 notes part/rels 及对应 Content Types；共享 notes 与媒体、图表、版式、
notesMaster、评论、未知目标均不级联。已删原页只允许其精确基线闭包暂时脱离包，防止早先元素编辑复活页面，
也防止无关缺失 part 被误放行。首次保存前新增再删除是包级空操作；保存后的撤销、重做与连续保存保持确定性。

| 验证 | 结果 |
|---|---|
| 公开命令、首/中/尾删除、fallback、最后一页保护、批量原子性、覆盖/选区历史 | `edit-core` 572 项通过 |
| 最小保存、共享 notes、已有/新增页生命周期、保存后撤销/重做 | 保存 164 项通过；4→3 页单次保存 1.4ms |
| view/edit 多视图、fallback、稳定 DOM 身份、框架订阅 | `editor` 257 项与真实 Chrome 通过；两路最终审查 0 findings |
| 性能 | Chrome 200→1 页连续删除 p95 2.4ms，低于 16ms 预算 |
| 渲染与桌面兼容 | 删除结果 3 页 × HTML/SVG 独立指纹一致；LibreOffice 页序、notes 与 37,298-byte PDF 一致 |
| 确定性 | 两固件 SHA-256 `4b7cc1e8…1594` / `d219244c…239e`；全固件树双生成哈希均为 `8af32937…2881` |
| 全仓门禁 | core 2120、图元 130、51 份固件 157 页的 314 对 SVG 指纹通过；五个发布包构建成功 |

自动 Office 工件 `remove-slide.pptx` 已进入清单；当前 macOS 环境没有执行 Windows PowerPoint COM，不能
宣称该项已通过。页面复制、换版式、背景、隐藏、备注内容与 section 管理仍保持独立票据边界。
