---
title: 插入可立即编辑的主题表格
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./007-zip-passthrough.md
  - ./008-command-patch-history.md
  - ./014-editor-session-static-view.md
  - ./035-table-cell-text-editing.md
  - ./039-append-table-row-on-tab.md
  - ./040-add-preset-shape.md
  - ./041-add-slide-from-layout.md
---

## Question

如何让任意 UI 框架只调用公开纯数据命令
`AddTable { slideId, rows, cols, rect, placeholderId? }`，就得到立即可见、可逐格输入、可选择、可变换、
可追加行、可撤销、可保存和可重开的原生 PowerPoint 表格，而不是在 DOM 中模拟一张无法写回的网格，
或由每个框架各自拼接 DrawingML？本票只新增规则矩形表格；合并/拆分单元格、插删任意行列、行列尺寸、
单元格填充/边框和表样式切换另行拆票。

`rows`、`cols` 必须是 1–75 的整数，`rect` 必须有限、为正且可写为 PowerPoint EMU；非法输入必须在
分配元素身份和历史前整笔拒绝。列宽与行高用确定性的整数 EMU 均分算法生成，总和必须精确等于表格
frame；不能用逐格浮点累加制造保存重开漂移。常见的 20×10 表格不得因为深拷贝或全页重渲而卡住，
75×75 的格式上限也必须可创建、撤销和保存，不额外设一个让真实文件无法表达的产品上限。

默认视觉必须来自当前文档 `ppt/tableStyles.xml` 的默认样式及当前主题求值结果：首行与横向条纹语义写入
`a:tblPr`，即时 `TableElement` 与最终 OOXML 共用同一组编辑默认值。不得把某套蓝色表头硬编码进
`edit-core`，也不得在重开后才突然换色。文档没有表样式 part 时回退为主题安全的空文本体和可见中性
网格。每个空单元格从创建当刻就带可编辑文字模板；双击可输入，Tab 可跨格，末格 Tab 复用既有
`InsertRow`，而非保存重开后才变得可编辑。

命令一次分配会话稳定且不复用的 `ElementId` 与 part 级 `p:cNvPr@id`，生成合法的
`p:graphicFrame/a:graphicData/a:tbl`，并只提交一个可逆结构事务。`placeholderId` 只允许指向目标页中
空、未锁定、完全可编辑的 `obj` 内容占位符；替换占位符与插入表格必须同生共死。非法、非空或跨页
占位符不得改变身份水位、结构、选区和历史。新元素自动选中，既有移动、缩放、旋转、层级、删除、
复制粘贴、撤销重做与多视图更新均不得新增表格专用旁路。

保存只改目标 `ppt/slides/slideN.xml`；本命令不创建关系、媒体或 Content Types 项。新增页、已有高位
spid、尾随未知 XML、连续保存、保存后撤销/重做都必须保持 sequence 和未编辑字节。保存前后的 HTML 与
原生 SVG 逐页投影用独立进程指纹验证；LibreOffice 必须无修复打开，表格 frame、列线、行线、主题首行/
条纹和输入文字均与浏览器投影一致；真实 PowerPoint 产物加入现有 Office 门禁清单。

无框架 DOM 包公开同步 `insertTable(rows, cols, options?)`：显式 `rect` 直接使用；未给矩形且当前单选空
`obj` 占位符时原位替换；否则按页面与行列数计算居中的可用默认矩形。API 返回新 `ElementId` 并选中它，
view 模式明确拒绝且不产生历史。基础包不内置框架、弹窗或表格尺寸选择器；React、Vue、Web Component
工具栏只消费这个 seam，产品可以自行决定交互外观而不复制命令语义。

确定性固件至少包含自定义默认表样式/主题、高位 spid、空与非空内容占位符、已有兄弟和 `spTree` 尾随
未知节点。Node 先验证公开命令、边界校验、主题投影、均分精度、逐格输入、末格追加、所有既有框架操作、
占位符原子替换、历史、事务回滚、连续保存、撤销后保存、重开和只改预期 OPC part；真实 Chrome 验证
公开 DOM seam、默认矩形、占位符、双击输入、Tab 追加、view/edit 与多视图。60 元素页插入 20×10 表格
从命令到完整反馈 p95 不超过 16ms；75×75 创建与保存记录实测但不伪装成逐帧预算。

## Resolution

`AddTable` 已作为无 DOM 的公开纯数据命令接入既有结构 Patch、选择、历史、投影和保留型保存主干；
`@web-ppt/editor` 同步公开 `insertTable(rows, cols, options?)`，view 模式拒绝写入，edit 模式可直接复用
占位符、文字编辑、Tab 追加、变换、层级、删除和多视图增量更新。

| 决策 | 结果 |
|---|---|
| 默认视觉 | edit-only 解析 `tableStyles.xml` 与当前主题；覆盖 PowerPoint 常用内置默认 GUID，缺失/未知样式回退为主题中性网格 |
| 原生结构 | 生成合法 `p:graphicFrame/a:graphicData/a:tbl`；1–75 行列以整数 EMU 最大余数法闭合 frame |
| 跨文档保真 | 已求值填充、边框、文字、边距和方向写成自包含直接格式，`null` 填充显式写为 `a:noFill`，同时保留样式 GUID |
| 后续编辑 | 每格创建即带空文字模板；缩放同步内部网格与追加模板；复制已追加表格时按当前行数重基奇偶模板 |
| 安全边界 | 坏尺寸、占位符和剪贴板追加模板均在身份分配前原子拒绝；空 `obj` 占位符替换保持原图层且只占一个历史单元 |
| 写回 | 只改目标 slide part；连续保存、保存后撤销/重做、新增页、跨文档粘贴及未知尾节点均走统一物化路径 |

确定性固件：

- `sample-editor-add-table.pptx`：`f95d3796b5b8bdb26cc3188c8fcdbae6f8b780a41870e001102200295c7a6dd5`
- `sample-editor-add-table-builtin.pptx`：`d514ae806a6375e36b3c9c24361e65997082e2025bee101e258ceec0b043125c`

最终验收：

| 证据 | 结果 |
|---|---|
| `npm run check && npm test && npm run build` | 通过：core 2120、edit-core 549、保存 122、editor 250、metafile 130；48 份固件 / 146 页 / 292 对独立 SVG 指纹一致；五包构建通过 |
| Chrome | 20×10 新增表格完整反馈 p95 `6.8ms`，网格/frame 偏差 `0.000px` |
| 格式上限 | 75×75（5625 格）创建/保存 `37.61/298.11ms`，保存重开恢复全部单元格 |
| LibreOffice | 20/20 Office 产物可打开；3×3 自定义/内置样式均为三种行色与 8 条完整网格线，frame 最大偏差 `29.859 SVG unit`；无样式 2×3 为 7 条完整网格线 |
| Office 门禁 | `add-table.pptx`、`add-table-builtin.pptx`、`add-table-fallback.pptx`、`add-table-new-slide.pptx` 已加入 20 项真实 PowerPoint 清单；本机无 Windows PowerPoint，执行继续由既有平台门禁承担 |
| 复审 | 规格与架构/代码质量双路最终复审均为 `Findings: 0` |
