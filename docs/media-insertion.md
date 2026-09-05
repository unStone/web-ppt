# 媒体插入：WAV 阶段

按需入口 `@web-ppt/edit-core/media`，不导入 DOM 或编码器。当前只交付 **PCM WAV 字节 + 自定义海报**；
MP4、外链、默认音频图标、海报替换和框架/官网工具栏仍在[任务 005](wayfinder/ppt-data-fidelity/tickets/005-media-insertion.md)中。

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

| 边界 | 契约 |
|---|---|
| 音频 | 完整 RIFF/WAVE、PCM format 1、1–8 声道、8/16/24/32 bit，采样率大于 0 且不超过 192 kHz，最大 25 MiB |
| 海报 | PNG/JPEG/GIF/WebP，签名与 MIME 一致，最大 5 MiB；与音频分别存储 |
| 文件名 | 不接收或猜测扩展名，不按文件名信任格式 |
| 历史 | 插入、身份分配、选中同一事务；复制、删除、撤销、重做沿用结构 Patch |
| 几何 | 媒体是框架对象；可移动/缩放，不开放普通图片内容替换 |
| 资源 | 内容哈希去重；不建立第二套媒体仓库，不发网络请求 |
| 保存 | 补丁与生成保存均输出相同字节，经典 audio 与 Office 2010 media 关系指向同一资源 |
| 播放 | 容器校验不是所有浏览器/Office 编解码能力的承诺；超出上述上传契约的文件在插入时拒绝 |

## 恢复与协同接收端

接收新媒体结构 Patch 前需要显式注册校验器；仅副作用导入可能被打包器删除。
发起插入的 `createMediaEditor` 会自动注册，接收端不必创建插入工具：

```ts
import { registerMediaEditing } from '@web-ppt/edit-core/media';

registerMediaEditing();
// 然后建立带 recoveryFrames 的 Editor，或绑定协同适配器。
```

未注册时，新 WAV 资源会被已有模型校验拒绝，不会作为未经验证的上传写入原包。
已经保存的 PPTX 仍可通过默认解析入口查看，不需要媒体插入扩展。

## 验证与格式依据

| 命令 | 证据 |
|---|---|
| `npm run test:media` | Editor/OPC 公开契约、输入拒绝、独立进程注册恢复、协同、`.ppt` 来源与两种保存、严格 DOM XML 解析 |
| `node tooling/test-media-insertion.mjs --dist` | 相同契约消费构建后的发布入口；先执行 build |
| `npm run test:editor` | Chrome 真实点击原生音频播放，从两种保存产物解码并播放完成，不关闭自动播放策略 |
| `npm run test:media:libreoffice` | 两种产物由 LibreOffice 打开并导出 PDF；不等价于 PowerPoint 播放证据 |
| `node tooling/check-media-boundary.mjs` | 默认入口及其静态依赖不包含上传签名校验实现 |

`p:extLst` 使用 PresentationML 命名空间，扩展中的 `p14:media` 使用独立的 Office 2010 命名空间；
从临时包装节点移出宿主时必须携带命名空间闭包，否则 Node 宽松解析可能通过而浏览器拒绝整页。
格式依据为 Microsoft 的 [p:extLst 定义](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.linq.p.extlst?view=openxml-3.0.1)、
[CT_Media](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/f8b7e1cb-976e-4f38-8139-f9e5ffa826e8) 和
[Media Part 关系](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/922b7818-6e5f-4641-a9c5-fab4063ec124)。
