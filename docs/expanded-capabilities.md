# 扩展编辑、渲染与导出

可选能力通过独立入口提供，官网编辑器按实际内容和用户操作加载。核心仍只依赖 fflate，解析可在 Worker 中运行。

| 能力 | 公开入口 | 官网操作 | 支持范围与边界 |
|---|---|---|---|
| 经典图表多级类别 | `@web-ppt/edit-core/chart` | 数据面板逐级编辑、空槽开关、类别与系列增删 | 两级/三级、横向矩阵、稳定身份及工作簿同步；[支持矩阵与只读边界](chart-hierarchical-categories.md) |
| 共享工作簿与图表 | `@web-ppt/edit-core/chart-shared` | 数据面板编辑，关联页面同步；复制、撤销与恢复 | 共享缓存、重叠/独立区域、多表及类别/XY 共同记录已验收；[支持范围与证据](wayfinder/ppt-portability-fidelity/shared-chart-progress.md)。旧身份无法证明时显示未恢复并拒绝保存；混合图自动轴域、标签布局与气泡半径仍有[外观差异](wayfinder/ppt-portability-fidelity/mixed-chart-rendering.md) |
| 经典图表类型与样式 | `@web-ppt/edit-core/chart-design` | 图表数据面板中的类型、排列、图例、标题、标签、配色 | 八类图表的兼容转换；遵循工作簿只读规则，类别型与 XY 数据不互转，组合图保留原生结构 |
| 现代图表数据 | `@web-ppt/edit-core/chart-ex` | 现代图表数据面板 | 七类 ChartEx 的分层数据与增删行；保持空值、零、小计身份及工作簿其他内容 |
| 批注编辑 | `@web-ppt/edit-core/comments` | 批注面板：新增、修改、删除、回复 | 字段级历史、恢复和协同；删除父批注时将回复提升为独立批注 |
| 页面适配 | `@web-ppt/edit-core/resize` | 页面尺寸 → 确保适合 | 全稿等比居中；同步文字、表格、效果、母版/版式与批注锚点；组合仅缩放根框；支持仅改画布 |
| SmartArt 内部编辑 | `@web-ppt/edit-core/smartart` | SmartArt 数据面板 | 文字、增删节点及后代、父子关系和同级排序；按当前布局族重排，保存原生数据与 drawing 缓存 |
| OLE 内部编辑 | `@web-ppt/edit-core/ole` | 嵌入对象数据面板 | 直接 OOXML、CFB Package/Ole10Native 中的 XLSX 单元格及 DOCX 普通段落；保留未改部件，公式交宿主重算 |
| 墨迹内部编辑 | `@web-ppt/edit-core/ink` | 墨迹面板与画布手绘 | 笔刷、移动、采样点、增删；保留压力通道、原生 InkML 与兼容预览 |
| 地图 | `@web-ppt/core/chart-ex` | 自动显示具有 geoCache 的 regionMap | 使用文件自带边界，支持压缩缓存、四种投影、孔洞及跨日期变更线；无缓存时保留兼容图，不请求地图服务 |
| EMF+ | `@web-ppt/core/emf-plus` | 按内容自动加载 | 路径、透明色、渐变、基本形状/样条、图片、文字、裁剪、继续对象与 GetDC；未知绘图令 Dual 整体回退，Only 返回 unsupported |
| 三维 | `@web-ppt/core/three-d` | 三维外观面板与自动渲染 | XYZ 相机矩阵、正交/透视、挤出、背面和曲线斜角；透视正面仍含原生 SVG 文字；材质/光照及网格为近似 |
| 数学公式 | 核心渲染入口；`@web-ppt/edit-core/generate` 原生写入 | 自动渲染、复制与保存 | OMML 分式、根式、脚标、大算子与矩阵布局；支持范围内保留公式原子，复杂数学字体保真度仍依赖可用字体 |
| 字体与字形 | `@web-ppt/fonts/glyphs` 及可选 HarfBuzz / Worker / browser 子入口 | 字体与缺字 → 检查 / 本机替换 | 静态 TTF/glyf、合规 EOT、Latin/Han 横排 LTR；保留 UTF-16 簇、定位与许可限制。Cordis 随文稿释放资源；本机字体用于预览及图片 / SVG / 实验性矢量 PDF 导出，不写 PPTX。复杂脚本、变量字体、CFF、WOFF 解压及非 400/700 浏览器样式绑定暂不支持；见[完整范围](font-glyphs.md) |
| PDF | `@web-ppt/core/pdf` | 导出文档 → PDF | 直接下载图片页面 PDF；默认 2×、隐藏页、动画批次、原生批注/回复、进度和取消 |
| 矢量 PDF（实验性） | `@web-ppt/core/pdf/vector` 与独立 `/browser` 适配 | 导出文档 → PDF（可搜索文字） | 需要实际且允许嵌入的字体字节；首版 Latin/Han 横排 LTR、基础图形、渐变 / 图案 / 图片和对象级特殊效果回退；缺失资源明确失败。005 整项仍在验收，见[实现范围与已知差异](wayfinder/ppt-portability-fidelity/vector-pdf-implementation.md) |
| 视频 | `@web-ppt/viewer-core/video` | 导出文档 → WebM | WebCodecs VP9/VP8、动画/切换、帧率/码率/停留时间；无音轨，嵌入媒体需明确选择静态封面 |
| 无来源复制 | `@web-ppt/edit-core/generate` | 直接复制，再粘贴到另一文稿 | `copyPortableElements` 直接物化选中子树和资源；支持[公式、艺术字与高级文字效果](portable-rich-text.md)，保留祖先变换，复用生成保存的能力校验 |
| 原生 PPT | `@web-ppt/edit-core/ppt` | 导出文档 → PPT | 生成真正的 CFB/Escher 二进制文件，能力矩阵见下文 |

