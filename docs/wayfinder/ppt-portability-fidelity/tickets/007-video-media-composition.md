---
title: 把内嵌视频内容合成到导出时间轴
status: closed
assignee: cursor
priority: P2
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

如何把内嵌视频逐帧解码，与幻灯片动画、切换和音轨按同一时间轴合成，而不是始终导出海报？

## Answer

| 项 | 结果 |
|---|---|
| 画面 | progressive H.264 → 解封装 / 关键帧前进 / 有界缓存 → 按导出时间轴贴到静态 xfrm（含 rot/flip/crop/alpha） |
| 音轨 | MP4 AAC 与页内 PCM WAV 一并混入 006 的 Opus 链路；WebM `A_OPUS` |
| 时间 | 同页多路重叠、页结束定格、`MediaInfo.loop` / `crossSlide` 显式字段、跨页续播窗口；VFR 按 CTS 选帧 |
| 入口 | `presentationToVideo` 动态加载 `audio`/`media`，不挤占官网首次激活静态闭包 |
| 官网 | `test-site-editor-browser.mjs --video-only`：帮助文案中英文、含媒体固件导出重开、取消 |

### 证据

| 项 | 位置 |
|---|---|
| 实现 | `viewer-core/src/video/{mp4-demux,media-decode,media,audio,webm,video}.ts` |
| 固件 | `fixtures/sample-video-media.pptx`（`make-video-media-fixture.mjs`） |
| SDK Chrome | `tooling/lib/video-media-browser-contract.mjs` → `out/video-media/` |
| 单元 | `tooling/test-video.mjs`（39 项，含音轨） |
| 官网 | `tooling/lib/site-video-browser-contract.mjs` → `out/video/browser-media.webm` |

### 首版明确边界（产品文案与契约锁住，不静默忽略）

| 语义 | 行为 |
|---|---|
| PPT 勾选循环 / 跨页 / mediacall | **不**读 OOXML timing；仅 `MediaInfo` 显式字段 |
| 动画过程位移 | 贴帧用静态 xfrm，不跟随 SVG 动画矩阵 |
| 分片 fMP4 / 非 avc1 | 拒绝；仅 `mediaPosters:true` 可贴封面 |
| 外链 | 需 CORS 可读字节 |

后续若要跟 timing 树或动画矩阵，另开实现票。
