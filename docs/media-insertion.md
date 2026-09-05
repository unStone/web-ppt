# 媒体插入与海报编辑

按需入口 `@web-ppt/edit-core/media`，不导入 DOM 或编码器。支持 PCM WAV / MP4 字节、显式外链、
默认音频图标与海报替换；`editor/media`、`react/media`、`vue/media` 薄转发同一接口。
官网通过「媒体」工具转发同一接口；[任务 005](wayfinder/ppt-data-fidelity/tickets/005-media-insertion.md)仍保留
Windows PowerPoint 实测待办。

## 官网操作

| 入口 | 行为 |
|---|---|
| 编辑模式 → 工具栏「媒体」 | 选择 WAV / MP4 本机文件或显式 HTTP(S) 外链；视频必选海报，音频可用内置图标 |
| 选中媒体 →「媒体」→ 替换海报 | 仅替换海报，不改变媒体源；锁定对象与 MC 兼容外壳不开放此操作 |
| 选中媒体 →「媒体」→ 播放 | 使用浏览器原生控件试听 / 播放；不改变画布投影、编辑历史或保存内容 |
| 外链加载失败 / 解码失败 / 超时 | 明确提示并保留海报与源，可重试或继续保存；不会将外链偷偷转为嵌入 |
| 恢复媒体日志 | 确认恢复后自动按需注册；普通文字、形状编辑与恢复不加载媒体模块 |
| 取消 / 切换文稿 | 停止播放器并释放工具；媒体输入内拖放不会触发打开 PPT |

工具的代码、DOM 和样式均按需加载；外链直到明确点击播放才赋给播放器，不依赖 `preload` 提示来保证
零提前请求。官网不上传文件、不转码，也不提供离线外链播放保证。

## 公开入口

```ts
import { createMediaEditor } from '@web-ppt/edit-core/media';

const id = createMediaEditor(editor).exec({
  type: 'AddMedia',
  slideId: editor.doc.slideOrder[0],
  rect: { x: 40, y: 60, w: 300, h: 120 },
  source: { kind: 'embedded', bytes: wavBytes, mime: 'audio/wav' },
});
await editor.save();
```

音频省略 `poster` 时采用确定性 PNG 喇叭图标，也可自定义。视频使用相同命令，将 `source` 换为
`{ kind: 'embedded', bytes: mp4Bytes, mime: 'video/mp4' }`，并提供 `poster: { bytes: posterBytes, mime: 'image/png' }`。

```ts
const media = createMediaEditor(editor);
const linked = media.exec({
  type: 'AddMedia', slideId: editor.doc.slideOrder[0],
  rect: { x: 40, y: 60, w: 300, h: 180 },
  source: { kind: 'external', mediaKind: 'video', url: 'https://example.test/video' },
  poster: { bytes: posterBytes, mime: 'image/png' },
});
media.exec({ type: 'ReplaceMediaPoster', id: linked,
  poster: { bytes: newPosterBytes, mime: 'image/png' } });
```

| 边界 | 契约 |
|---|---|
| 音频 | 完整 RIFF/WAVE、PCM format 1、1–8 声道、8/16/24/32 bit，采样率大于 0 且不超过 192 kHz，最大 25 MiB |
| 视频 | 自包含、非加密的普通或分片 MP4，至少一条非空视频轨道，最大 25 MiB；允许同时携带音频 |
| MP4 品牌 | 主品牌或兼容品牌包含 `isom`、`iso2`–`iso9`、`mp41`、`mp42`、`avc1`、`dash` 或 `M4V ` |
| MP4 校验 | 受控品牌、box 边界、轨道头、时间基准/样本数、数据引用、样本描述与所有样本地址；零时长样本允许，外部数据引用拒绝 |
| 海报 | PNG/JPEG/GIF/WebP，签名与 MIME 一致，最大 5 MiB；与音视频分别存储 |
| 外链 | 显式 `mediaKind` + 绝对 HTTP(S) URL，最多 8192 字符；拒绝凭据、控制字符、反斜杠及其他协议。不抓取、不猜 MIME，不保证 URL 可达或浏览器可播放 |
| 文件名 | 不接收或猜测扩展名，不按文件名信任格式 |
| 历史 | 插入、身份分配、选中同一事务；复制、删除、撤销、重做沿用结构 Patch |
| 几何与海报 | 媒体可移动/缩放；用专用命令换海报，不改媒体源，不开放普通图片替换/裁剪。原本无海报也可添加；MC 兼容分支仍只能整壳编辑 |
| 资源 | 内容哈希去重；不建立第二套媒体仓库，不发网络请求 |
| 保存 | 嵌入媒体的两种保存均保留原字节与双关系；外链的经典 audio/video 与 p14 关系均标记 External，离线重开仍是外链 |
| 播放 | 不解码或转码，容器与地址校验不保证码流有效或所有浏览器/Office 均支持其编码；真实播放验收覆盖 PCM WAV 与 H.264/AAC MP4 |

