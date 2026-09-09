# 矢量 PDF 实现进度

[005](tickets/005-vector-pdf.md) 进行中；[011 字体前置](font-glyph-implementation.md)已验收。

## 已核实的接入点

| 接入点 | 当前行为与约束 |
|---|---|
| `@web-ppt/core/pdf` | 图片 PDF 已有隐藏页、动画批次、批注 / 回复、进度、取消及确定性写入；继续保留 |
| 原生 SVG | `layoutText` 与 `renderTextSvg` 已共用断行、行坐标、对齐、项目符号和 CJK 挤压；PDF 必须沿用这些排版结果 |
| 字体 | Provider 提供合规字体字节、UPEM、定位字形与独立 UTF-16 簇；不能从 GID 反推原文，也不能把字体家族名称当作可嵌入字节 |
| 产品 | Cordis 文稿字体服务拥有资源；导出作用域在读取结束前保持资源有效，关闭 / 切换须等待取消收口 |
| 基础包 | PDF 格式知识留在按需输出模块；render 不依赖 PDF / 字体 Provider，core 默认入口不引入可选整形器 |

## 验证边界与实施顺序

沿用 005 已指定的公开 SDK、实际导出文件和官网产品入口三个边界；独立读取器直接消费交付 PDF。测试不依赖写入器的私有对象分配或内部辅助函数。

1. 第一条完整路径：一页普通文字与矢量图形，经真实字体整形及嵌入导出；独立读取器核对原文、字体和绘图对象。
2. 接入原生 SVG 的布局和图形结果，覆盖变换、裁剪、填充 / 描边以及图片；复杂特效只在对应对象局部回退，并给出位置和原因。
3. 复用既有 PDF 的页选择、动画批次与批注语义，完成字体缺失、取消、多页、重复调用及资源归还。
4. 产品增加完整中英文入口与问题说明；source / dist / 真实浏览器 / 独立渲染 / 体积成本及四项门禁全部完成后才能关闭票据。

## 已实现及验证的路径

可选入口 `@web-ppt/core/pdf/vector` 的 `presentationToVectorPdf(presentation, {fonts})` 已加入源码、声明及构建配置。
`fonts` 接收 `{provider, segmentText}`，可直接传正式 Font Provider 和 `segmentFontText`；返回 `{blob, issues}`。
目前仍是开发中的入口：已有首批对象级滤镜回退和字体失败定位，复杂内容完整覆盖、字体来源的产品说明及产品接入尚未完成，不改变现有能力矩阵。

| 已验证内容 | 证据 |
|---|---|
| 原生文字布局及字体嵌入 | `out/vector-pdf/first-slice.pdf`、`text.pdf`；MuPDF 提取英文连字、中文、组合字符和多段落原文；Type0 / ToUnicode / ActualText，完整嵌入字节与输入字体 SHA-256 一致 |
| 普通图形 | `first-slice.pdf` 的填充保留路径，零图片；`geometry.pdf` 的旋转椭圆保留三次曲线、圆端点与虚线描边；第二页二次连接线转换后的控制点由独立读取器核对 |
| 独立视觉对照 | `geometry-reference.png` 来自 Chrome 原生 SVG；与 MuPDF 渲染的 PDF 对照，图形所在 360×300 像素区域 MAE 0.1771 |
| 批次与批注 | `jobs.pdf` 的三页文字依次为 A/B、B、C；隐藏的原始第 2 页跳过，进度保留原始页码；批注/回复为原生注释对象 |
| 取消与重复调用 | 逐页进度回调触发取消后返回 AbortError，无后续进度；重复导出字节一致，宿主 Provider 继续可用 |
| 隐藏内容不索取字体 | `final-only.pdf` 仅包含 B、C；已退场 A 的字体不存在也能导出终态，展开动画时仍明确拒绝缺字体 |
| PNG 与裁剪 | `images.pdf`；64 个原始 RGBA 像素与独立软蒙版逐一核对，透明区域正确叠到黄色背景；矩形源裁剪与椭圆路径裁剪叠加，旁边文字可提取 |
| JPEG 与跨页资源 | `images.pdf` 第二页直接嵌入渐进 JPEG，独立提取的压缩字节与输入一致；PNG 跨页共用对象，第三页不携带未使用图片；JPEG 边框坐标与线宽正确 |
| 图片流生命周期 | `out/vector-pdf-source-v3.log`；实际 HTTP 流读取中取消、32 MiB 以上响应头拒绝、连接关闭及同一文稿重试通过 |
| 产物消费 | `out/vector-pdf-source-v3.log`、`out/vector-pdf-dist-v3.log`；公开子路径实际打包消费通过，未通过源码 alias 绕过；类型契约直接连接真实 Provider |
| 既有图片 PDF | `out/vector-pdf-legacy-source.log`、`out/vector-pdf-legacy-dist.log` 均通过 23 项，旧整页 PNG 仍合成到白底 |
| 固件 | 十四份 `sample-vector-pdf*.pptx` 已接入 `postfixtures`；`out/vector-pdf-normalization-fixtures.log` 证明全仓 172 份固件连续重生成两次逐字节一致 |

