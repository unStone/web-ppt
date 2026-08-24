---
title: 让表格末格 Tab 追加可编辑行
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./035-table-cell-text-editing.md
---

## Question

如何让用户在表格最后一个可编辑单元格按 Tab 时，通过公开纯数据
`InsertRow{ id }` 结构命令追加一行、立即进入新行首个可编辑格，并使预览、撤销重做、保存重开与
PowerPoint/LibreOffice 始终看到同一张表，而不是由 DOM 文字控制器私自修改行数组或 XML？

本票只定义当前产品动作所需的“尾部追加”语义：`InsertRow` 不接收含混的行号，目标必须是
`editable=full` 的非空 OOXML 表格；新行复制原末行的高度、单元格直接格式、段落/字符输入格式和
横向合并拓扑，但清空全部内容。已有末行如果受 `lastRow` 样式影响，追加后必须恢复普通行样式；
新末行按 `firstRow/lastRow/bandRow` 与当前绝对行号得到正确样式。表格 frame 高度同步增加一个行高，
宽度、位置、旋转、翻转和列宽不变。

headless 模型不得把整张 `rows` 数组写进历史。追加行使用稳定行身份与稀疏结构覆盖，单次命令的
patch/历史体积为 O(1)，有效投影只新建受影响的末行及原末行；来源 `src` 保持不变。连续追加、
撤销/重做、失败原子性、序列化克隆和未记录 patch rebase 都必须确定；既有按 `r:c` 保存的单元格
文字覆盖不迁移，因为追加不会改变任何来源坐标。

保存从首次触碰的 slide part 基线重建：按稳定 spid 找到 `a:tbl`，克隆原末 `a:tr` 到尾部，保留
`a:tcPr`、未知节点与命名空间，收敛成一个带来源输入格式的空 `a:p`，并同步
`p:graphicFrame/p:xfrm/a:ext@cy`。结构行必须先物化，再让既有单元格文字 writer 按有效行坐标写入，
从而允许用户在新增格继续输入后一次保存；其它表格、页面、ZIP 条目保持原样。

DOM 的 Tab 处理在最后一格提交当前文字后，用一个事务执行 `InsertRow` 并把选区放到新行首个非
合并起始格的末尾；browser/engine 共用既有编辑面，静态表格、命中标记、选择框与 caret 在同一帧
更新，Shift+Tab 和非末格 Tab 行为不变。view 模式不产生命令。

确定性固件覆盖首/末行样式、行条纹、横向合并末行、空格输入格式、连续追加和 20×10 表格。
Node 验证命令校验、稀疏投影、历史、保存重开、只改目标 XML 与两条预览；真实 Chrome 验证可信
Tab、焦点所有权、browser/engine 和 20×10 完整上屏 p95 不超过 30ms；LibreOffice 无修复打开并
以导出结果校验新增行几何。

本票不实现指定位置插行、删除行、增删列、穿越纵向合并区时的 `rowSpan/vMerge` 重基、单元格样式、
列宽行高拖拽或框架视觉工具栏。以上能力必须在稳定行/列身份与合并区变换规则确定后独立拆票；
不能给本票的 `InsertRow` 偷加一个只对简单表格有效的 `at` 参数。

## Resolution

公开 `InsertRow { id }` 只承担尾部追加。`edit-core` 用包含 client-unique `origin` 的稳定 rowId 和
分数序保存稀疏结构；来源格文字继续使用 `r:c`，新增格文字 patch 改为绑定 rowId，因此双
`structuredClone` 客户端并发追加、排序前插、撤销/重做和保存都不会迁移内容。同事务
`InsertRow + EditText` 通过 staged validation 原子重放；行删除 patch 在落模前验证最终单元格覆盖为空。
投影缓存只保留当前有效 rowId，连续追加只重建前一末行和新末行。

core 的 edit-only 表格模板精确保留 `firstRow/lastRow/bandRow` 奇偶态、直接格式、输入格式与横向合并；
普通预览不携带模板。保存从 slide 基线克隆末 `a:tr`，在尾随扩展节点之前插入，清除纵向合并与文字，
保留 `a:tcPr`、段落属性、未知扩展和命名空间，再同步 frame `cy`；结构先物化，既有文字 writer 后写新增格。
DOM 末格 Tab 用一个事务追加并进入新行首格，Shift+Tab、非末格 Tab 与 view 模式保持原语义。

验收证据：

- 确定性固件连续两次重生的聚合 SHA-256 均为
  `607e95f55a2c9cb5818095a46cb070d295edb69f4920cdf80b290578e66983cb`。
- 最终 `npm run check && npm test && npm run build` 全绿：core 2117、edit-core 464、保存 65、editor 237、
  metafile 130 项断言；43 份固件 / 141 页 / 282 对独立进程 SVG 指纹一致，五个发布包构建成功。
- Chrome 20×10 表格末格追加完整上屏 p95 `9.500ms`，可信 Tab、焦点、IME 和 browser/engine 共用编辑面通过。
- `npm run test:edit:m1` 已纳入两个追加行产物；LibreOffice 均无修复导出 PDF，新增行 frame 最大偏差
  `31.250 SVG unit`，表样式/未知 XML 产物也正常打开。
- Spec 与 Standards 双轴终审均为 clean。
