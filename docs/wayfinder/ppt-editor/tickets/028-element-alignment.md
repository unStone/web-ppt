---
title: 实现元素视觉对齐
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./027-element-layer-order.md
---

## Question

如何通过公开纯 JSON `AlignElements{ ids, edge }` 命令，把一个或多个可编辑元素按
`left | center | right | top | middle | bottom` 六种方式对齐，并让无框架编辑会话、增量 DOM、撤销重做与
最小 OOXML 写回复用现有 `SetXfrm` 边界？单元素以幻灯片为对齐容器，多元素以全部目标旋转后的世界 AABB
并集为容器；祖先与后代同时出现时只移动最外层根，重复 id、跨页目标、`editable:none` 与锁定元素必须在
任何 patch 落模前整体拒绝。

对齐依据用户看到的外框，不按未旋转的原始 `x/y/w/h` 猜测。顶层、组合内、不同父级以及非均匀缩放或翻转
祖先都先在幻灯片坐标求目标位移，再用各自父空间逆线性变换还原到局部 `x/y`；框架对象只改位置，因此图片、
图表、SmartArt、OLE、墨迹和媒体与普通形状遵循同一条路径。水平对齐不产生世界 y 位移、垂直对齐不产生
世界 x 位移；旋转父空间反算后局部 `x/y` 可以同时变化。已经对齐的命令不创建历史，所有目标的变换必须
形成一个可撤销事务，失败不能部分成功。

基础 DOM 包不内置产品工具栏或框架运行时，但命令、类型和订阅回显必须足以让 React、Vue、Web Component
等宿主用六个按钮直接调用。活动编辑视图只重渲真正移动的元素和选择框，未触碰兄弟与 defs 保持 DOM 身份；
保存后重开的位置、两条 SVG 渲染路径独立进程指纹必须与编辑态一致，LibreOffice 打开不得报告修复。
确定性固件覆盖旋转顶层、嵌套组合、框架对象、只读/锁定目标与 60 元素性能页；真实 Chrome 中 60 元素对齐到
完整 DOM 反馈 p95 不超过 `8ms`。

验收只经过发布入口的 `Editor`、`openEditor(...).mount(...)`、`editor.save()`、core 重新解析与真实 Chrome。
本票不实现分布、等距、相对首选对象、快捷键、工具栏、剪贴板、组合/取消组合或新增元素。

## Resolution

- `@web-ppt/edit-core` 新增严格纯 JSON `AlignElements { ids, edge }`。六种边以旋转后世界 AABB 求差，
  再把世界位移逆变换到各目标父空间；单元素对幻灯片，多元素对并集，组合内、跨父级、翻转/非均匀缩放
  与框架对象共用一条 O(k·depth) 路径。重复 id、跨页、只读、通用锁、来源 `noMove` 与规格外字段在落模前
  原子拒绝；祖先/后代只移动最外层根，零位移不创建历史。
- 坐标事实与最外层选择根下沉到无 DOM 的 edit-core，`@web-ppt/editor` 直接消费并公开转出；一个命令形成
  一个撤销单元。活动视图按影响集只替换移动分区，未触碰兄弟、defs 与静态层保持身份；60/60 批量目标
  则明确进入整页反馈路径。React、Vue、Web Component 与原生宿主只需把六个按钮映射到同一命令并订阅
  Editor 事件，基础包没有引入任何框架运行时。
- 保存复用既有 SetXfrm 最小补丁：普通、旋转和框架目标重开后视觉边界与编辑态误差不超过 1 EMU，只有
  目标 slide part 改变；HTML/SVG 两条路径的独立进程指纹一致，撤销保存恢复原 part。LibreOffice 无修复
  打开 `element-align.pptx` 并导出 `17146-byte` PDF。
- 确定性固件 `sample-editor-align.pptx` 覆盖旋转顶层、非均匀翻转组合、组合叶、框架对象、版式只读、
  OOXML `a:spLocks noMove` 与跨页目标；连续生成 SHA-256 均为
  `30c0fdbe700df17020bd24fc667dcfbe0bc96c4dffde0be65f93848d0e7b8354`，全量 fixtures 重生成无额外差异。
- 全量门禁通过：1987 项 core、313 项 edit-core、24 项 M1 保存、140 项 editor、162 个快照、37 份固件 /
  132 页 / 264 对独立进程编辑等价 SVG 指纹及 130 项图元文件；五个发布包构建成功。
  真实 Chrome 旋转/嵌套视觉偏差 `0.004px`，60 元素完整 DOM 对齐反馈 p95 `1.5ms`，低于 `8ms` 预算；
  60/120/240/480/960 元素 headless 中位为 `0.232/0.431/0.835/1.465/2.941ms`。
- 构建实测 edit-core `11.00KB gzip`、editor `19.08KB gzip`；npm dry-run 包体分别为
  `55,277/165,355 bytes` 与 `39,794/124,636 bytes`（压缩/解包），确认对齐命令、坐标 seam 与声明均进入
  tarball。Spec 审查指出的 60/60 性能、LibreOffice、严格命令形状与锁定固件问题全部回归；Standards
  审查推动移除内部转发层、恢复非显然坐标注释并统一框架对象术语，最终双轴均 clean。