## 图片规范化

矢量入口新增显式 `normalizeImage` 端口，可传浏览器入口的 `normalizeVectorPdfImage`。核心先按魔数检查格式、32 MiB 字节与 1600 万编码像素上限，再判断是否需要规范化；没有适配器时返回原始页码、对象 ID 或路径及稳定原因。普通 PNG 与不带方向 / 色彩元数据的 JPEG 保留直接嵌入。

浏览器适配应用图片方向、在 sRGB canvas 中读取非预乘 RGBA，宽高只允许保持或因方向交换；核心再次校验返回尺寸和像素长度，再写入 RGB / alpha 软蒙版。Bitmap 解码无法中途终止，因此取消后等待迟到 Bitmap 关闭才完成 Promise，供 Cordis 导出作用域等待资源收口。此处尚未接入产品文件服务。

| 用例 | 实测证据 |
|---|---|
| PNG 色彩问题先复现 | `out/vector-pdf-normalization-red-v2.log`、`normalization-before.json`：线性 gAMA 图片首像素浏览器为 `[137,188,137]`，旧 PDF 为 `[64,128,64]`，最大通道偏差 73；旧实现未要求规范化，公开回归先失败 |
| PNG 布局及透明度 | 2-bit 调色板 / tRNS、RGB 透明色键、16-bit RGBA Adam7；MuPDF 解出的 RGB 和软蒙版与独立 HTML 图片路径逐字节一致 |
| JPEG 八方向 | 同一含 sRGB ICC 的非对称 JPEG 插入八种 EXIF 方向；独立坐标映射核对全部像素，方向 5–8 的 16×8 编码尺寸变为 8×16 |
| 其他图片 | BMP、透明 GIF、含 sRGB ICC 的 WebP；共 15 页、1920 像素的颜色 / alpha 与浏览器参考一致，每页旁边的 ABC 仍可提取，实际 PDF 图片位置和背景合成通过 |
| 失败定位与预算 | 未提供适配器、解码失败、错误 RGBA、意外缩放、编码 / 返回像素超限、伪造 MIME 和无来源 ID 均通过公开 SDK 验证；编码超限不调用解码器 |
| 取消与所有权 | `normalization-lifetime.json`：预先取消不解码，解码等待中取消后不提前完成，迟到的真实 Bitmap 宽高均归零；失败 / 取消后 Provider 保持可用，同一文稿重复导出字节一致 |
| 源码 / 发布产物 | `out/vector-pdf-normalization-source-v2.log`、`out/vector-pdf-normalization-dist.log`：上述边界和已有全部矢量 PDF 契约通过 |
| 全仓门禁 | `out/vector-pdf-normalization-full-gates.log`：check、全部 test、八包 build 按顺序通过；首次 verify 发现 5 处旧固件 / 指纹数字。按实测 165 份 PPT/PPTX、1102 对指纹同步 README / AGENTS 后，`out/vector-pdf-normalization-full-verify.log` 的完整 verify 通过 |
| 可选入口成本 | `normalization-closure.json` 按静态依赖闭包实测：矢量入口 82,759 B / gzip 27,402 B，浏览器适配 14,701 B / gzip 5,523 B；长文稿运行内存与产品首次激活成本仍待测 |

