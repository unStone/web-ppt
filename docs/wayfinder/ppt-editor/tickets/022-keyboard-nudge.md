---
title: 实现方向键微移与连续撤销
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./021-marquee-selection.md
---

## Question

如何让聚焦的编辑视图以方向键把当前页元素选区在幻灯片空间微移 `1px`，
`Shift+方向键` 微移 `10px`；多选和已进入组的嵌套元素必须保持完全相同的世界位移，
不能把幻灯片位移直接加到非均匀缩放/旋转/翻转组的父坐标。祖先与后代同时入选时仍只移动
最外层选择根，选区和进组上下文保持不变。

按键必须经过已有 `Editor.transaction` 产生可保存的 `SetXfrm`；同一个物理按键按住产生的
auto-repeat 合并为一个撤销单元，松开后再按是新单元。任一目标被锁定、隐藏、不可编辑或不属于
当前页时整次不执行；view 模式、无元素选区、活动 pointer 手势、`Ctrl/Meta/Alt` 组合键以及
`input` / `textarea` / `select` / contenteditable 内的键盘事件不得移动元素或抢走文本编辑焦点。

通过发布入口 `openEditor(...).mount(...)`、真实 `keydown/keyup/blur`、headless 选区/历史/保存和
Chrome `getScreenCTM()` 验收：0.5/1/2 zoom 下单选、多选与复合组屏幕位移偏差均不超过
`0.5px`；60 元素选区的单次键盘提交 p95 不超过 `16ms`。

本票不实现 Tab 选择顺序、Shift/Ctrl 点选或框选增减、删除、复制粘贴、层级/组合快捷键、
文本光标移动或键盘吸附。

## Resolution

编辑视图新增独立键盘控制器：只在当前页元素选区全部可选且没有活动 pointer 手势时拥有方向键，
以 `1px` 或 `Shift` 的 `10px` 幻灯片向量逐个反解到最外层选择根的父坐标，再用一个
`Editor.transaction` 提交 `SetXfrm`。因此多选与两层旋转、翻转、非均匀缩放组保持完全相同的
世界位移；祖先和后代同时入选也只移动一次，选区与进组上下文不变。任一成员锁定、隐藏、不可编辑
或不在当前页时原子拒绝。

每个视图用独立 namespace，每个方向键的每次 `keydown→keyup` 用独立 hold token 和固定时间；
连续 auto-repeat 合并，松开、失焦、切页、切模式、缩放或销毁都会结束序列，不同方向插入则按事件
顺序形成新的线性历史段。历史层同时按 patch path 压缩合并项，只保留最早 inverse 与最新 forward，
避免长按让撤销内存和提交成本线性增长。键盘所有权通过 `composedPath()` 判断，普通及 Shadow DOM
中的表单/contenteditable、view 模式、`Ctrl/Meta/Alt` 组合键均不会误触画布。

验收证据：确定性 `sample-editor-keyboard.pptx` 连续生成 SHA-256 均为
`30b84049a5380d2106773ff4accafa5712033593b15a78a0149f295d70abd0e3`；97 项 editor 与 245 项
edit-core 断言通过，保存重开嵌套局部坐标误差不超过 1 EMU。真实 Chrome 在 0.5/1/2 zoom 的
单选、多选和复合组屏幕位移最大偏差 `0.049px`；60 元素连续 120 次 repeat 仍只有 60 个 forward
与 60 个 inverse patch，含布局提交 p95 `1.800ms`，DevTools `isTrusted` 键盘及撤销恢复通过。
全仓 `npm run check`、`npm test`、五包构建均通过；31 份固件 / 120 页 / 240 对编辑投影指纹完全
一致，editor 发布入口为 `17.64KB gzip`，npm dry-run 为 26 个文件 / 36,874 字节。两路复审在修复
物理键/多视图 token 冲突、Shadow DOM 焦点误判和历史 patch 膨胀后均无剩余问题。
