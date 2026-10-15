---
title: 把内嵌视频内容合成到导出时间轴
status: in-progress
priority: P2
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./006-video-audio-track.md
---

## Question

如何把内嵌视频逐帧解码，与幻灯片动画、切换和音轨按同一时间轴合成，而不是始终导出海报？

## 范围与路径

- 先支持已能可靠取得本地字节的 MP4 子集，显式列出容器、分片方式与视频/音频编码组合；播放可用不等于导出可解码。
- 实现有界解封装、关键帧定位、解码重排与按时间戳选帧；媒体音轨复用前置混音链路。
- 保留元素的裁剪、透明度、变换、层叠和组合关系，并定义媒体触发、循环、跨页及结束策略。
- 外链媒体必须先取得可读取字节，不暗中上传文件；不可访问或格式不支持时明确拒绝，海报仅作为显式选项。

## 验收

- 固定帧率/可变帧率、音视频不同起点、循环、裁剪及多个媒体重叠；独立读取器验证画面选择和音画同步。
- 关键帧前后定位、解码失败、取消、队列背压及长视频内存边界；不能按页面长度一次解码全部视频。
- 包名独立导入、官网实际导出和重开，满足[共同完成条件](../plan.md#共同完成条件)。

## 进度（2026-10）

`00e5af9` 交付首个切片：`VideoOptions.videoOverlay`（默认关闭，产物不变）。

| 项 | 当前实现 |
|---|---|
| 取帧方式 | `viewer-core/src/video/media-overlay.ts` 用浏览器 `<video>` seek + `drawImage` 叠加当前帧，替代海报帧；同一媒体字节 + 同一时间戳得到同一帧，seek 阈值 1/30s；就绪条件为首帧可画（`loadeddata`） |
| 时间轴 | 媒体组起始时刻与音轨共用同一 `groupStarts` 计算，时间轴游标贯通切换、点击批次与停留 |
| 失败 | 不阻断导出，退回海报帧并经 `onWarning` 暴露稳定 reason：加载失败、5s 内未取得首帧或时长无效 → `video-overlay-unavailable`（每个元素一次）；seek 超时 500ms 或帧数据不可用 → `video-overlay-frame-unavailable`（每个元素一次）。海报回退以调用方显式传 `mediaPosters: true` 为前提 |
| 验收 | 真实 Chrome（`tooling/test-video-audio.mjs`）：现场生成的 MP4 帧叠加成功且无 warning；损坏字节与永不就绪的 MediaSource 各报一次 `video-overlay-unavailable`（含页号与元素名），导出照常完成 |

与本票范围的差距：未实现有界解封装与关键帧定位（依赖浏览器 `<video>` 的容器支持），元素裁剪 / 透明度 / 变换与层叠、循环与跨页策略、可变帧率、长视频内存边界、独立读取器的画面选择与音画同步验证均未登记；`video-overlay-frame-unavailable` 尚无稳定复现的验收样本。补齐后关闭。
