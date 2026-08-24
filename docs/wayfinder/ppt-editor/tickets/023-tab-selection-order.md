---
title: 实现 Tab 元素遍历与焦点所有权
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./022-keyboard-nudge.md
---

## Question

如何让聚焦的编辑视图以 `Tab` / `Shift+Tab` 在当前页或当前 `enteredGroup` 的直属可选元素间按
绘制顺序正向/反向循环并首尾相接？无元素选区或共享选区不属于本视图范围时应从首项/末项开始；
单选从当前元素继续，多选没有隐藏的“主元素”，正向必须从最大序号之后、反向从最小序号之前继续，
让行为只由公开选区决定。锁定、用户隐藏、不可编辑的分支必须跳过，嵌套组在当前层只作为一个候选，
不得越层扁平遍历。

Tab 只替换 headless 选区并保留 `enteredGroup`，不写历史、不重建静态 SVG/defs；同一会话多视图只由
收到事件的编辑视图及其当前页决定范围。view 模式、普通或 Shadow DOM 中的表单/contenteditable、
`Ctrl/Meta/Alt+Tab` 与活动 pointer 手势不得改变选区；活动手势期间应阻止浏览器把焦点移出画布，
其它让位场景不得取消浏览器默认行为。真实 Chrome 需以 DevTools 可信 Tab 证明焦点留在编辑视图，
60 元素页单次遍历到完整选择反馈 p95 不超过 `8ms`。

本票不实现 Shift/Ctrl 点选或框选增减、文本编辑态的缩进/表格换格、删除、复制粘贴、全选、层级、
组合或其它快捷键。

## Resolution

编辑视图新增统一键盘路由：`Tab` / `Shift+Tab` 只读取收到事件视图的当前页，并在有效
`enteredGroup` 的直属可选子项或页级直属子项中按绘制顺序首尾循环。无本视图范围内选区时从首项/末项
开始；多选正向取最大序号之后、反向取最小序号之前。锁定、用户隐藏、不可编辑分支被统一过滤，嵌套组
在当前层保持单个候选，不会扁平进入后代。共享会话的其它页面或失效进组上下文不会污染当前视图范围。

遍历只调用公开 `Editor.select`，不写历史、不重建静态 SVG/defs。普通与 Shadow DOM 表单、
contenteditable、`Ctrl/Meta/Alt+Tab` 和 view 模式保留浏览器所有权；活动 pointer 手势则只消费 Tab 以
留住画布焦点，不切换选区或打断幽灵。方向键控制器复用同一个 `composedPath()` 文本所有权判断，避免
两套键盘入口在 Shadow DOM 下分叉。

验收证据：确定性 `sample-editor-tab.pptx` 连续生成 SHA-256 均为
`22c7ea0391d8f22577fbb247d5578cea25cb0dbc1cf95af0cbe66a820af34f16`；105 项 editor 断言通过。
真实 Chrome 的 60 元素 120 次完整选择反馈 p95 为 `0.200ms`，DevTools `isTrusted` Tab 后焦点仍在
编辑视图，且选区、历史和静态 SVG 身份均符合契约。全仓 `npm run check`、`npm test`、五包构建全绿：
32 份固件 / 122 页 / 244 对编辑投影指纹一致；editor 发布入口为 `17.87KB gzip`，npm dry-run 为
29 个文件 / 37,542 字节。规格与质量两路复审在补齐普通/Shadow DOM `button` 所有权、收拢共享键盘
上下文并校正所有权命名后均无剩余问题。
