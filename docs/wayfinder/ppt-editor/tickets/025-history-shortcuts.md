---
title: 接通撤销重做快捷键与跨页回显
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./024-modifier-multiselect.md
---

## Question

如何把已经稳定的 headless 双向 patch 历史接到聚焦的编辑视图，让用户无需宿主框架额外布线就能撤销和
重做？以[微软 PowerPoint 官方快捷键](https://support.microsoft.com/en-us/accessibility/powerpoint/use-keyboard-shortcuts-to-create-powerpoint-presentations)
为基线，Windows 与 macOS 分别支持 `Ctrl/Cmd+Z` 撤销、`Ctrl/Cmd+Y` 重做；同时按技术方案接受
`Ctrl/Cmd+Shift+Z` 重做。快捷键必须恰有一个 Ctrl/Meta 主修饰键且不能带 Alt，大小写键值等价；
识别到的快捷键即使历史为空也要阻止浏览器自己的页面/文本历史，但不能产生新历史。

只有收到事件的 edit 视图拥有快捷键；view 模式、普通或 Shadow DOM 表单与 contenteditable 保留浏览器
所有权。活动 pointer 手势期间沿用现有键盘所有权：只阻止浏览器默认行为，不打断预览、不撤销或重做
已提交历史。撤销/重做必须恢复历史条目的公开 selection、dirty 状态和 DOM 投影；若恢复选区属于其它页，
只把收到事件的视图切到该页，其它共享视图保持原页。没有可用于定位的选区时，回显该历史条目的首个脏页。

单元素历史仍只替换目标 DOM 分区，不重建整页 SVG/defs；连续快捷键按历史顺序逐步移动指针，撤销后产生
新编辑仍由现有内核清空 redo。通过 `openEditor(...).mount(...)`、DOM keyboard、公开 history/selection
与 Chrome DevTools 可信 Ctrl/Meta 输入验收；60 元素撤销与重做到完整反馈 p95 均不超过 `8ms`。

本票不实现工具栏撤销按钮、历史面板、文本编辑内部的浏览器 undo manager、协同历史或命令重放 UI。

## Resolution

编辑视图新增独立历史键盘路由：恰有一个 Ctrl/Meta 主修饰键时，`Z` 撤销、`Shift+Z` 与 `Y` 重做，
键值大小写等价；识别到的空历史快捷键也会阻止浏览器默认行为，但不创建状态。view 模式、Alt 或双主
修饰键组合，以及普通/Shadow DOM 表单和 contenteditable 继续由浏览器拥有。活动 pointer 手势期间
只消费历史快捷键，既不打断临时预览，也不移动已提交历史指针。

路由只调用公开 `Editor.undo/redo`。内核恢复 selection 与 dirty 状态后，收到事件的视图优先回显选区
所在页；选区为空则回显首个脏页。共享会话的其它视图不切页。单元素历史仍只替换目标 markup/defs
分区；连续 keydown 逐项移动历史指针，撤销后的新编辑继续由 headless 内核清空 redo。

验收证据：确定性 `sample-editor-history.pptx` 连续生成 SHA-256 均为
`8b2a1e75c5b9a1d0ee8a483490d11c72061fea8db5d4c3cd9196b530173e6c91`；121 项 editor 断言通过。
真实 Chrome 的 60 元素撤销/重做完整反馈 p95 分别为 `1.200ms` / `1.100ms`，均低于 `8ms`；
DevTools `isTrusted` 的 Ctrl+Z、Cmd+Y、Cmd+Z 与 Cmd+Shift+Z 证明默认行为、焦点、dirty 和双栈指针
符合契约。嵌套挂载视图的事件只由最内层消费一次；标准与规格双审查的初始问题均已回归覆盖，复核剩余
问题各为 0。全仓 `npm run check`、`npm test`、五包构建全绿：34 份固件 / 126 页 / 252 对编辑投影
指纹一致；editor 发布入口为 `18.42KB gzip`，npm dry-run 为 31 个文件 / 38,781 字节。
