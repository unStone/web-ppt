---
title: 插入可预览可保存的图片
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./007-zip-passthrough.md
  - ./008-command-patch-history.md
  - ./014-editor-session-static-view.md
  - ./029-element-clipboard.md
  - ./041-add-slide-from-layout.md
---

## Question

如何让任意 UI 框架通过公开纯数据命令
`AddImage{ slideId, bytes, mime, rect, placeholderId? }`，把浏览器本地图片一次提交为立即可见、可选择、可变换、可撤销、
可保存和可重开的图片元素，而不是让工具栏直接拼 `data:` URL、修改 DOM，或为编辑态另造一条图片渲染链路？
本票只插入新图片；裁剪、替换、透明度/滤镜、裁进形状和 SVG 清洗另行拆票。

首版只接受 PNG、JPEG、GIF 与 WebP 栅格图。实现必须按字节魔数识别真实格式，拒绝 MIME 与内容不一致、
空字节、非有限或非正尺寸和超出 PowerPoint 坐标范围的输入；不得因为调用者在提交后修改原
`Uint8Array` 而改变预览、撤销历史或保存结果。SVG 不进入本票，因为外部引用、脚本、字体和序列化安全边界
必须先有独立清洗规格。图片字节不上传服务端，不解码重编码，原始字节按 SHA-256 内容哈希去重。

`Editor.exec(AddImage)` 只生成一个可逆的 `ElementTreePatch`。命令原子分配会话稳定且不复用的 `ElementId`、
part 级 `p:cNvPr@id`、图片关系 id 和必要的媒体 part；失败必须连同身份水位、结构、资源闭包、选区和历史
完整回滚。相同字节无论已存在于原包还是由本会话插入，都复用同一 `ppt/media/imageN.ext`，但每个
`p:pic` 保留独立关系和元素身份。新增页必须避开版式关系占用的 rId，撤销、重做和连续保存不得泄漏孤儿
关系、媒体 part 或 Content Types 项。历史与变更事件不得重复复制大字节；至少证明常见 2MB 图片不会因为
一次提交就失去撤销能力。

`placeholderId` 只允许指向目标页中空的图片占位符，并在同一结构 patch 组中以新图片替换它；非法、非空、
跨页或锁定占位符必须整笔拒绝。图片投影继续使用既有 `ImageElement` 和 core 的 view/edit、HTML/SVG、PNG/打印渲染路径。生成的 `p:pic`
严格遵守 DrawingML sequence，几何按 px × 9525 写为 EMU，立即投影的 `src` 与最终媒体字节一致；插入后自动
选中新元素，既有移动、缩放、旋转、层级、删除、复制粘贴、撤销重做均无需图片特判。

保存必须只改目标 `ppt/slides/slideN.xml`、对应 rels、必要时 `[Content_Types].xml`，并只在内容哈希未命中时
新增唯一媒体 part；其它 ZIP part 原始字节直通。连续保存、保存后撤销/重做、同内容跨页插入和新增页插入
都必须重开等价。保存前后的 HTML/原生 SVG 逐页投影以独立进程指纹验证；LibreOffice 必须无修复打开并让
图片位置、尺寸和像素内容与浏览器投影一致，真实 PowerPoint 产物纳入现有 Office 门禁清单。

无框架浏览器包提供公开、可替换的本地文件选择入口：工具栏或空图片占位符只调用 `AddImage`，读取期间有
可访问状态，取消不产生历史；错误说明具体格式或大小原因。粘贴板中的图片也汇入同一命令，不能维护第二套
关系/资源算法。edit 模式可显示插入入口和空图片占位符提示，view 模式、静态 SVG、PNG、打印和保存文件均
不得出现编辑辅助 UI。React、Vue、Web Component 只消费命令、订阅和挂载 seam，不进入本票发包。

确定性固件至少包含既有同哈希媒体、媒体编号缺口、高位 spid/rId、尾随未知 XML、空图片占位符，以及新增页
的版式 rId。Node 先验证公开命令、四种格式、非法输入、字节不可变、投影、选区、关系/媒体去重、历史、事务
回滚、连续保存、撤销后保存、重开和只改预期 OPC parts；真实 Chrome 验证文件选择、占位符和粘贴均立即
显示并可移动，60 元素页面插入常见图片从命令到完整反馈 p95 不超过 16ms（文件读取和浏览器图片解码单独
计时），取消或错误无副作用。2MB 图片的命令提交与历史内存增量必须实测并记录，不用虚假小图替代。

## Resolution

以公开纯数据命令 `AddImage { slideId, bytes, mime, rect, placeholderId? }` 完成图片闭环。PNG、JPEG、GIF、
WebP 先按容器和实际像素载荷识别，调用者字节立即复制；模型只保留 SHA-256 token，投影时才水合 data URI。
媒体哈希和 part 名在整个文档内分配，同内容跨页复用、不同内容不争用；图片、关系、Content Types、占位符
替换、选区与历史共用一个可逆结构 patch。既有移动、缩放、旋转、层级、删除和复制粘贴无需图片特判。

无框架 DOM 包公开 `insertImage` / `chooseImage`，本地文件选择、图片占位符和系统图片粘贴汇入同一命令。
浏览器无论是否给定矩形都先真实解码；默认 5MB 上限守住 8MB 撤销预算，读取期间公开 `aria-busy`，格式、
大小和异步切换 view/页面均明确拒绝且不产生历史。pointer/dblclick 路由已从视图生命周期装配中独立分层；
view、静态 SVG、PNG、打印和保存文件不含辅助 UI。保存只改变目标 slide/rels、必要的 Content Types 和
唯一媒体 part，连续保存、撤销重做、新增页、跨页同/异哈希及独立进程 HTML/SVG 指纹均闭环。

验收证据：确定性固件 SHA-256 为
`382684446b040ba9e45557681df55d79404d28b6b197fd7320966d00f5acc393`；core 2120、edit-core 522、
保存 106、editor 250、图元文件 130 项断言全绿，46 份固件 / 144 页 / 288 对独立进程 SVG 指纹一致。
真实 Chrome 图片几何偏差 0、60 元素完整反馈 p95 0.500ms；LibreOffice 无修复打开全部 16 份保存产物，
新增图片 frame 最大偏差 0.867 SVG unit，WebP 像素为 `255/0/0`。`node --expose-gc` 对 2,431,458-byte
确定性 PNG 实测 `Editor.exec(AddImage)` 99.66ms，历史计费 3,243,972 bytes，保留堆增量 6,800,248
bytes，`arrayBuffers` 增量 0，默认历史仍保留撤销。最终 `npm run check && npm test && npm run build`
全绿；编辑主入口 62.33KB gzip，DOM editor 32.71KB gzip。真实 PowerPoint 产物已加入 16 项 Office
manifest；Windows 实机执行仍由未关闭的 [010 Office 门禁](010-prove-m1-save.md) 跟踪。
规格与工程规范复审均为 Findings 0。
