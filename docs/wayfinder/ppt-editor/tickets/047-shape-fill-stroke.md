---
title: 编辑形状的矢量填充与描边
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./009-set-xfrm-ooxml-patch.md
  - ./014-editor-session-static-view.md
  - ./040-add-preset-shape.md
---

## Question

如何让任意 UI 框架通过可结构化克隆的 `SetFill { id, fill }` 与 `SetStroke { id, stroke }`，编辑形状的
无填充、纯色、线性/径向渐变、图案填充，以及形状/图片的无描边、颜色、宽度、虚线、端点、端帽与连接，
同时让即时预览、多 view/edit、撤销重做、保存重开和“恢复默认”保持同一语义？本票不实现图片填充上传、
效果、文本颜色、表格单元格边框或完整属性面板外壳；这些仍属于后续独立能力。

`fill: null` / `stroke: null` 表示删除本次会话的直接覆盖，恢复解析时已求值的来源/主题结果；显式无填充用
`{ type: 'none' }`，显式无描边用 `{ type: 'none' }`，不能把“恢复默认”和“设为无”混成同一状态。填充只
接受 `full` 可编辑的 shape；描边接受 `full` 可编辑的 shape/image。命令拒绝额外字段、非法颜色、非有限或
越界渐变 stop、空/乱序 stop、未知图案、负宽度、无法往返的虚线、非法端点/端帽/连接、锁定与错误元素类型。
同值提交是严格 no-op；批量设置继续由现有原子事务组合，任一目标失败时模型、选区和历史整笔不变。

公开查询返回选中元素的有效 fill/stroke、mixed 状态以及是否存在直接覆盖，UI 不读取内部 `src/ovr`；命令和
查询只依赖 `edit-core` 纯数据，React/Vue/Web Component 可直接把它们接到颜色选择器、渐变 stop 编辑器与
描边控件。提交只失效目标元素及组祖先，基础 DOM 视图必须替换目标静态节点/defs，未触碰兄弟与其它 view 的
DOM 身份保持；60 元素页面连续格式提交的真实 Chrome 完整反馈 p95 不超过 16ms。

保存从首次触碰的 slide 基线重建。`SetFill` 必须删除 `a:spPr` 内全部互斥 fill 节点，再按 schema 顺序插在
geometry 后；`SetStroke` 必须生成/更新 `a:ln`，按顺序写 fill、`a:prstDash`、join、head/tail，宽度用 px→EMU。
恢复默认删除直接 fill/`a:ln`，不能把主题有效值摊平。未触碰属性、未知相邻节点、`mc:AlternateContent`、
`a:extLst` 与其它 OPC part 原始字节保持；新增/复制形状、连续保存及保存后撤销重做走同一物化链路。

确定性固件覆盖来源主题继承、直接 noFill、solid/透明色、线性/径向渐变、pattern、图片填充直通、十类预设
dash、线端/端帽/连接、未知尾随 XML、嵌套组、图片边框和新增形状。Node 验证命令/查询/历史/非法输入、精确
XML 差异、重开投影、identity/reset、复制粘贴与新增元素；独立进程比较 HTML/SVG，真实 Chrome 验证多 view
增量 DOM 与性能，LibreOffice 验证颜色、渐变、图案、线宽/虚线/端点且无修复打开。Windows PowerPoint COM
继续由自动清单环境执行。

## Resolution

`SetFill` / `SetStroke` 作为可结构化克隆的公开命令进入同一事务、Patch、历史与订阅主干；
`queryElementFill` / `queryElementStroke` 只返回有效值、`mixed` 与直接格式状态，React、Vue、Svelte、
Web Component 或原生工具栏不需要读取 `src/ovr`。`null` 删除直接覆盖，显式 `none` 保持独立身份。
颜色、透明度、角度、gradient stop、线宽和十种预设虚线在入口收敛到 core/OOXML 的共同往返精度；
实线、端帽、连接、复合线与无线端会显式写回，阻断来源主题的虚线和箭头重新继承。

保存层按 schema 顺序保留型改写 fill 与 `a:ln`，新增形状、图片边框和复制粘贴共用同一物化管线。
恢复默认从首次基线重建；连续保存、保存后撤销/重做、独立进程 HTML/SVG 指纹与 core 重开保持一致。
未触碰关系、图片填充、未知 line 属性/`a:extLst`、`mc:AlternateContent` 和其它 OPC part 继续直通。

| 验证 | 结果 |
|---|---|
| 命令、查询、严格 no-op、非法/原子批量、精度与十种虚线 | `edit-core` 602 项通过 |
| 最小 XML、reset/identity、复制粘贴、新增、保存后撤销重做与独立指纹 | 保存 217 项通过；46/46 无编辑包逐字相同 |
| view/edit 多视图、目标分区/defs 与框架公开 seam | `editor` 268 项与真实 Chrome 通过；60 元素格式提交远低于 16ms 预算 |
| 桌面兼容 | LibreOffice 无修复打开，验证渐变、图案、图片填充描边、线宽、虚线、双端点与 66,790-byte PDF |
| 确定性 | 富格式固件连续两次 SHA-256 均为 `7cdec510…407acbd` |
| 全仓门禁 | core 2120、图元 130、54 份固件 166 页的 332 对 SVG 指纹通过；五个发布包构建成功 |

Office 工件 `shape-format.pptx` 已进入自动清单；当前 macOS 环境没有执行 Windows PowerPoint COM，不能
宣称该项已通过。图片填充上传/裁剪、效果、文字颜色、表格边框和属性面板外壳仍保持独立能力边界。
