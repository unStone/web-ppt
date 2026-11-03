---
title: MP4、JPEG 与 GIF 导出
status: open
priority: P2
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

用户怎样直接导出各平台都能播放的 MP4，以及 JPEG 图片和动态 GIF？

## 现状

`viewer-core/video` 只输出 WebM（VP9 / VP8，可选 Opus 音轨）；图片导出只有 PNG（单页与 ZIP）。微信、iOS 相册与 PowerPoint 自身更普遍接受 MP4。

## 范围

| 格式 | 说明 |
|---|---|
| MP4 | WebCodecs H.264（或 HEVC / AV1，按浏览器支持探测）+ AAC 音轨；自写 ISO BMFF 封装（`ftyp` / `moov` / `mdat`，支持快速开始）；复用 WebM 的时间轴、动画、切换、音频混音与取消 |
| JPEG | 与 PNG 同一光栅链路，质量参数；单页与 ZIP |
| GIF | 动画批次或固定停留时间生成帧，调色板量化与 LZW 编码；尺寸与帧率上限 |
| 失败 | 浏览器不支持编码器时以稳定 reason 拒绝，不回退成其他格式 |

## 完成条件

- MP4 由 FFmpeg 与浏览器 `<video>` 解析，时长、帧率、音画同步按 [portability 006](../../ppt-portability-fidelity/tickets/006-video-audio-track.md) 的测量方法验证。
- JPEG / GIF 输出确定（同输入同字节），GIF 帧数与延迟有断言。
- 按需入口，默认闭包体积不变。

## 参考

上游无视频导出。封装格式依据 ISO/IEC 14496-12 与 14496-14；GIF 依据 GIF89a 规范。

## 不做

- 服务端转码。