`.ppt` 无 OOXML 原包时支持媒体插入、海报替换、历史、恢复及另存 PPTX；原有 `copyElements` 仍要求
OOXML 来源，先保存并重开后再复制。不要提前释放被编辑器借用的原包再继续编辑；释放后的救援式生成保存
与真正无原包的 `.ppt` 编辑是两种不同生命周期。

## 恢复与协同接收端

接收新媒体结构 Patch 前需要显式注册校验器；仅副作用导入可能被打包器删除。
发起插入的 `createMediaEditor` 会自动注册，接收端不必创建插入工具：

```ts
import { registerMediaEditing } from '@web-ppt/edit-core/media';

registerMediaEditing();
// 然后建立带 recoveryFrames 的 Editor，或绑定协同适配器。
```

未注册时，新音视频资源会被已有模型校验拒绝，不会作为未经验证的上传写入原包。
已经保存的 PPTX 仍可通过默认解析入口查看，不需要媒体插入扩展。

普通 Patch 传输使用 `subscribePatches` → `applyExternalPatches`；事件包含被引用的图片资源，避免接收端
撤销回收后无法重做。恢复日志使用 `recoveryFrames`，不要把恢复帧当作传输协议。完整传输闭包仍受既有
事务上限约束，提交前同时校验历史的撤销与重做闭包，即使暂未订阅也不会产生以后无法传输的历史。
超限原子拒绝，不拆散事务或推进协同序号；连续操作合并后超限时保留独立撤销单元。

## 验证与格式依据

| 命令 | 证据 |
|---|---|
| `npm run test:media` | Editor/OPC 公开契约、输入拒绝与零网络请求、注册恢复、并发及撤销重做协同、`.ppt` 来源与两种保存、严格 DOM XML 解析 |
| `node tooling/test-media-insertion.mjs --dist` | 相同契约消费构建后的发布入口；先执行 build |
| `npm run test:editor` | Chrome 真实点击嵌入/外链媒体、解码默认及替换海报，视频产生实际画面帧；不关闭自动播放策略 |
| `node tooling/test-site-editor-browser.mjs` | 官网插入、海报替换、撤销重做、冷启动恢复、保存重开；MP4 断网播放、外链延迟访问、404 降级、连续重试及关闭后的资源释放 |
| `npm run test:media:libreoffice` | 共享媒体产物清单由 LibreOffice 打开并导出 PDF；不等价于 PowerPoint 播放证据 |
| `node tooling/check-media-boundary.mjs` | 默认静态依赖不包含上传校验或图标；三种框架按需入口转发同一实现 |

`p:extLst` 使用 PresentationML 命名空间，扩展中的 `p14:media` 使用独立的 Office 2010 命名空间；
从临时包装节点移出宿主时必须携带命名空间闭包，否则 Node 宽松解析可能通过而浏览器拒绝整页。
格式依据为 Microsoft 的 [p:extLst 定义](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.linq.p.extlst?view=openxml-3.0.1)、
[CT_Media](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/f8b7e1cb-976e-4f38-8139-f9e5ffa826e8) 和
[Media Part 关系](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/922b7818-6e5f-4641-a9c5-fab4063ec124)。
海报沿用 [p:blipFill](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.blipfill?view=openxml-3.0.1)
中的 DrawingML 图片引用，不触碰音视频关系；新增 blip 位于裁剪与填充模式之前。

MP4 的 MIME 依据 [RFC 4337](https://www.rfc-editor.org/rfc/rfc4337.html)；普通样本地址联合读取
[stsc](https://developer.apple.com/documentation/quicktime-file-format/sample-to-chunk_atom)、
[stsz](https://developer.apple.com/documentation/quicktime-file-format/sample_size_atom) 与
[stco/co64](https://developer.apple.com/documentation/quicktime-file-format/chunk_offset_atom)，
[stts](https://developer.apple.com/documentation/quicktime-file-format/time-to-sample_atom) 的时间增量允许为零。
分片自包含关系参考 [W3C ISO BMFF Byte Stream Format](https://www.w3.org/TR/mse-byte-stream-format-isobmff/)；
其 MSE 特定限制不套用到普通 MP4 文件。播放固件为仓库自制 H.264/AAC 码流，固定字节由生成脚本还原，
不依赖本机 FFmpeg 版本；旧 `sample-media.pptx` 中的占位 MP4 不作为播放证据。
