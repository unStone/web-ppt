---
title: 替换并裁剪图片内容
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./006-preserving-xml-tree.md
  - ./008-command-patch-history.md
  - ./014-editor-session-static-view.md
  - ./042-add-image.md
---

## Question

如何让任意 UI 框架通过可结构化克隆的 `ReplaceImage { id, bytes, mime }` 和
`SetCrop { id, crop }`，完成图片替换、恢复来源裁剪与双矩形裁剪手势，同时让即时 SVG 预览、
多 view/edit、撤销重做、复制粘贴和保存重开保持同一语义？本票只编辑普通嵌入/链接图片的内容与
矩形源裁剪；不实现图片填充、蒙版形状、艺术效果、滤镜或视频海报编辑。

`crop` 使用 `{ l, t, r, b }` 的归一化边距，四项都必须有限且位于 `[0, 1)`，并满足
`l + r < 1`、`t + b < 1`；入口量化到 DrawingML 的 1/1000% 精度。`null` 删除本次会话的直接
覆盖并恢复来源 `a:srcRect`，全零值明确表示不裁剪。替换图片保留元素身份、几何、翻转、旋转、裁剪、
描边、效果、动画目标及未知宿主 XML，只改变图片资源；支持 PNG/JPEG/GIF/WebP，魔数必须与声明 MIME
相符。命令只接受 `full` 可编辑的 image，拒绝音视频、锁定、错误类型、空字节、非法字段和超限输入。
同值提交严格 no-op；批量命令继续原子执行，任一目标失败时模型、身份、选区、资源闭包与历史整笔不变。

公开 `queryElementCrop` 返回规范化有效裁剪、mixed 状态及是否存在直接覆盖，UI 不读取内部 `src/ovr`。
React、Vue、Svelte、Web Component 或原生工具栏可以直接绑定四边输入、重置按钮和文件选择器。基础 DOM
视图中，双击图片进入裁剪模式：元素框与原图范围以双矩形呈现，拖动四边/四角只在交互层按 rAF 更新，
松手才提交一次历史；Esc 取消本次手势并退出，Enter 或外部点选提交/退出。旋转、翻转、组变换和三档缩放
下，屏幕手柄尺寸与命中阈值保持恒定；view 模式不得安装编辑事件或产生交互 DOM。

替换资源进入文档级 SHA-256 媒体闭包，相同内容跨替换、新增、复制粘贴只写一个 media part；既有共享
媒体不能因替换而被删除，连续替换/撤销/重做/保存不得泄漏不可达的新增 part。保存从首次触碰的 slide
基线重建：`a:srcRect` 按 schema 顺序最小插入/删除，替换只重定向目标 `a:blip@r:embed`，必要时新增
slide 关系、`ppt/media/*` 与 `[Content_Types].xml`。未触碰元素、兄弟关系、未知属性/节点、外链关系、
`mc:AlternateContent` 和其它 OPC part 保持原始字节；新增图片、复制粘贴和保存后撤销重做共用同一物化主干。

确定性固件覆盖无裁剪、四边裁剪、显式全零、旋转/翻转、嵌套组、共享媒体、外链图片、未知尾随 XML 及
四种图片格式。Node 从公开命令/查询验证历史、mixed、reset/none、非法输入、资源去重和原子批量；保存
契约验证最小 XML 差异、关系/媒体闭包、重开、identity、复制/新增和连续保存；独立进程比较 HTML/SVG，
真实 Chrome 验证双矩形、三档缩放、变换、多 view 增量 DOM 与 60 图片完整反馈 p95 不超过 16ms，裁剪
拖动帧 p95 不超过 8ms。LibreOffice 用非对称像素图验证替换与四边裁剪且无修复打开；Windows PowerPoint
COM 工件继续进入自动清单环境执行。

## Resolution

已完成普通图片内容替换与矩形源裁剪闭环：

- `edit-core` 新增 `ReplaceImage`、`SetCrop`、`queryElementCrop`，以 1/1000% 精度、严格 no-op、原子 Patch、SHA-256 媒体闭包和公开投影统一替换、重置、撤销重做与跨实例复制；核心命令在复制/Base64 前执行 5MB 上限，图片字节由文档级哈希资源表托管，历史只保存资源引用。
- 历史预算计入“仅因撤销而常驻”的 Base64 资源；条数/字节驱逐、clear、redo 丢弃和 rebase 后按当前模型与双向历史做可达性回收。资源在不可信入口完整校验后按对象缓存，普通文字、变换或裁剪 Patch 不再重复解码与 SHA-256 大图。
- 保存从来源 slide 基线最小物化 `a:srcRect` 与 `a:blip@r:embed`；已有 `srcRect` 原位更新四边并保留未知属性/子节点，替换、新增、复制三条路径按内容共用媒体 part，最后引用消失后才回收，连续保存保持 identity。
- `@web-ppt/editor` 公开 Blob/文件选择替换入口和可编排裁剪模式；双击图片进入双矩形裁剪，原图框按十万分精度反算真实扩展范围，8 个手柄只在 rAF 交互层预览，松手或 Enter 提交一个“裁剪图片”历史单元，Esc 取消，外部点选与 view 模式边界完整。
- 新增一页确定性固件，覆盖外链、PNG/JPEG/GIF/WebP、共享媒体、来源裁剪、显式全零、旋转翻转、嵌套组和 `srcRect` 未知扩展；连续生成 SHA-256 均为 `1c42fa47572ca8ba1c2f7013c7df94708b0e335581e23cfde9013d9708cd3ca6`。
- Node 通过 636 项 edit-core、242 项保存与 283 项 editor 断言，补齐同像素 no-op、mixed 查询、资源回滚、三路去重、5MB 上限、大图片历史预算/回收、无关 Patch 热路径、极限裁剪和 Enter 提交；Chrome 三档缩放及嵌套变换的裁剪框/命中误差均为 0，60 图片提交 p95 0.5ms、拖动帧 p95 0.1ms。
- 真实 LibreOffice 清单全部通过；非对称替换图按固定坐标验证 5×4 有序裁剪/翻转像素并复用 2 个共享位图，不能再由颜色集合掩盖轴向错误。`image-content.pptx` 已加入 Windows PowerPoint COM 自动清单（本机 macOS 不执行 COM）。同时修正既有 `shape-effects.pptx` 页数清单由 1 为 2，使完整 Office 门禁与实际产物一致。
- 最终执行 `npm run check && npm test && npm run build`：56 份固件 / 169 页 / 338 对独立进程 SVG 指纹一致，全部测试与五个发布包构建通过。
