---
title: 录制旁白与摄像头
status: open
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./009-presenting-tools.md
  - ./010-video-image-export.md
---

## Question

演讲者怎样逐页录制旁白（可带摄像头画面），把录音与计时保存进文稿，并导出带声音的视频？

## 现状

`AddMedia` 能插入 WAV / MP4，WebM 导出能按时间轴混音；没有录音录像入口，也不写每页旁白与计时。

## 范围

| 部分 | 说明 |
|---|---|
| 录制 | `getUserMedia` 采集麦克风与可选摄像头；从头 / 从当前页开始，暂停、重录本页、清除 |
| 保存 | 每页旁白作为媒体部件写入，并设置自动播放与 `advTm`；摄像头画面作为该页视频对象 |
| 墨迹 | 录制期间的笔迹沿用 009 的 InkML 保存 |
| 导出 | 010 的 MP4 与现有 WebM 以旁白为音轨 |
| 权限 | 拒绝授权、设备被占用、录制中设备断开各有明确提示（产品待确认） |

## 完成条件

- 录制产物保存重开后在 viewer-core 按计时播放；导出视频音画同步按 portability 006 的方法验证。
- 权限与设备异常路径有浏览器测试（使用虚拟设备）。

## 参考

上游无录制能力。