所有编辑扩展共用 `Editor` 的事务、撤销/重做、恢复及协同补丁。对象扩展更改的原生内容随 PPTX 补丁保存或生成保存一起写出；源资源释放后仍可保存。未知 OLE 宿主格式、布局能力外的 SmartArt 等对象不宣称具备完整内部编辑。

## API 使用

```ts
import { parse } from '@web-ppt/core';
import { prepareAdvancedRendering } from '@web-ppt/core/advanced-rendering';
import { createDoc, Editor } from '@web-ppt/edit-core';
import { createSlideSizeEditor } from '@web-ppt/edit-core/resize';
import { createCommentEditor } from '@web-ppt/edit-core/comments';

await prepareAdvancedRendering(bytes);
const presentation = await parse(bytes, { edit: true, keepPackage: true });
const editor = new Editor(createDoc(presentation));
createSlideSizeEditor(editor).setSize({ w: 1280, h: 720, fit: 'ensureFit' });
const comments = createCommentEditor(editor);
const slideId = editor.doc.slideOrder[0];
const commentId = comments.add(slideId, { author: '审阅者', text: '请核对数据', x: 100, y: 80 });
comments.reply(slideId, commentId, { author: '作者', text: '已核对', x: 100, y: 80 });
const pptx = await editor.save();
```

```ts
import { presentationToPdf } from '@web-ppt/core/pdf';
import { presentationToVideo } from '@web-ppt/viewer-core/video';
import { savePpt, PptSaveError } from '@web-ppt/edit-core/ppt';

const pdf = await presentationToPdf(presentation, { scale: 2, showComments: true });
const webm = await presentationToVideo(presentation, { fps: 24, slideDurationMs: 3000 });
try {
  const ppt = savePpt(editor.doc); // Uint8Array，application/vnd.ms-powerpoint
} catch (error) {
  if (error instanceof PptSaveError) console.log(error.issues); // 页码及原因；不生成半成品
  else throw error;
}
```

图片 PDF 与 WebM 在浏览器中执行；图片 PDF 的文字不可选中。实验性矢量 PDF 的普通文字可搜索，效果回退区域为图片；浏览器图片规范化与局部回退由独立适配入口提供。`savePpt` 可在无 DOM 环境执行。导出不会修改编辑历史或伪造保存点。

## 原生 PPT 保存矩阵

该入口根据当前编辑投影生成一个新 `.ppt`，写入 `PowerPoint Document`、`Current User`、持久化目录、Escher 绘图和 Pictures 流。它保留支持对象的可编辑结构；原文件中未进入统一 Schema 的未知二进制记录不做逐字节保留。母版/主题的有效外观落到导出对象上。

| 内容 | 处理 |
|---|---|
| 页尺寸、顺序、隐藏页 | 保留；1–1000 页，边长 96–5376 px，顶层坐标受 PPT 的 16 位范围约束 |
| 横排文字 | UTF-16 中英文、字体、字号、粗斜体、单下划线、上下标、基础段落对齐/间距/单字符项目符号；PPT 字号量化到整点 |
| 形状 | 原生自定义路径与贝塞尔、纯色/透明填充、实线描边、位置、旋转、翻转 |
| 组合 | 原生嵌套及子坐标系，最多八层 |
| PNG/JPEG | 保留原始图像字节，源文稿释放后仍可写入 |
| 演讲者备注 | 原生 Notes 容器与占位符；保留段落与实际制表符 |
| 自动适应/竖排/多栏/艺术字/复杂字符格式/文字链接 | 明确拒绝 |
| 裁剪/图片效果、渐变/图案填充、自定义虚线、复杂箭头 | 明确拒绝 |
| 表格、图表、SmartArt/OLE/墨迹、音视频、公式、三维或其他原生对象 | 明确拒绝，使用 PPTX 保存 |
| 批注、节、动画、页面切换 | 明确拒绝，使用 PPTX 保存 |

协议依据：[MS-PPT DocumentContainer](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-ppt/6254c4d1-5217-4e16-b20d-c04ddcce31c9)。独立 LibreOffice 重开已验证文字、贝塞尔形状、组合、图片与备注；Windows PowerPoint 真机按用户要求跳过。

## 验证入口

| 命令 | 验证内容 |
|---|---|
| `npm run test:expanded` | 15 套源码契约：编辑/历史/恢复、两条保存、格式边界、确定性输出 |
| `npm run test:expanded:dist` | 独立导入发布入口，验证跨包共享资源、扩展与渲染 hook；纳入 `verify` |
| `node tooling/test-site-editor-browser.mjs` | 实际官网操作、下载和重开；包含透明三维网格的多倍率像素回归 |
| `npm run test:fixtures:determinism` | 连续两次生成全部固件并逐字节比对 |

三维修正了相机轴映射和“材质改变挤出深度”的旧行为，因此仅更新 showcase 第七页的两条渲染快照。纯色表面直接投影为轮廓，避免设计工具中的大面积网格接缝；文字/纹理的透视三角形使用无重叠硬边遮罩。纹理与文字的三角近似在不同 SVG 阅读器中可能仍有细小接缝。
