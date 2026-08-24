---
title: 按现有版式新增可立即编辑的页面
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./006-preserving-xml-tree.md
  - ./007-zip-passthrough.md
  - ./008-command-patch-history.md
  - ./040-add-preset-shape.md
---

## Question

如何让任意 UI 框架通过公开纯数据命令
`AddSlide{ layoutId, at: { after: SlideId | null } }`，按当前演示文稿中的真实版式新增一页，并让它在同一次
提交后即可切换、预览、选择占位符、输入文字、撤销、重做、保存和重开，而不是复制某张示例页、由工具栏
直接修改 DOM，或为新增页另造一条渲染链路？本票只新增页面；删除、复制、拖拽排序和切换既有页版式另行拆票。

默认解析路径不得为编辑付出布局目录或 XML 保留成本；仅 `edit` 模式公开确定性的 layout catalog，并让既有页
记录稳定 `layoutId`。目录中的模板必须表达版式和母版投影后的背景图形、占位符类型/索引/几何/文字样式及
默认形状源，但普通标题、正文和对象占位符不得把模板提示文字带进新页内容。日期、页脚和页码等字段占位符
保持字段语义。新页继续投影为既有 `Slide`，view/edit、SVG/HTML 两条预览和导出均走现有 core 渲染器。

`Editor.exec(AddSlide)` 只生成一个可逆 `SlideTreePatch`，其中封装页面记录和直属元素记录；返回值与
`EditorChange` 显式暴露 `createdSlides` / `removedSlides`，供无框架、React、Vue 等适配器在命令完成后调用
既有 `setSlide`，无需猜测 ID 或扫描文档。命令原子分配会话稳定且不复用的 `SlideId`、新 slide part、
presentation relationship id 和不小于 256 的数值 `p:sldId@id`；撤销/重做必须恢复同一身份，失败则连同
身份水位、选区和文档一起回滚。插入位置使用稳定 `after` 引用，失效引用和未知版式必须拒绝整笔事务。

保存必须从原包基线最小更新 `ppt/presentation.xml` 的 `p:sldIdLst`、
`ppt/_rels/presentation.xml.rels`、`[Content_Types].xml`，并创建唯一的
`ppt/slides/slideN.xml` 与 `ppt/slides/_rels/slideN.xml.rels`；后者只引用选定版式。若锚点页属于 section，
新页同时加入相同 section 的同位。所有插入遵循 ECMA-376 sequence，未知节点、前缀、属性顺序、其它关系和
其它 ZIP part 原位保留。连续保存不得重复关系或 Override；保存后撤销要删除新增 part 与全部引用，重做恢复。

编辑模式要为尚无内容的标题/正文/对象占位符绘制仅存在于 interaction 层的轮廓和简短提示，并提供稳定命中，
双击后复用现有文字编辑器；这些辅助视觉不得进入 view 模式、静态 SVG、PNG、打印或保存文件。新增页切换不能
重建会话或丢失其它视图状态，多 edit/view 挂载应收到同一份增量变更。

确定性固件至少包含标题正文与空白两种版式、自定义主题、已有高位/有缺口的 part/rId/sldId，以及
`presentation.xml`、关系和 Content Types 中的尾随未知内容。Node 先验证公开命令、非法输入、投影、选区、
历史、事务回滚、section、连续保存、撤销后保存、重开和只改预期 OPC parts；保存前后的 HTML/原生 SVG 必须在
独立进程逐页指纹一致。真实 Chrome 验证新页立即切换、占位符命中与文字输入，以及连续新增到 20 页时命令到
完整反馈 p95 不超过 16ms；edit 有辅助框而 view 无。LibreOffice 必须无修复打开，导出页数、版式背景、
占位符几何和输入文字均与浏览器投影一致。

本票不创建新的空白演示文稿，不实现页面缩略图栏 UI、页面删除/复制/重排、跨文稿版式导入、版式切换、母版
编辑、图片或表格插入。工具栏和框架包只消费公开命令、订阅与 `setSlide` seam，不进入 `core`、`edit-core`
或基础 DOM 包。

## Resolution

以公开纯数据命令 `AddSlide { layoutId, at: { after } }` 完成闭环。`core` 仅在 edit 解析中建立真实
layout catalog，版式与母版继承先投影到统一 Schema；新页沿用现有 HTML/SVG 渲染链路，普通占位符不带入
提示文字，页码字段保留多 run 格式并随最终页序求值，内部跳页链接也按当前页序动态投影。

`edit-core` 用一个 `SlideTreePatch` 原子创建页面与直属元素，并维护不复用的模型/part/rId/sldId 身份；
`createdSlides` / `removedSlides` 同时进入命令结果和订阅事件。撤销、重做、失败回滚与同锚点连续插入均恢复
同一身份。页码和跳页链接用索引化失效，不让插入一页触发尾部全部元素重投影。

保存只新增 slide/rels part，并最小更新 presentation、关系与 Content Types；section、版式关系、后续粘贴
资源关系和连续保存均保持一致。元素、规范无前缀属性都按展开名精确匹配，未知同名扩展、前缀、属性顺序、
其它关系和 ZIP 条目原位保留。edit 视图把空占位符提示限制在 interaction 层，双击复用现有文字编辑器；
view、静态 SVG、导出和保存文件不含辅助 UI，多视图以既有 `setSlide` 切换。

验收证据：确定性固件 SHA-256 为
`07d5bd40a71f13442b9fa0251326527305aa6d20d4d7662a069f22462ce523f3`；core 2120、edit-core 499、
保存 89、editor 250 项断言全绿，45 份固件 / 143 页 / 286 对独立进程 SVG 指纹一致。真实 Chrome 连续
新增到 21 页几何偏差 0、完整反馈 p95 3.3ms；LibreOffice 无修复打开 3 页与 2 页产物，版式/占位符几何
最大偏差 2.250 SVG unit。最终 `npm run check && npm test && npm run build` 全绿；实测编辑主图
59.47KB gzip、首次保存增量 8.30KB、DOM editor 入口 30.53KB。规格与工程规范双人复审均为 Findings 0。
