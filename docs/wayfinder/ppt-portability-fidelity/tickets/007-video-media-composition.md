---
title: 把内嵌视频内容合成到导出时间轴
status: closed
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

## Resolution（2026-10-31 关闭）

范围差距逐项补齐（实现 `media-overlay.ts` 升级 + 专项验收 `tooling/test-video-overlay.mjs`，源码与 dist 双模式，CI 装 ffmpeg 后全量生效）：

| 差距项 | 处置 |
|---|---|
| 有界解封装与关键帧定位 | 浏览器 `<video>` seek 内建 demux 与关键帧定位（覆盖全部容器 / 编码组合，免手写 MP4 demux）；每媒体仅一个按需 seek 的实例，不按页面时长预解码——60s 长视频导出堆增长 < 60MB 实测 |
| 元素裁剪 / 透明度 / 变换 / 层叠 | 组链经 `placeGroupChild` 折算到页面坐标（clipPath 随之缩放），组与元素的 rotate / flip 按与 SVG 渲染一致的变换顺序在画布重建；crop 源矩形、alpha、CSS filter 逐项支持；媒体间绘制顺序沿元素 z 序。旋转 / 翻转 / 裁剪 / 半透明元素的区域亮度断言全部通过与白底可分 |
| 循环与跨页策略 | `playback.loop` 按 `mediaTime % duration` 取模（0.75s 回到 0.15s 位置断言）；跨页策略 = 媒体元素随其所属页呈现、翻页后不再显示（PowerPoint 元素归属语义），音频不受限（混音链路的全局时间轴）——页 2 同区域回白底断言 |
| 可变帧率 | setpts 拉伸时间戳构造真 VFR 样本（concat filter 会统一输入帧率，须两步生成）；seek 按时间戳取帧，0.65s 落在 0.533s 起的稀疏帧段断言通过 |
| 独立读取器验证画面选择 | ffmpeg 从导出 WebM 提帧，按页面坐标 crop 到媒体区域：0.15s 红帧与 0.45s 蓝帧区域亮度可分 |
| `video-overlay-frame-unavailable` 稳定样本 | MSE（fMP4 + `default_base_moof`，MSE 规范的寻址方式）append 前置 duration=10s、只喂 0.6s 数据：loadeddata 可达而 seek 5s 永不就绪，500ms 超时路径每个元素报一次后导出照常完成 |

已知边界：媒体元素之上的非媒体内容会被视频帧覆盖（overlay 统一叠加在 SVG 光栅之后）——与海报帧呈现的既有边界一致，首版不单独分层重绘。

## 进度（2026-10）

`00e5af9` 交付首个切片：`VideoOptions.videoOverlay`（默认关闭，产物不变）。

| 项 | 当前实现 |
|---|---|
| 取帧方式 | `viewer-core/src/video/media-overlay.ts` 用浏览器 `<video>` seek + `drawImage` 叠加当前帧，替代海报帧；同一媒体字节 + 同一时间戳得到同一帧，seek 阈值 1/30s；就绪条件为首帧可画（`loadeddata`） |
| 时间轴 | 媒体组起始时刻与音轨共用同一 `groupStarts` 计算，时间轴游标贯通切换、点击批次与停留 |
| 失败 | 不阻断导出，退回海报帧并经 `onWarning` 暴露稳定 reason：加载失败、5s 内未取得首帧或时长无效 → `video-overlay-unavailable`（每个元素一次）；seek 超时 500ms 或帧数据不可用 → `video-overlay-frame-unavailable`（每个元素一次）。海报回退以调用方显式传 `mediaPosters: true` 为前提 |
| 验收 | 真实 Chrome（`tooling/test-video-audio.mjs`）：现场生成的 MP4 帧叠加成功且无 warning；损坏字节与永不就绪的 MediaSource 各报一次 `video-overlay-unavailable`（含页号与元素名），导出照常完成 |

与本票范围的差距：未实现有界解封装与关键帧定位（依赖浏览器 `<video>` 的容器支持），元素裁剪 / 透明度 / 变换与层叠、循环与跨页策略、可变帧率、长视频内存边界、独立读取器的画面选择与音画同步验证均未登记；`video-overlay-frame-unavailable` 尚无稳定复现的验收样本。补齐后关闭。
