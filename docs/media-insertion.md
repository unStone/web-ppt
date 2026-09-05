# 媒体插入：WAV / MP4 阶段

按需入口 `@web-ppt/edit-core/media`，不导入 DOM 或编码器。当前交付 **PCM WAV / MP4 字节 + 自定义海报**；
外链、默认音频图标、海报替换和框架/官网工具栏仍在[任务 005](wayfinder/ppt-data-fidelity/tickets/005-media-insertion.md)中。

## 公开入口

```ts
import { createMediaEditor } from '@web-ppt/edit-core/media';

const id = createMediaEditor(editor).exec({
  type: 'AddMedia',
  slideId: editor.doc.slideOrder[0],
  rect: { x: 40, y: 60, w: 300, h: 120 },
  source: { kind: 'embedded', bytes: wavBytes, mime: 'audio/wav' },
  poster: { bytes: posterBytes, mime: 'image/png' },
});
await editor.save();
```

视频使用相同命令，将 `source` 换为 `{ kind: 'embedded', bytes: mp4Bytes, mime: 'video/mp4' }`。

| 边界 | 契约 |
|---|---|
| 音频 | 完整 RIFF/WAVE、PCM format 1、1–8 声道、8/16/24/32 bit，采样率大于 0 且不超过 192 kHz，最大 25 MiB |
| 视频 | 自包含、非加密的普通或分片 MP4，至少一条非空视频轨道，最大 25 MiB；允许同时携带音频 |
| MP4 品牌 | 主品牌或兼容品牌包含 `isom`、`iso2`–`iso9`、`mp41`、`mp42`、`avc1`、`dash` 或 `M4V ` |
| MP4 校验 | 受控品牌、box 边界、轨道头、时间基准/样本数、数据引用、样本描述与所有样本地址；零时长样本允许，外部数据引用拒绝 |
| 海报 | PNG/JPEG/GIF/WebP，签名与 MIME 一致，最大 5 MiB；与音视频分别存储 |
| 文件名 | 不接收或猜测扩展名，不按文件名信任格式 |
| 历史 | 插入、身份分配、选中同一事务；复制、删除、撤销、重做沿用结构 Patch |
| 几何 | 媒体是框架对象；可移动/缩放，不开放普通图片内容替换 |
| 资源 | 内容哈希去重；不建立第二套媒体仓库，不发网络请求 |
| 保存 | 补丁与生成保存均保留原始字节，经典 audio/video 与 Office 2010 media 关系指向同一资源 |
| 播放 | 不解码或转码，容器与地址校验不保证码流有效或所有浏览器/Office 均支持其编码；真实播放验收覆盖 PCM WAV 与 H.264/AAC MP4 |

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

## 验证与格式依据

| 命令 | 证据 |
|---|---|
| `npm run test:media` | Editor/OPC 公开契约、输入拒绝、零时长/重复样本引用、独立进程注册恢复、协同、`.ppt` 来源与两种保存、严格 DOM XML 解析 |
| `node tooling/test-media-insertion.mjs --dist` | 相同契约消费构建后的发布入口；先执行 build |
| `npm run test:editor` | Chrome 真实点击原生媒体播放，三种格式 × 两种保存均播放完成，视频产生实际画面帧；不关闭自动播放策略 |
| `npm run test:media:libreoffice` | 六种产物由 LibreOffice 打开并导出 PDF；不等价于 PowerPoint 播放证据 |
| `node tooling/check-media-boundary.mjs` | 默认入口及其静态依赖不包含上传签名校验实现 |

`p:extLst` 使用 PresentationML 命名空间，扩展中的 `p14:media` 使用独立的 Office 2010 命名空间；
从临时包装节点移出宿主时必须携带命名空间闭包，否则 Node 宽松解析可能通过而浏览器拒绝整页。
格式依据为 Microsoft 的 [p:extLst 定义](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.linq.p.extlst?view=openxml-3.0.1)、
[CT_Media](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/f8b7e1cb-976e-4f38-8139-f9e5ffa826e8) 和
[Media Part 关系](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/922b7818-6e5f-4641-a9c5-fab4063ec124)。

MP4 的 MIME 依据 [RFC 4337](https://www.rfc-editor.org/rfc/rfc4337.html)；普通样本地址联合读取
[stsc](https://developer.apple.com/documentation/quicktime-file-format/sample-to-chunk_atom)、
[stsz](https://developer.apple.com/documentation/quicktime-file-format/sample_size_atom) 与
[stco/co64](https://developer.apple.com/documentation/quicktime-file-format/chunk_offset_atom)，
[stts](https://developer.apple.com/documentation/quicktime-file-format/time-to-sample_atom) 的时间增量允许为零。
分片自包含关系参考 [W3C ISO BMFF Byte Stream Format](https://www.w3.org/TR/mse-byte-stream-format-isobmff/)；
其 MSE 特定限制不套用到普通 MP4 文件。播放固件为仓库自制 H.264/AAC 码流，固定字节由生成脚本还原，
不依赖本机 FFmpeg 版本；旧 `sample-media.pptx` 中的占位 MP4 不作为播放证据。
