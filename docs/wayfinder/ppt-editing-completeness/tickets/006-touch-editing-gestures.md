---
title: 补齐触屏编辑手势
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

编辑器已统一 Pointer Events 并在编辑态拥有 `touch-action`，但手指仍按鼠标精确命中，双指没有画布导航，
长按没有右键语义。如何在交互层增加触屏命中容差、双指缩放/平移与长按回调，同时不改变模型、不污染历史，
也不破坏单指移动/缩放/旋转、文字选择、图片裁剪和查看态页面滚动？

手势状态机必须明确单指升级双指、指针丢失、cancel、跨视图、模式切换与 destroy 的收束规则；导航结果通过
既有 zoom/viewport seam 交给宿主，长按只发出上下文事件，菜单内容仍属于产品层。鼠标、触控笔和可信键盘
行为必须保持逐项回归。

验收：真实 Chrome 中以 CDP 可信触点覆盖细描边命中、双指距离/中心点误差、长按阈值、touchcancel 与
pointer capture；以浏览器 PointerEvent 契约覆盖 CDP 无法表达的双指降级及切页/模式/zoom/destroy 等收束路径。
60 元素帧预算、无悬挂监听器、多视图隔离及现有鼠标契约全绿，四段仓库门禁通过。

## Answer

触屏逻辑收敛到每个挂载视图独有的 `TouchGestureController`。第一指仍进入原有移动、缩放、旋转、文字与
裁剪路由；第二指才取消对象预览并升级为导航，按双指距离与中心锚点计算期望 `SlideViewport`，经 rAF
合帧后同步本视图 zoom，并把外层滚动位置交给宿主。抬起一指后以当前视口重基继续单指平移；最终结束、
`pointercancel`、capture 丢失、切页/模式、宿主缩放或 destroy 都走同一收束路径。触点 Map 属于视图，
因此跨视图手指不会合并。

点选先保留浏览器精确 SVG 命中；只有 `pointerType === 'touch'` 且精确命中失败时，才在 12 个屏幕像素
包围盒内按真实 SVG geometry 的屏幕空间线段距离选择最近且视觉层级最高的对象。鼠标和触控笔没有新分支。
500ms 长按在移动超过 8px 时取消，触发后只发布含屏幕/幻灯片坐标与稳定 ElementId 的上下文请求；仅吞掉
同落点的后续合成 click，不影响同时期其它鼠标点击。查看模式不绑定编辑触屏事件并清空 `touch-action`。

## Evidence

- 确定性固件 `sample-editor-touch.pptx` 覆盖 1px 无填充细描边与邻近实心对象；连续生成 SHA-256 均为
  `81bf936b957c618218710f0d39f1859abcd8def781196dd7041b6590ad602571`。LibreOffice 已成功打开并导出
  1280×720 首屏；全固件达到 77 份 / 253 页 / 506 对独立进程 SVG 指纹一致。
- 公开 DOM 契约覆盖单指移动/缩放/旋转、双指升级与降级、长按阈值/点击抑制、键盘让权、取消/capture
  丢失、切页/模式/zoom/destroy、多视图隔离和查看态滚动；adapter 与 React/Vue 均直接透传两个回调，
  React 回调触发宿主重渲染时不会重放旧 zoom 并中断手势。
- 真实 Chrome CDP 触点验证 6px 外细描边 touch 命中、双指距离/中心和结束平移误差均为 0、可信
  pointer capture 成对释放及 touchcancel 收束；同页浏览器契约验证 mouse/pen 保持精确。60 元素触屏帧
  p95 1.2ms（预算 24ms）。CDP 的 `touchEnd` 不接受剩余触点，故 2→1 降级由公开 PointerEvent 契约验证。
- 导航与长按不产生 Editor patch、历史或恢复帧，保存后字节与源文件完全相同；因此字段级协同、补丁/
  生成式保存和 Windows PowerPoint 编辑产物不适用，不伪造外部证据。68/68 份无编辑保存仍逐字节相同。
- `npm run check && npm test && npm run build && npm run verify` 连续全绿：4,407 项断言、180 个快照、
  八个发布包和 289 项一致性检查；editor 主入口锁定为 278,318B / 68,526B gzip，viewer 产物零增量。