参考 [PNG 色彩信息](https://www.w3.org/TR/png-3/)及 [HTML ImageBitmap](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html) 的方向 / 颜色转换语义。实测浏览器为 Chrome 152.0.7977.83；使用该浏览器的默认色彩管理和 sRGB canvas，不据此承诺所有 ICC / HDR、动画格式或所有浏览器解码一致。JPEG / WebP 固件采用固定的自制图像种子，重生成不依赖浏览器编码版本。

## 基础文字装饰

`sample-vector-pdf-decoration.pptx` 第一页包含单下划线、单删除线、二者叠加及普通文字控制组；四处 `ABC` 均可由 MuPDF 提取，四条装饰线保留原生路径，零图片。第二页为带组合音标的 `q̇` 下伸部和普通字形控制组。

| 检查 | 实测结果 |
|---|---|
| 装饰线位置与粗细 | `decoration.json` 单独核对像素覆盖；PDF / Chrome 线中心偏差小于 0.5 输出像素，有效厚度偏差小于 0.3 输出像素 |
| 下划线颜色 | 两条下划线为蓝色，文字和删除线仍为黑色；原生 SVG 的声明节点增加 fill，内部恢复文字填充，修复 Chrome 忽略 text-decoration-color 的实际问题 |
| 下伸部交叠 | `decoration-descenders.json`：由同页普通字形确定 20 个实心交叠像素，蓝色下划线不覆盖黑色下伸部；两个组合字符文本均可提取，零图片 |
| 字体抗锯齿差异 | 同页普通文字控制区域 MAE 4.8668；四处文字区域完整记录，未把字形抗锯齿差异计为装饰线一致，也未提高全区域阈值掩盖差异 |
| 现有文字路径 | `out/vector-pdf-decoration-core.log` 的 2234 项核心断言及既有快照通过；`out/vector-pdf-decoration-portability.log` 与 `-portability-dist.log` 的高级文本流转及独立进程渲染一致性通过 |

默认线粗和线位采用当前原生 SVG 的 CSS auto 行为；OpenType `post` / `OS/2` 的建议度量属于 from-font，不能直接替代 auto。
依据 [CSS Text Decoration](https://www.w3.org/TR/css-text-decor-4/) 以及 [Chromium 装饰线绘制](https://chromium.googlesource.com/chromium/src/third_party/%2B/refs/heads/main/blink/renderer/core/paint/text_decoration_info.cc)和[线位计算](https://raw.githubusercontent.com/chromium/chromium/main/third_party/blink/renderer/core/layout/text_decoration_offset.cc)。
依据 [SVG 绘制顺序](https://www.w3.org/Graphics/SVG/1.1/text.html#TextDecorationProperties)，每个 text 统一先画下划线、再画字形、最后画删除线；独立像素检查曾捕获反序绘制把黑色下伸部盖成蓝色的问题。
目前仅验证该字体的单实线；其他字体度量、显式避让、双线 / 点划 / 波浪 / 粗线和按词下划线仍待继续覆盖。

最新证据：`out/vector-pdf-decoration-descenders-source.log` 与 `-dist.log` 均通过公开导出、独立读取和实际 Chrome 对照；`-check.log` 类型检查及 `-build.log` PDF 入口构建通过。核心包完整构建及现有原生文字回归记录见上表。

## 字体失败定位

公开 `VectorPdfError.issue` 保留稳定原因，附带实际尝试的 `fontFamilies` 和最多 80 个 UTF-16 单元的文字片段；截断不会留下半个代理对。
测量阶段逐对象复用公开原生排版器补齐字体缓存，整页布局复用该缓存；绘制及局部回退中的字体嵌入失败在最近的对象边界定位。新增预测量的长文稿成本仍待实测。

| 检查 | 证据 |
|---|---|
| 缺字体 / 缺字 | `font-errors.json`：真实注册表缺字体返回 `face-unavailable`，真实 HarfBuzz 对 `Ā` 返回 `missing-glyphs`；后续缺失的备用家族不覆盖实际整形失败 |
| 原始位置 | 固件第 1 页隐藏，错误仍指向第 2 页的组内子对象；无 ID 的公开 Schema 副本返回 `[1,0]` 原始索引路径，原文稿不写入临时 ID |
| 分段与片段边界 | 不支持的希腊文字返回 `unsupported-script`；诊断长度边界上的非 BMP 字符不会被截成单独代理字符 |
| 嵌入阶段 | 宿主公开端口拒绝嵌入时返回子对象位置、实际字体及 `embedding-restricted`；解析和整形继续使用真实 Provider |
| 取消 / 重试 | 嵌入返回前取消仍为 `AbortError`，无进度通知；失败和取消之后同一 Provider 可继续导出，已注册的两份字体均仍保留 |

来源为 `tooling/lib/vector-pdf-font-errors-contract.mjs` 的公开入口契约；`out/vector-pdf-font-errors-source.log` 和 `-dist.log` 均通过，类型检查及核心包完整构建亦通过；既有图片 PDF 的 dist 23 项回归通过。这组用例不覆盖所有资源限制、Provider 异常及产品中的本地化提示。

## 首批 SVG 覆盖检查与基础图元

初始盘点 `out/vector-pdf/svg-dialect.json` 覆盖 156 份无需密码的固件、506 页原生 SVG；另外四份加密固件在解析时明确要求密码。盘点用于发现已有渲染器实际发出的节点、属性和 CSS 声明，不能代替 PDF 保真验证。

对象遍历前新增节点 / 属性 / CSS 检查及引用定义检查。未覆盖的视觉声明触发带位置的局部回退；无栅格器时返回 `VectorPdfError`。页面背景没有对象边界时明确拒绝，不把整页转成图片；原生渲染失败的占位内容也不能借回退冒充导出成功。

| 公开用例 | 当前结果 |
|---|---|
| 小型大写 `abc` | 返回 `svg-attribute-font-variant`，局部 PNG 保留原生 SVG 外观；相邻 `ABC` 可提取，目标区域 MAE 0.9040 |
| 弧形艺术字 | 返回 `svg-node-textPath`；仅该对象栅格化，原生 SVG / MuPDF 对照 MAE 0.6885 |
| 线端三角箭头 | 已改为原生路径、零图片、零回退说明；目标区域 MAE 0.1567。后续五页箭头专项见下节 |
| 普通表格 | 四条边线为原生 PDF 描边、零图片；两处正文 `ABC` 可提取，线坐标与颜色由独立读取器核对 |
| 媒体播放标识 | 圆形由原生曲线路径表达，透明填充与描边保留，零图片；MAE 0.2561 |
| 零线宽与全零虚线 | 零宽表格边线不生成 PDF hairline；公开 Schema 的 `[0,0]` 虚线按 SVG 实线语义输出，独立像素检查整条连续边线与零宽边线所在白色区域 |
| 无效路径 | 不再跳过路径中不认识的字符继续绘图；公开 Schema 含非法字符时按对象返回 `svg-geometry` |
| CSS 字体声明 | 原生公式的内联 font-family / font-size 等参与字体解析；缺少公式字体时返回实际公式字体链和对象位置，不会误用已注册的正文字体假装成功 |

六页 `sample-vector-pdf-coverage.pptx`、`tooling/lib/vector-pdf-coverage-contract.mjs` 和 `tooling/inspect-vector-pdf-coverage.py` 覆盖上述公开边界。
最终本轮 `out/vector-pdf-coverage-source.log`、`-dist.log` 均通过完整矢量 PDF 契约；`-check.log`、`-types.log`、`-build.log` 分别证明 ES2020 类型检查、声明生成及 PDF 入口构建通过。`-fixtures.log` 记录 168 份固件连续生成两次一致。
这里是首批覆盖检查；允许项的完整值域、引用定义组合与全部方言仍需继续审计。重型 / 多样式文字装饰、文字渐变 / 描边、更多图片规范化等尚未达到最终范围。

## 原生箭头与扩展路径语法

五页 `sample-vector-pdf-markers.pptx` 经公开入口直接导出，未提供栅格器；每页 `ABC` 可提取，零图片、零回退说明。

| 用例 | 蓝色图形实占区域 MAE |
|---|---:|
| 三角、燕尾、菱形、椭圆、开放箭头；前后端、大小比例、透明度及虚线 | 2.6668 |
| 二次 / 三次曲线切线、端点与控制点重合 | 4.3524 |
| 旋转组及不同比例缩放 | 5.7654 |
| 显式零长端段、多子路径、闭合路径 | 2.8954 |
| 相对与隐式指令、S / T 反射控制点、紧邻圆弧标志及闭合 | 7.4560 |

路径支持 M/L/H/V/C/S/Q/T/A/Z 的大小写形式及隐式参数组。箭头按端点切线放置，并处理 marker 的 viewBox、参考点、单位及独立描边状态；闭合路径按进出方向平分角处理。依据 [SVG marker 规则](https://www.w3.org/TR/SVG11/painting.html#Markers)及[路径语法](https://www.w3.org/TR/SVG/paths.html#PathData)。

显式零长端段存在浏览器边界：当前 Chrome 对初始 / 最终零长线段保持本地 +x 方向，与 [SVG 路径方向规范](https://www.w3.org/TR/svg-paths/)的跨段查找规则不同。这里固定实际原生 SVG 外观，不作为通用 SVG 规范完整实现的证明；最初未处理零段及闭合平分角时，第四页 MAE 26.2655，修复后为 2.8954。

证据：`out/vector-pdf/markers.pdf`、`markers.json`、`out/vector-pdf-markers-source.log`；最终源码与发布包由下节统一复验。

## 原生图案及资源作用域

四页 `sample-vector-pdf-patterns.pptx` 覆盖当前原生 SVG 输出的 28 种图案路径、旋转、非等比组缩放、椭圆边界、前景透明度及独立虚线描边。前三页普通文字及末页中文均可提取，整个 PDF 零图片。

| 检查 | 结果 |
|---|---|
| PDF 结构 | 32 个有色 tiling pattern；以 Form 保留对象局部坐标，不随填充面积展开重复单元 |
| 独立矢量读取 | MuPDF 从交付 PDF 提取图案与路径，再由 Chrome 绘制；三页实占区域 MAE 分别为 0.0688、0.5359、0.1080，门限为 1 |
| 阅读器屏幕栅格化 | MuPDF 144 dpi 与 Chrome SVG 的 MAE 分别为 9.1843、7.2102、12.3593；第一、三页未达到最初的 8 门限，保留失败状态，不能以矢量读取通过宣称屏幕逐像素一致 |
| 未旋转控制组 | 第一页方格直接栅格对照 MAE 0.3333，门限为 1 |
| 资源引用 | 页和图案单元独立收集实际使用的字体、图片、图案及绘图状态；纯图案单元不带之前的字体 / Form，末页只引用中文字体且没有前页图案 |

图案使用 [PDF 32000-1 §8.7](https://opensource.adobe.com/dc-acrobat-sdk-docs/standards/pdfstandards/pdf/PDF32000_2008.pdf) 的有色平铺与 Form 默认坐标空间，单元按 [SVG pattern](https://www.w3.org/TR/SVG11/pservers.html#PatternElement) 的当前用户坐标绘制。初版完整页面资源复制到每个单元会造成平方增长，因此改为逐内容流收集；跨页图片和字体仍可复用已写入的同一资源。

MuPDF 显示差异与其[小图块栅格缓存与拼接](https://raw.githubusercontent.com/ArtifexSoftware/mupdf/1.26.7/source/fitz/draw-device.c)一致：切换三种 TilingType 的实测结果相同，独立提取的矢量内容与参考图案一致。原始栅格差异及初始门限状态记录在 `patterns.json`；其他 PDF 阅读器的显示对照尚待完成。

`out/vector-pdf-patterns-red.log` 记录最初不支持图案；`-source.log` 保留初版栅格门限失败。最终 `-source-v2.log` 与 `-dist.log` 通过公开 SDK、独立矢量读取和既有 PDF 契约；`-check-v2.log` 类型检查及 `-build.log` 核心包完整构建通过。该轮验证 userspace 几何图案，图片填充由下节承接；其余单位和定义组合仍需继续。

## 图片填充、平铺与背景

五页 `sample-vector-pdf-image-patterns.pptx` 覆盖形状图片填充、源裁剪、椭圆边界、四种交替翻转、平铺偏移、旋转 / 非等比组缩放、图片透明度及图片背景。每页文字均可提取；最后一页纯文字不携带之前的图片或图案。

| 用例 | 独立读取 SVG / Chrome MAE | MuPDF 144 dpi / Chrome MAE |
|---|---:|---:|
| 形状填充与椭圆裁剪 | 0.6562 | 0.7891 |
| 无翻转、水平 / 垂直 / 双轴翻转及首格偏移 | 0.2611 | 1.2193 |
| 组变换、裁剪后翻转及图片透明度 | 0.9297 | 2.3533 |
| 页面图片背景 | 0.4474 | 0.7878 |

对照取三个结果的图形实占区域并集，均匀背景不参与平均。独立读取的 SVG 与原生 SVG 统一由 Chrome 绘制，门限为 1；MuPDF 直接栅格化的插值和单元拼接差异另行保留。
MuPDF 独立检查全部 12,288 个原始 RGBA 像素；整个 PDF 只包含同一张 128×96 RGB 图片及其灰度软蒙版，跨页、重复单元和翻转均复用。另按固定坐标精确核对 21 处颜色，覆盖透明叠加、平铺方向、首格偏移和背景重复。

嵌套视口按 [SVG 1.1 §7.9](https://www.w3.org/TR/SVG11/coords.html#EstablishingANewViewport) 平移原点并设置单元裁剪；原图因 srcRect 放大后也不能越过自己的翻转格。当前覆盖原生渲染器发出的显式宽高、`overflow="hidden"` 且无 viewBox 的嵌套 SVG；其余视口模式继续显式拒绝或对象级回退。

`out/vector-pdf-image-patterns-red.log` 记录原始 `svg-node-svg` 拒绝；`-source-final.log` 与 `-dist.log` 通过完整源码 / 发布包契约，`-check-final.log` 类型检查、`-build.log` 核心包完整构建通过。`-fixtures.log` 记录 171 份固件连续生成两次逐字节一致，受版本控制的旧固件未改变。

## 原生透明度与渐变

`paints.pdf` 来自四页 `sample-vector-pdf-paints.pptx`；通过公开导出入口生成，MuPDF 检查 PDF 对象与像素，Chrome 原生 SVG 提供图形区域参考。

| 已验证内容 | 证据 |
|---|---|
| 独立填充 / 描边透明度 | 第一页 RGBA 分别写入非描边 / 描边 alpha；原生路径零图片，透明交叠处与后续不透明红色块像素核对通过；MAE 0.1756 |
| 线性及径向渐变 | 第二页为 PDF Type 2 / 3 Shading，多色标由分段函数表达；渐变按曲线实际极值边界归一化，旋转椭圆及边框仍为矢量；MAE 0.2737 |
| 渐变透明度及硬切换 | 第三页使用灰度渐变构成 Luminosity 软蒙版，零栅格图片；中间位置重合色标产生红 / 蓝硬切换；MAE 0.2547 |
| 图片对象透明度 | 第四页保留 8×8 原始图片和源 alpha，另叠加 50% 对象透明度；独立检查像素 / 软蒙版，后续不透明对象不受影响 |

证据：`out/vector-pdf-paints-source.log`、`out/vector-pdf-paints-dist.log`、`tooling/inspect-vector-pdf-paints.py`。
填充与描边必须依次合成：使用单个 PDF `B` 指令时，透明描边与填充交叠区域的颜色不同于 SVG；测试已固定交叠处像素，改用依次填充和描边。
函数与 Shading 结构参考 [PDF Association 的颜色与函数速查表](https://pdfa.org/download-area/cheat-sheets/Color.pdf)，色标顺序和同位置切换遵循 [SVG 渐变规则](https://www.w3.org/TR/SVG11/pservers.html)。
这里验证的是当前原生 SVG 方言的首批渐变；端点重合色标、更多色彩空间 / 渐变变换和文字渐变仍需继续覆盖。

## 对象级滤镜回退

新增可注入的 `rasterize` 端口，以及可选浏览器入口 `@web-ppt/core/pdf/vector/browser` 的 `rasterizeVectorPdfObject`。
矢量入口不导入浏览器适配；宿主可直接传入该函数，也可把独立 SVG 对象转交另一渲染环境。返回的透明 PNG 使用幻灯片像素坐标和紧边界。

| 已验证内容 | 证据 |
|---|---|
| 阴影对象与相邻文字 | `effects.pdf` 第一页只有一张局部图片，图片边界包含形状外阴影；相邻 `ABC` 保留字体资源且可提取；Chrome 原生 SVG / MuPDF PDF 对照区域 MAE 0.4331 |
| 组变换与实际字体 | 第二页的回退对象位于旋转、缩放组内，使用祖先变换后的页面坐标；SVG 内联该对象实际使用的 Provider 字体，MAE 0.6400 |
| 图片资源及裁剪 | 第三页把文稿 PNG 字节内联到独立 SVG；保留椭圆裁剪、透明色块和阴影，MAE 0.6592；相邻文字继续可提取 |
| CSS 图片滤镜 | 第四页的灰度样式触发对象级回退，返回 `svg-css-filter`；不再静默忽略 `style="filter:..."`，透明灰度色块及相邻可搜索文字均核对通过，MAE 0.2810 |
| 对象定位 | 问题返回原始 `slideNumber`、`elementId` 和原因 `svg-filter`；无来源 ID 的公开 Schema 对象返回原始零基 `elementPath`，临时标记不写回文稿 |
| 无栅格器 | 返回带 `issue` 的 `VectorPdfError`，可定位到需要回退的具体对象 |
| 取消与重试 | 实际浏览器在 SVG 解码期间取消后可重试；导出在回退结束前取消后不发进度；实际 HTTP 流读取取消及超限连接关闭；同一文稿重复导出字节一致 |

证据：`out/vector-pdf-paints-source.log`、`out/vector-pdf-paints-dist.log`，独立检查脚本 `tooling/inspect-vector-pdf-effects.py`。
文字参考图在已加载实际字体的 Chrome 中通过公开原生 SVG 接口排版；Node 的默认估算字宽曾把 `AV office` 错折成两行，不能作为该用例的字体布局基准。

浏览器适配目前以 2 倍像素、最多 1600 万像素的透明页面画布渲染单个对象，再按非零 alpha 裁出交付图片；没有把整页内容栅格化。
`finally` 清空图片源并归零两张画布，资源读取复用 32 MiB 上限和 AbortSignal。长文稿瞬时内存与缩小临时画布的成本优化仍待实测。

验证命令：`npm run test:pdf:vector`、`npm run test:pdf:vector:dist`（fnm Node 24.3.0）。
独立检查使用 PyMuPDF 1.26.7；默认 Python 路径为 `out/font-glyphs/python`，允许显式 `PYTHONPATH` 覆盖。
环境安装沿用 `python3 -m pip install --target out/font-glyphs/python -r tooling/font-glyph-requirements.txt`。本次复用了已验证、版本相同的本地依赖，测试代码不再依赖原型目录。

对照器本身有边界：MuPDF 的 SVG 输入未保留虚线，且 `get_drawings` 在旋转 CTM 下返回的线宽/虚线/连接数值带缩放；因此外观以 Chrome SVG 与 MuPDF PDF 的像素对照判断。圆弧转换按 [W3C SVG B.2](https://www.w3.org/TR/SVG/implnote.html#ArcImplementationNotes) 处理，复用现有几何层的三次曲线物化。

低分辨率透明图片的放大显示仍有阅读器差异：[PDF 1.7 §4.8.3](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/pdfreference1.7old.pdf)不规定统一插值算法。8×8 图片的源像素在对照中放大至 60×40 输出像素；写入原始 RGB 和 alpha 并启用 `Interpolate` 后，MuPDF 与 Chrome 的 330×330 区域 MAE 为 4.7467，插值带外为 0.3721，见 `images.json`。原始像素、裁剪及非插值区域分别严格核对；未把带内差异作为完全一致通过，也未通过重采样改变原始图片来隐藏差异。临时 `Matte` 对照没有消除此差异，未进入实现。

## 尚未完成

| 工作 | 当前边界 |
|---|---|
| 图形覆盖 | 已覆盖 M/L/H/V/C/S/Q/T/A/Z 大小写及隐式参数组、表格边线、媒体圆形、原生箭头、几何 / 图片图案、显式裁剪视口、首批透明度和线性 / 径向渐变；其余视口模式、更多渐变边界、其余 SVG 方言和高级文字样式仍待实现 |
| 图片范围 | 直接嵌入及首批色彩 / 布局 / 方向规范化已有证据；更广 ICC / HDR、动画图片时刻、SVG 等其他格式、局部效果中各格式的组合及长文稿解码成本仍待验证，不可把当前路径视为全部图片支持 |
| 失败和局部回退 | 首批滤镜、小型大写和弧形艺术字可局部回退并返回定位，缺字体 / 缺字和嵌入拒绝可定位；已接入节点 / 属性 / CSS 检查，允许项值域及引用定义的完整审计、其余效果和产品字体来源说明仍待完成。已作为实验性入口进入产品支持矩阵 |
| 字体与资源验证 | 继续扩大文字位置、CJK 挤压、组合簇映射、其他字体诊断、资源限制、释放及长文稿成本验证 |
| 结构整理 | 矢量与图片写入器目前有对象写入、批注、页任务重复；代码审查阶段收敛共享职责，区分共享的字节/图像处理与各自的页面内容 |
| 产品与门禁 | 本轮 check → test → build → verify 已通过；Cordis 文稿 / 文件服务和字体消费已接入，矢量 source/dist 已进入常规门禁；完整中英文错误 / 回退交互、运行成本及整项完成后复验仍待完成 |

005 保持进行中；上述切片通过不能替代票据的完整验收。


## beta.5 产品接入

| 行为 | 当前证据 |
|---|---|
| 缺字体、加载本机字体后重试 | `out/vector-pdf-cordis-product-source-v4.log`：真实字体 Worker 与中英文提示，PDF 独立提取原文和字体字节 |
| 当前字体选择与作用域 | `out/vector-pdf-cordis-font-lifetime-v3.log`：选用本机替换、消费者结束前阻止替换和释放、过期 reader 不可复用 |
| 取消 / 切换文稿 / 应用退出 | `out/vector-pdf-cordis-export-lifetime.log`：实际图片解码暂停，待 Bitmap 关闭后完成交付或取消；重试只下载一次，字体 / Worker 归零，独立 PDF 读取通过 |

Cordis 的 disposer 同时为 thenable。用 async generator 收编时会先被 Promise 解包，原 disposer 留在父作用域并行释放；文稿作用域改为同步收编，逐层等待工具、视图、字体和会话。资源测试已先复现会话过早销毁，再验证修复。

这些证据覆盖本轮接入；005 保持进行中，剩余项目见上表和[本轮交付说明](../../releases/0.5.0-beta.5.md)。
