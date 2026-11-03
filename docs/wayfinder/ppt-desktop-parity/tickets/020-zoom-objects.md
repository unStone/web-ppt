---
title: 缩放定位对象的放映
status: open
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

文件里的摘要缩放、节缩放与幻灯片缩放对象，怎样在放映时按 PowerPoint 的方式跳转并返回？

## 现状

缩放定位对象位于 `mc:AlternateContent`，当前按回退图片显示，单击不跳转、不返回。

## 范围

| 部分 | 说明 |
|---|---|
| 解析 | p166 缩放对象的目标页 / 节、返回设置、缩放切换、显示背景等属性进入 Schema |
| 放映 | viewer-core 单击跳转，播放缩放切换；“返回到缩放”时回到来源页 |
| 编辑 | 插入缩放定位与修改目标（产品待确认） |
| 保存 | 写出缩放对象并刷新回退图片 |

## 完成条件

- 三类缩放对象各有固件，放映跳转与返回有浏览器断言；未设置返回时停留在目标页。
- 保存后 LibreOffice 显示回退图片，Open XML SDK 校验通过。

## 参考

上游无缩放对象；依据 [MS-PPTX] p166 扩展定义。
