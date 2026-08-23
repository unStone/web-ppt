---
title: 建立移动手势与拖动幽灵
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./016-selection-space-handles.md
---

## Question

如何让 `SlideEditor` 在已选元素上建立可恢复的 pointer capture 移动手势，把屏幕增量通过统一坐标
模块换算到元素父空间；拖动每帧只更新静态目标与 interaction overlay 的幽灵变换，`pointerup`
才提交一次 `SetXfrm`，从而保持 8ms 帧预算、一个手势一个历史组和精确 OOXML 写回？

需要明确点击与拖动阈值、单选/多选的共同位移、嵌套旋转翻转组的父空间增量，以及 `Escape`、
`pointercancel`、`lostpointercapture`、视图销毁和切页时的无提交回滚。真实 Chrome 要验证拖动中静态 SVG
节点与 defs 身份不变、松手只发生一次增量提交、撤销恢复原位置，60 元素页拖动帧 p95 不超过 `8ms`。

本票只实现移动，不绑定缩放/旋转手柄，不实现吸附、智能参考线或框选。

## Resolution

`SlideEditor` 现在只为编辑态主按钮/主指针建立移动手势。`pointerdown` 立即捕获到视图根；屏幕距离
达到 3px 才进入拖动，避免点击抖动产生历史。点击未选元素可直接选中并拖动；点击当前多选成员保留
整个选区。若选区同时含祖先与后代，只移动最外层所选根，避免世界位移叠加。

开始拖动后，每个移动根用临时 `<g data-edit-drag-ghost>` 包住原静态分区；每个 rAF 只更新 wrapper
的父空间 `translate` 和 interaction overlay 的幻灯片空间 `translate`，并显示 `grabbing` 光标。
原 markup、defs、稳定元素节点和 EditDoc 全程不变。不同父级的目标分别通过统一坐标 seam 把同一屏幕
位移换到各自父空间；两层旋转翻转组 40×20px 的世界位移得到固定子空间增量
`(-11.160254, 0.669873)`。

`pointerup` 先取消 rAF、拆 wrapper、恢复光标和释放捕获，再把全部目标作为一个“移动元素”事务提交；
因此一个手势只有一个撤销单元，随后走既有元素级 DOM patch 与 OOXML `a:off` 写回。保存重开后的
组内位置在 1 EMU 量化内一致。`Escape`、`pointercancel`、`lostpointercapture`、切页、切 view、
改变 zoom、外部编辑更新和视图销毁都只清幽灵、不提交历史。

Node 公开 seam 覆盖单选、多选、嵌套写回、撤销与八类生命周期取消。真实 Chrome 以可信鼠标输入证明
pointer capture 获取/释放、拖动中模型与静态 SVG/defs 身份稳定、松手单次提交和撤销；嵌套幽灵屏幕
偏差 `0.000px`，60 元素页 rAF 帧 CPU p95 `0.100ms`（预算 `8ms`）。Playwright 页面显示 PASS，
控制台 0 error / 0 warning。本票未绑定缩放/旋转手柄，也未实现吸附、参考线或框选。
