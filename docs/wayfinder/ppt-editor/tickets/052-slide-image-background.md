---
title: 上传并裁剪页面图片背景
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./007-zip-passthrough.md
  - ./008-command-patch-history.md
  - ./042-add-image.md
  - ./049-replace-crop-image.md
  - ./051-edit-slide-background-hidden.md
---

# 上传并裁剪页面图片背景

## 为什么

页面背景已经能编辑矢量填充，但真实演示文稿常用照片、纹理和品牌底图。若只能把图片作为普通元素铺满页面，用户会遇到误选、层级错误、版式变化后尺寸失配，以及保存后不再是 PowerPoint 背景的问题。因此图片必须进入页面背景语义，并复用现有二进制资源闭包，不能在命令历史中复制大字节。

## 范围

- 支持从浏览器文件字节直接设置或替换当前页图片背景。
- 支持读取并修改新上传背景和源文件已有图片背景的裁剪矩形。
- 支持拉伸与平铺语义、透明度、恢复源背景，以及切回矢量或无背景。
- 图片资源按内容散列去重；历史补丁只记录资源引用和背景元数据，不重复保存图片字节。
- 仅目标页进入 `renderSlides`；共享图片资源不会让其他页面重绘。
- 保存为合法的 `p:bg/p:bgPr/a:blipFill`，同时维护页面关系、媒体部件和 `[Content_Types].xml`。
- 新建页、复制页、撤销/重做、保存后再次编辑必须保持稳定。
- 提供框架无关的裁剪几何/命令接口，React、Vue 或原生 DOM 不需要理解 OPC 关系。

## 不在范围

- 母版或版式背景编辑。
- 图片压缩、滤镜、自动抠图或智能焦点选择。
- 页面换版式与演讲者备注。

## 接口约束

- 延续现有 `SetBackground` 的矢量与重置语义；图片上传使用显式命令，调用方无需手工创建关系或资源 token。
- 裁剪值采用现有 `Fill` 图片裁剪的归一化比例；非法值、空字节、伪造 MIME 和超限资源必须原子失败。
- 源背景来自版式/母版且页面没有直接背景时，第一次裁剪应创建页面级直接覆盖，不修改共享版式。
- `null` 重置必须恢复源文件有效背景；显式 `none` 仍表示直接无填充。

## 保存约束

- 写回 `a:blip@r:embed`、`a:srcRect` 与 `a:stretch/a:fillRect` 或 `a:tile`，保留未知属性、扩展节点和未触碰的背景选择分支。
- 替换源图片背景时可保留旧关系与媒体部件，除非能证明不再被任何未知内容引用；正确性优先于垃圾回收。
- 重复保存不得持续新增等价关系或媒体文件。

## 验收

- [x] 先补失败测试，再实现命令、查询、投影、资源闭包与保存。
- [x] 覆盖上传、同图去重、替换、源背景裁剪、拉伸/平铺、透明度、重置、撤销/重做、新建页和复制页。
- [x] 使用确定性固件覆盖图片背景、裁剪、平铺、未知扩展和共享媒体；连续生成两次字节一致。
- [x] 保存后重开，编辑模型与独立渲染指纹保持等价。
- [x] LibreOffice 可打开产物，背景像素与页面数量正确；产出供 PowerPoint 人工验收的文件和清单。
- [x] Chrome 中验证至少两个编辑视图同步；200 页文档的单页图片背景编辑模型 p95 与目标页完整绘制 p95 均低于 16ms。
- [x] `npm run check && npm test && npm run build` 全绿。

## 关闭记录

