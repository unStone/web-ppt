---
title: 编辑形状与图片的二维效果
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./006-preserving-xml-tree.md
  - ./008-command-patch-history.md
  - ./014-editor-session-static-view.md
  - ./047-shape-fill-stroke.md
---

## Question

如何让任意 UI 框架通过可结构化克隆的 `SetEffects { id, effects }`，编辑形状、图片和组的外/内阴影、
发光、柔化边缘与倒影，同时让即时 SVG 预览、多 view/edit、撤销重做、保存重开和“恢复默认”保持同一语义？
本票只覆盖 core `Effects` 已能渲染的二维效果；不实现 3D、艺术效果、预设效果库或完整属性面板外壳。

`effects: null` 删除本次会话的直接覆盖，恢复解析时已求值的来源/主题效果；空对象 `{}` 是显式无效果，
必须用直接 `a:effectLst` 阻断主题效果继承。命令只接受 `full` 可编辑的 shape/image/group，拒绝额外字段、
非法颜色、非有限或越界半径/距离、越界透明度/比例、锁定和错误元素类型。同值提交严格 no-op；批量命令
继续走现有原子事务，任一目标失败时模型、身份、选区与历史整笔不变。

公开 `queryElementEffects` 返回选中元素的规范化有效效果、mixed 状态及是否存在直接覆盖，UI 不读取内部
`src/ovr`。阴影以 `dx/dy` 暴露给界面，但入口必须收敛为 DrawingML 的距离/方向精度再投影回模型；颜色、
模糊/发光/柔边半径、倒影透明度/大小/距离同样在命令入口量化，保证保存重开不改变统一 Schema。React、
Vue、Svelte、Web Component 或原生工具栏可直接把查询结果绑定到开关、颜色、距离、方向和模糊控件。

提交只失效目标及组祖先。基础 DOM 视图必须原子替换目标 markup/defs，使 filter、mask、reflection `<use>`
在 edit/view 中同步；未触碰兄弟、其它页面和根 SVG 身份保持。60 元素页面连续提交阴影/发光/柔边/倒影时，
每轮都必须产生真实 dirty element，真实 Chrome 完整反馈各自 p95 不超过 16ms。

保存从首次触碰的 slide 基线重建。直接格式删除互斥 `a:effectLst` / `a:effectDag`，按 schema 顺序写 glow、
inner/outer shadow、reflection、softEdge，并插在 `a:ln` 后、scene3d 前；空效果写空 `a:effectLst` 以阻断
主题回退。恢复默认不摊平主题值。未触碰元素、未知相邻节点/属性、`a:scene3d` / `a:sp3d`、`a:extLst`、
`mc:AlternateContent` 与其它 OPC part 原始字节保持；新增元素、复制粘贴、连续保存及保存后撤销重做走同一
物化主干。

确定性固件覆盖主题继承、显式空效果、外/内阴影、透明色发光、柔边、倒影、组合效果、图片、嵌套组、
`effectDag` 替换与未知尾随 XML。Node 从公开命令/查询验证历史、mixed、reset/none、非法输入和精度；保存
契约验证最小 XML 差异、schema 顺序、主题阻断、重开、identity、复制粘贴与新增元素；独立进程比较
HTML/SVG，真实 Chrome 验证多 view 增量 DOM 与性能，LibreOffice 验证颜色、阴影偏移、发光/柔边/倒影且
无修复打开。Windows PowerPoint COM 继续由自动清单环境执行。

## Resolution

`SetEffects` 作为可结构化克隆的公开命令进入同一事务、Patch、历史、订阅和增量渲染主干；
`queryElementEffects` 只返回规范化有效值、`mixed` 与直接格式状态。`null` 删除直接覆盖并恢复来源效果，
`{}` 保留为空 `a:effectLst` 以阻断主题回退。形状、图片与组共用严格校验，阴影距离/方向、颜色、半径和
倒影参数在命令入口收敛到 DrawingML 精度，同值提交保持 no-op。

保存层从首次 slide 基线按 schema 顺序重建 `effectLst`，原子替换互斥 `effectDag`，同时保留宿主未知属性、
3D、扩展和兼容分支。新增、复制、重开、连续保存 identity 及保存后撤销重做共用同一物化链路。目标
markup/defs 在 edit/view 中原子换代，兄弟、未触碰页面与根 SVG 身份不变。

| 验证 | 结果 |
|---|---|
| 命令、查询、reset/none、mixed、非法/原子批量与模型不变量 | `edit-core` 616 项通过 |
| 最小 XML、schema、重开、identity、复制/新增、撤销重做与独立指纹 | 保存 228 项通过；47/47 无编辑包逐字相同 |
| view/edit、目标 defs、未触碰页与框架公开 seam | `editor` 274 项及真实 Chrome 通过；四类效果分别独立门禁 p95 ≤ 16ms |
| 性能实测 | 60 元素 JSDOM 阴影/发光/柔边/倒影 p95 为 0.421/0.549/0.541/0.586ms |
| 桌面兼容 | LibreOffice 无修复打开并导出 154,155-byte PDF；SVG 像素验证阴影/发光/柔边，重存验证含倒影的四类语义 |
| 确定性 | 两页效果固件连续两次 SHA-256 均为 `cea8e20a…820` |
| 全仓门禁 | core 2120、图元 130、55 份固件 168 页的 336 对 SVG 指纹通过；五个发布包构建成功 |

Office 工件 `shape-effects.pptx` 已进入自动清单；当前 macOS 环境没有执行 Windows PowerPoint COM，不能
宣称该项已通过。两位独立规格/标准审查最终均为 `Findings: 0`。3D、艺术效果、预设效果库和属性面板外壳
仍保持独立能力边界。
