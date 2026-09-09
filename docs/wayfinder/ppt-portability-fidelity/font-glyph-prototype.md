# 字体与字形原型结论

2026-09-09，004：路线可行。采用显式字体字节、可注入整形器和文稿独占 Worker；首版以静态 TTF/glyf 和横排 Latin/汉字为边界。
**后续校正：**011 的真实 FontFace 验证发现，下面记录的 6/6“可整形”中五份含非法 cmap language，Chrome 拒绝安装。正式 Provider 已补校验，详细限制见[实现记录](font-glyph-implementation.md)。本页保留历史测量，不能作为六份可安装字体的证明。

本次只交付原型及证据，[011 正式实现](tickets/011-font-glyph-implementation.md)完成后才进入 [005 矢量 PDF](tickets/005-vector-pdf.md)。

## 发现与选择

| 问题 | 实测及决定 |
|---|---|
| 自实现 cmap/hmtx 是否够用 | `AV office ffi ﬃ` 得到 15 字形、6882 字体单位；HarfBuzz 得到 11 字形、6690 单位。字距及连字不能靠逐字映射还原 |
| 组合音标 | `á q̇` 总字宽虽相同，音标需要 -36、-307 单位的独立 x 偏移；仅比总字宽会漏掉错误 |
| 同字形是否同原文 | `ffi` 与 `ﬃ` 均为 GID 44，原文却不同；保留 UTF-16 区间，PDF 不能直接把 GID 当唯一 Unicode 键 |
| 中英混排 | 固定中文字体对 `中文 ABC 你好，世界。` 输出字形、定位与轮廓；首版调用方需按脚本、方向及实际字体分 run |
| 家族与样式 | 同家族 400/700 各解析到独立 face；没有斜体时返回 `face-unavailable`，不做无依据的合成 |
| 缺字 | Latin 字体遇到 `中文😀` 返回三个缺字区间，最后一个为 UTF-16 `[2,4)`；不将 `.notdef` 记为成功 |
| 系统字体 | 只有 `Arial` 名称返回 `font-bytes-unavailable`。既有 Canvas 探测和 CSS FontFace 加载不能提供可复用的字体字节 |
| 资源结束 | harfbuzzjs 1.6.1 的 Blob/Face/Font 依赖 FinalizationRegistry，没有公开同步销毁方法；采用独占 Worker，文稿关闭时终止整个实例 |

