---
title: 实现修饰键点选与框选增减选
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./023-tab-selection-order.md
---

## Question

如何让编辑视图以 PowerPoint 的 `Shift` / `Ctrl` 点选增减选为基线，并把 macOS `Meta` 映射到同一
跨平台主修饰键？[微软官方对象选择说明](https://support.microsoft.com/en-us/office/graphics-visuals/select-a-shape-or-other-object)
把 Shift 或 Ctrl 点击同时定义为“选择多个对象”和“逐个取消对象”；因此命中
未选元素时加入、命中已选元素时移除，最后一个被移除后回到 `none`。`Alt` 继续只负责穿透重叠候选，
但 `Alt+Shift/Ctrl/Meta` 应能对穿透得到的那个候选执行同样切换，不把两种修饰语义互相吞掉。

所有增减都必须限制在收到事件视图的当前页与当前有效 `enteredGroup` 直属可选子项；共享选区来自其它页、
其它组、非元素选区，或成员已锁定/隐藏/不可编辑时，不得泄漏到新多选。结果按当前作用域绘制顺序规范化，
避免点击顺序成为隐藏的主元素。无修饰键点击已选成员仍保留整组选区以支持直接拖动；修饰键移除的成员不应
反过来拖动剩余元素，加入的成员则允许达到 3px 后拖动完整新选区。

空白点击无修饰键仍清空；带 Shift/Ctrl/Meta 的空白点击保持选区。框选无修饰键替换选区，带任一选择
修饰键时对“手势前有效选区”和“当前完全包含候选”做对称差，从而一框同时加入未选项、移除已选项；
修饰键可在手势中按下或释放，预览必须立即反映最终组合，但 headless 选区只在 pointerup 提交。
Escape、pointer cancel/lost capture、外部选区更新、切页/模式/zoom 与销毁仍完整恢复手势前选区。

选择变化只更新 interaction SVG，不写历史、不重建静态 SVG/defs。同一会话多视图由事件视图决定页与组
范围；view 模式不拥有事件。通过 `openEditor(...).mount(...)`、DOM pointer/keyboard、公开 selection
与 Chrome DevTools 可信修饰点击验收；60 元素页点选切换和框选组合到完整反馈 p95 均不超过 `8ms`。

本票不实现选择窗格、触摸多选模式、文本/表格选区、Shift 拖动方向约束、Ctrl 拖动复制、全选、删除、
复制粘贴、层级或组合快捷键。

## Resolution

新增单一线性组合器：普通选择取当前作用域命中项，`Shift` / `Ctrl` / `Meta` 选择对“手势前有效选区”与
命中项做对称差，最终结果始终按当前页或有效 `enteredGroup` 的直属绘制顺序规范化。点选已选成员会移除，
点选未选成员会加入，最后一项可回到空选区；移除动作不启动拖动，加入后越过 3px 阈值可拖动完整新选区。
`Alt` 穿透与增减选正交，多选时优先触达重叠栈中尚未选中的候选，避免反复切换最上层对象。

框选在 pointerdown 快照旧选区，但修饰键状态可随 pointer/keydown/keyup 实时改变；interaction SVG 每帧
预览最终对称差，只在 pointerup 写入公开选区。带修饰键空白点击保持选区，Escape、失去捕获、外部选区
变化和视图生命周期取消均不污染模型或历史。点选、框选都只接受事件视图的当前页/当前组直属可选元素，
共享会话中的跨页、跨组、锁定、隐藏、不可编辑或非元素旧选区会被丢弃。

验收证据：确定性 `sample-editor-multiselect.pptx` 连续生成 SHA-256 均为
`070da60c911f505e146e5599146b681e08d3979ef8799f6a1b4748ed5c0eed2c`；113 项 editor 断言通过。
真实 Chrome 的 60 元素修饰点选/对称差框选完整反馈 p95 分别为 `0.700ms` / `0.400ms`，均低于
`8ms`；DevTools `isTrusted` 的 Shift/Ctrl/Meta 点选证明修饰状态、焦点、选区、历史和静态 SVG 身份
符合契约。全仓 `npm run check`、`npm test`、五包构建全绿：33 份固件 / 124 页 / 248 对编辑投影
指纹一致；editor 发布入口为 `18.19KB gzip`，npm dry-run 为 30 个文件 / 38,291 字节。
规格与质量两路复审先发现 Alt+修饰键改变单选穿透顺序、阻止加入后拖动，以及可信鼠标事件重复组装；
补齐失败回归后，单选沿既有 Alt 栈循环、多选才优先未选候选，加入可拖而移除不拖，DevTools 事件统一
经单一发送器组装。同一两位审查者复核后均无剩余问题。
