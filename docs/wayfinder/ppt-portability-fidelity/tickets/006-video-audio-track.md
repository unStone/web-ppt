---
title: 为视频导出增加固定时间轴音轨
status: open
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

## 技术方案（2026-10 调研落盘）

现状盘点与实施路径：

| 环节 | 现状 / 方案 |
|---|---|
| WebM 封装 | `viewer-core/src/video/webm.ts`（62 行单视频轨：Tracks/SimpleBlock/Cues）。扩展：Tracks 增音频 TrackEntry（0xae + Audio 0xe1：SamplingFrequency 0xb5、Channels 0x9f），Opus 需 CodecPrivate（OpusHead）；块按统一毫秒时间戳交错进 Cluster |
| 时间基准 | 视频帧时间戳（现有 fps 基准）与音频样本统一到同一毫秒轴；混音直接用确定性 PCM 浮点混合（页序播放时机 × 音量 × 循环 / 裁切语义），不依赖 OfflineAudioContext 的实时语义——固定时间轴要求确定性优先 |
| 音频解码 | PCM WAV 直接可混（无需解码）；嵌入 MP4 / AAC 走 `decodeAudioData`；外链先 fetch 再同路径。解码能力前置检测，失败明确拒绝并报原因 |
| 音频编码 | WebCodecs `AudioEncoder`（Opus 48kHz）优先；`isConfigSupported` 前置检测，不支持则明确报错——不能因接口存在假定可编码（票据原文要求），也绝不静默丢音轨 |
| 长时缓冲 | 混音与编码分块喂入（dequeue 事件背压），输入时长上限显式拒绝 |
| 兼容 | 无音频媒体的文稿走现有无音轨路径，产物字节不因本次改动变化 |
| 验收工具 | 本机 ffprobe/ffmpeg 可用（已确认）；`tooling/test-video.mjs` 现有 VP8 断言基础（`test-video.mjs:24`）上扩双轨断言：ffprobe 读 streams（v_webm+a_opus）、时长差按声明的包边界核对、脉冲同轴测量 |

依赖顺序：模型侧播放时机语义盘点（首版缺的列为拒绝项）→ 混音核（纯函数，Node 可测）→ 封装器双轨 → WebCodecs 接线与浏览器验收。

## 进度（2026-10）

| 步 | 状态 |
|---|---|
| 混音核 | ✅ `viewer-core/src/video/mix.ts`（`mixAudioClips`：确定性线性插值重采样、循环/endMs 截切、音量、限幅、声道布局；30 项 Node 断言并入 `test-video.mjs`） |
| 封装器双轨 | ✅ `WebmWriter` 可选音频轨（A_OPUS TrackEntry + RFC 7845 OpusHead、簇内交错、流内递增校验；8 项断言含本机 ffprobe 两流实测） |
| 模型层 | ✅ timing 树 `p:audio/p:video` 的 cMediaNode 解析（vol 千分比 / mute / repeatCount 循环 / spTgt spid），与效果按文档顺序合并编号 clickGroup（媒体 clickEffect 头独立开批）；`MediaInfo` 扩展 `spid` 与 `playback`，parser 按 spid 回填；media 固件 timing 段 + 4 项断言 |
| 浏览器全链 | ✅ `presentationToVideo({ audio: true })`：页时间轴游标换算组起始毫秒 → fetch + OfflineAudioContext 解码（WAV / 可解嵌入音频）→ 混音核 → WebCodecs Opus 48kHz（isConfigSupported 前置、20ms 块、dequeue 背压）→ 毫秒时间戳交错写入；无音频媒体时无声导出、默认关闭时产物不变。真 Chrome 验收 `tooling/test-video-audio.mjs`（双轨 / Opus / 48kHz / 音轨时长边界，ffprobe 缺失环境降级为字节级断言），已挂入 `test:functional` |
| 首版边界 | 视频文件的内嵌音轨（MP4/AAC 提轨）列为后续；外链音频受 CORS 约束、失败明确报错；组号超出动画批数的媒体落在最后一批 |