- `SetBackgroundImage` 与 `SetBackgroundCrop` 把上传、替换、源背景裁剪、透明度和拉伸/平铺统一为稳定页身份上的原子命令；`SlideImageBackground` 只在页面记录中保存内容寻址资源引用，历史 patch 不复制二进制。同一图片跨页、复制页和新增页复用同一媒体闭包。
- 来源或版式图片第一次裁剪会物化为页面级直接覆盖，既不污染共享版式，也不要求 UI 理解 OPC。`@web-ppt/editor` 公开 `setBackgroundImage(Blob)`、文件选择和 `setBackgroundCrop`，edit/view 多视图共享会话且 view 模式拒绝写操作。
- 保存原位修补 `p:bg/p:bgPr/a:blipFill`，维护 `r:embed`、`srcRect`、`alphaModFix`、stretch/tile、关系、媒体和内容类型，同时保留未知扩展。保存后重开投影、HTML/SVG 独立进程指纹、连续保存幂等，以及全部恢复后原包逐字节身份均通过。
- 确定性固件 `fixtures/sample-editor-slide-image-background.pptx` 连续两次 SHA-256 均为 `07e6ddc726b3d6b1f4ace9de77a1675978a00c3d17cfdf88371a77280c082013`。Office 产物为 `out/edit-save/slide-image-background.pptx`（5 页）和单页平铺真值 `out/edit-save/slide-image-background-tile-oracle.pptx`，均进入统一清单。
- Chrome 以 4×2 非对称像素图验证裁剪后的正常、水平、垂直和双向翻转平铺；最终全仓门禁中 200 页模型提交/目标页完整上屏 p95 为 `9.2/9.5ms`。两个同页编辑视图同步、另一页 DOM 身份保持不变。LibreOffice 已验证源图/上传图像素、`fillRect`/透明度、5 页页数和共享媒体重存语义，并明确锁定其忽略页面背景 `srcRect` 的行为；裁剪由 Chrome 像素和保存后 XML 重开验证。单页 oracle 以 `1650×1142` pattern 验证图片物理尺寸、居中对齐与偏移相位；全量 30 份 Office 产物均可打开并导出。
- 固定点双轴审查补齐两项根因：图片 stretch 现在真实拉伸，tile 逐格应用裁剪和交替翻转；继承版式图片首次物化会克隆生效的 `p:bg` 再局部修补，来源宿主、blip、srcRect 未知扩展均保留。媒体汇集命名、Blob 读取和 tile 校验也已收敛到单一实现。
- 第二轮双轴审查继续追到 OOXML 真值：tile 尺寸改由图片像素、嵌入 DPI 或 `blipFill@dpi` 推导，并完整支持 `tx/ty/algn`；继承背景克隆会物化祖先命名空间、重映射未知扩展关系和全部媒体资源。BMP/SVG/TIFF/EMF/WMF/PICT 仅允许复用当前 OPC 已有哈希，远端 Patch 不能借扩展格式绕过上传白名单；保存后恢复来源再裁剪固定读取初始基线。
- 第三轮双轴审查继续收紧保存边界：同页源背景裁剪复用原关系与媒体，伪造关系不能进入模型；上传替换会清除旧 `blipFill@dpi`，源背景裁剪则保留其 DPI。可信 OPC 资源改按散列、MIME、扩展名与实际目标 part 的完整身份校验，继承背景未知扩展引用的音频等非图片媒体也会闭包保存，但不能成为背景图片入口；JPEG 同时读取 JFIF 与 EXIF 分辨率。
- 最终复审把 `reuseRelationships`、`preserveSourceDpi` 两个可伪造保存策略字段从模型中移除：来源裁剪改存可由原包或首次保存基线回证的 `sourcePart`，关系复用、DPI 与媒体创建状态均从实际 OPC 推导。白名单上传不再扫描全包媒体；未知扩展关系必须逐项匹配来源闭包；平铺物理尺寸必须由真实图片与 DPI 重算。直接背景裁剪后复制、连续保存、重置再裁剪也已保存重开等价。
- 收口复审把公开 JSON Patch 与包内可信命令明确分界：远端 `SlideTreePatch` / `ElementTreePatch` 先在写时复制的完整暂存模型中校验，失败不触碰真实文档；本地事务只在末尾做一次全局校验，60 元素批量删除仍为 `5.2ms`。结构快照内嵌资源会逐字节验真并校验关系闭包，目标后缀、MIME 与精确 Content-Type Override 必须一致，保存层另有冲突守卫。上传/替换使用内容寻址目标名，只检查确定候选，不再枚举或哈希整个 OPC 包。
- 固定点复审进一步消除了“历史记录永远可信”的错误前提：undo/redo 在远端写入后重新走完整暂存模型，远端页占用待重做 OPC 身份时会原子拒绝且不移动历史游标。普通变换 Patch 不再扫描全页或复制媒体资源表，只有资源 Patch 才做写时复制；继承背景首次裁剪按来源 `.rels` 精确重映射，不建立全包媒体索引；关系校验预建 `part → 来源宿主`，大量复制页保持线性。60 元素删除/撤销/重做 p95 为 `7.3/4.0/2.7ms`。
- 最终精确执行 `npm run check && npm test && npm run build`：core 2130、edit-core 696、保存 274、PowerPoint 报告 9、editor 288、59 份固件 / 181 页 / 362 对独立 SVG 指纹、metafile 130 全绿，五个发布包构建成功；LibreOffice 全量 30 份 Office 产物均成功打开并导出。