选择按需注入 HarfBuzz，不在 core 自建 GSUB/GPOS 整形器。004 测量时使用私有依赖；011 已吸收有效样本与证明工具并删除临时实现，发布包未增加运行时依赖。
Fontkit 是另一种解析/整形/轮廓一体化候选，本轮未测其体积或正确性，不据文档宣称它更快或更轻。
参考：[HarfBuzz JS 官方 API](https://github.com/harfbuzz/harfbuzzjs)、[Fontkit 官方能力说明](https://github.com/foliojs/fontkit)。

## 容器与权限边界

| 输入 | 现有解码路径实测 | 首版决定 |
|---|---|---|
| 静态 TTF/glyf | 字形、元数据、轮廓、嵌入证明均可取得 | 支持，仍须正式输入校验与资源预算 |
| 非压缩 EOT / XOR EOT | 剥容器 / XOR 后与源 TTF 逐字节相同 | 验证外层及内层限制后接同一 TTF 路径 |
| MTX EOT | 无 hook 返回 null；接既有 mtx-decompressor 1.6.0，POI 语料 6/6 解为 TTF，49,056–146,036 字节，单次解码 3.76–18.38 ms | 需可选解码器及输出验证；不把“能解码”当成已获许可 |
| WOFF / WOFF2 | `embeddedFontToSfnt` 仅原样返回，Chrome 均能载入；provider 返回 `needs-container-decoder` | 首版不解压，须调用方显式提供合规 TTF |
| OTF/CFF | 现有函数原样返回 font/otf，Chrome 能显示 | 首版拒绝；CFF 嵌入和 PDF 字体子类型须另验 |
| 可变 TTF / TTC | 浏览器可载入可变样本；现有容器识别不代表已选择实例或 face | 首版拒绝；不能默认拿轴默认值或集合第一个 face |
| 字体名称，无字节 | 无法从现有 loader 得到 font data | 明确缺失，需显式字体来源或替换选择 |

嵌入标志样本：Restricted 拒绝；Preview & Print 只接受查看/打印、再次请求编辑仍拒绝；Editable 接受；No Subsetting 保留完整字体要求；Bitmap Only 拒绝轮廓。
原型对含糊标志采用保守拒绝。正式实现需处理 OS/2 版本差异、EOT 外层限制及独立许可依据；标志不能代替许可证。依据：[OpenType OS/2 fsType](https://learn.microsoft.com/en-us/typography/opentype/spec/os2#fstype)。

首版不覆盖：复杂脚本整形、双向与竖排、任意多对多字形重排、彩色字形、变量实例化、集合选 face、CFF 与 WOFF 解压。
这些均列入 011 的显式拒绝范围，不因为底层库支持而默认开放。

## 独立嵌入与映射证据

浏览器生成两份三行 Type0/CIDFontType2 PDF：一份含 ActualText，一份仅 ToUnicode。MuPDF 1.26.7 与 fontTools 4.61.1 独立读取结果：

| 项目 | 结果 |
|---|---|
| 提取文字 | 两份均逐字符还原 `AV office ffi ﬃ`、`á q̇`、`中文 ABC 你好，世界。`，含组合字符原始编码 |
| 嵌入字体 | 三个 PDF 字体资源与用于整形的输入 TTF 字节完全相同；重复 Latin 资源是原型简化，不作为正式资源去重设计 |
| 字形 | 29 个实际字形 ID 相同；没有未映射的 U+FFFD 或栅格图片 |
| 位置 | 最大原点误差 0.000011231 pt；是定位精度，不是文字像素保真度承诺 |
| 可视检查 | 已查看 MuPDF 2× 渲染图，连字、音标和中文可见；尚未进行多浏览器、整页 PPT 布局或 WordArt 变形验收 |
| 文件 | `out/font-glyph-prototype/font-proof.pdf`、`font-proof-tounicode.pdf`、`font-proof.svg`、`independent.json` |

PDF 证明器只处理本轮能明确分配 ToUnicode 的簇，其他多字形重排直接拒绝。正式 PDF 格式知识仍属于 005，`render/` 保持格式无关。
参考：[Adobe PDF 字体嵌入与 ToUnicode](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdflsdk/apireference/PDFEdit_Layer/PDEFont.html)。

## 加载与内存

Chrome 152.0.7977.83，本机独立进程、空配置，6 次创建/关闭 Worker，每次载入 3 个固定小样本并整形 100 次。
首次为冷加载；后五次虽禁 HTTP 缓存，仍可能复用进程内编译/模块缓存，不能当六次独立冷启动。

| 指标 | 实测 |
|---|---|
| Provider 运行文件闭包 | 550,610 字节；逐文件 gzip 合计 202,338 字节（197.60 KiB）；不含字体、PDF 证明器或未加载的 subset WASM |
| 本机测试服务的文件响应体 | 454,521 字节：JS 走 gzip，WASM 原始传输；按实读文件和服务规则合计，不含 HTTP 头。不能把上一行 gzip 合计误称为本次实际网络传输 |
| 首次 Worker 启动并就绪 | 16.4 ms；后五次 10.7–11.3 ms |
| 三个字体载入 | 合计 56,156 字节；4.0–6.4 ms |
| 100 次短文本 RPC 整形 | 每轮中位约 0.1 ms，P95 约 0.3 ms；包含轮廓序列化与 Worker 消息，接近浏览器计时粒度 |
| 加载后 WASM 线性内存容量 | 262,144 字节；从公开字体表视图的 backing buffer 读取，既非已用 malloc 字节，也非进程 RSS/峰值 |
| 关闭 | provider 持有字节归零，后续请求拒绝；Worker 6/6 退出，观察退出耗时 0.45–11.99 ms |
| 页面堆（GC 后） | 第一轮 654,548 → 第六轮 662,504 字节，backing storage 保持 5,999 字节；不含 Worker JS 堆，不等价于“零内存增长” |

Worker 的 CDP 会话本机超时，因此没有声称取得 Worker JS 堆或瞬时峰值；保留可验证的容量、所有权、退出目标和页面堆指标。
正式实现须补代表性完整中文字体、长文本、取消及并发负载。上述小样本数字不能外推到完整字体或大文稿。

## 样本、复现和架构

- [正式 API 与复现说明](../../font-glyphs.md)、[公开类型](../../../packages/fonts/src/glyphs/types.ts)。本页数字保留为 004 历史记录；011 重新测量的产物位于 `out/font-glyphs/`。
- 固定上游提交、字节 hash、改名后的 OFL 子集及许可证已移入 `tooling/font-glyph-samples/`。生成器连续两次输出完全相同，manifest 覆盖 16 份样本/许可证文件。
- 真实 MTX 只读取本地 POI 语料：`placeholder-layout-color.pptx`，SHA-256 `b683af99cf4e71db112fe87db15840846c53dbc7a6839cbf84804980d21af9ce`。未将其字体加入发布包或 OFL 子集。
- `fixtures/sample-embedfont.pptx` 的 MTX 标志样本没有真实压缩，只能验证 hook 分支；本轮没有把它计入 6 份真实 MTX。
- 004 阶段未改生产源码。011 已将正式 Provider 接入 Cordis 文稿服务，SDK 保持无框架；参见 [Cordis 约定](../../cordis-editor.md)。
- 原型临时实现、入口与私有依赖已在 011 吸收时删除；正式 API 的独立证明取代旧命令，本页原始证据及边界仍保留。

四项完整链式门禁通过；性能首轮受环境影响，按既有规则单次复测通过，未放宽预算。最终门禁、打包边界和文件 hash 见 `out/font-glyph-prototype/acceptance.json`。
