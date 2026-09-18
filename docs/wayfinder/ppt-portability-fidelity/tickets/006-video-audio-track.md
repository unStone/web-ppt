---
title: 为视频导出增加固定时间轴音轨
status: closed
assignee: cursor
priority: P2
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

如何在现有离线视频时间轴上加入音频播放与混音，使导出结果不受实际录制耗时影响？

## 范围与路径

- 首版覆盖 PCM WAV 与显式可解码的嵌入音频；盘点当前模型保留的播放时机、音量、循环及跨页语义，缺失部分先补模型。
- 统一视频帧和音频样本时间基准；离线渲染/混音后编码音轨，为 WebM 增加音频轨道和交错封装。
- 导出前检测音频解码与编码配置；优先验证 Opus，不能因存在 WebCodecs 接口就假定支持。
- 不用实时录屏替代固定时间轴；长时输出控制缓冲，明确输入限制和大小上限；保留无音轨旧调用的兼容性。

## 验收

- 固定时刻脉冲与画面标记同轴，独立 FFmpeg 解码测量偏差；音视频时长差不超过已声明的帧/编码包边界。
- 两路混音、静音、延迟开始、结束裁切、循环和跨页；若首版缺某语义则列为拒绝项，不能静默忽略。
- 失败、取消、编码器背压和资源释放；真实浏览器下载重开及[共同完成条件](../plan.md#共同完成条件)。
- 参考：[Web Audio 离线渲染](https://www.w3.org/TR/webaudio/#OfflineAudioContext)、[WebCodecs 能力检测](https://www.w3.org/TR/webcodecs/)。

## 完成

已交付固定时间轴音轨首版：页起点 PCM WAV → `OfflineAudioContext` 混音 → Opus `AudioEncoder` → WebM `A_OPUS` 交错。
`videoAudioPlan` / `decodeWavPcm` / `mixVideoAudio` / `encodeOpusAudio` 位于 `viewer-core/src/video/audio.ts`；`WebmWriter` 支持可选音轨；视频编码器队列背压与 `AbortSignal` 贯穿混音/编码/写帧。

### 证据

| 项 | 位置 |
|---|---|
| 固件（双页延迟混音） | `fixtures/sample-video-audio.pptx`（`tooling/make-video-audio-fixture.mjs`） |
| 单元契约 | `tooling/test-video.mjs`：WAV 解码、同页多路、跨页 `startMs` 延迟、Opus 封装 |
| 真实 Chrome + FFmpeg | `tooling/lib/video-audio-browser-contract.mjs`：约 0.2s / 0.7s 双脉冲窗口、取消 AbortError |
| 官网导出旅程 | `tooling/lib/site-video-browser-contract.mjs`：中英文帮助列出 PCM WAV 与拒绝项；下载重开与取消 |
| 产品文案 | `packages/site/src/editor-export-tools.ts` + `i18n/en-expanded.ts` |
| 能力矩阵 | `docs/expanded-capabilities.md` 视频行 |

### 首版显式拒绝 / 未建模

| 语义 | 行为 |
|---|---|
| 非 PCM WAV（含压缩 WAV、AAC 等） | 抛错，不静默丢声 |
| 音量 / 静音 / 循环 / trim / 跨页续播 / mediacall | **未解析进 Schema**；产品文案列出，不假装已同步 |
| 内嵌视频画面 | 见 007（progressive H.264）；AAC 仍不混入 |
