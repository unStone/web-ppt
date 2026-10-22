# Agent 布局检查

`@web-ppt/edit-core/lint` 的异步 `lintPresentation(doc, options)` 检查当前 EditDoc 的调用时投影。输出协议版本为 1，问题包含稳定 reason、页号、与 describe 相同的元素 ID、页面外框、表格单元格和触发条件的实测值；不修改文档。

```ts
import { lintPresentation, prepareLintText } from '@web-ppt/edit-core/lint';
import { withFontMeasurement } from '@web-ppt/fonts/glyphs';

const prepared = await withFontMeasurement(provider,
  measure => prepareLintText(doc, measure), fontOptions);
if (!prepared.ok) throw new Error(prepared.reason);
const report = await lintPresentation(doc, {
  measureText: prepared.value.measureText,
  fonts: { available: registeredFamilies, embedded: embeddedFamilies },
  signal,
});
```

| reason | 判定与 measurements |
|---|---|
| `text-overflow` | 既有 layoutText 的有效字号、行盒与列宽；`contentBottom / availableBottom / widthOverflow / tolerancePx / fontScale`。生效的形状随文字增高不报高度溢出 |
| `element-overlap` | 不同普通组合的内容外框相交面积占较小外框比例；`relatedElementId / ratio / threshold`。无文字的装饰形状、普通组容器和覆盖页面的背景图片不互报 |
| `off-canvas` | 当前旋转/翻转/组合后的外框越界；`outsidePx / tolerancePx` |
| `low-contrast` | sRGB 亮度及前景透明度合成；`ratio / threshold / fontSize / sampleCount`。按实际缩放字号采用 AA 普通/大字阈值，不提前四舍五入 |
| `missing-font` | collectFonts 的声明字体需求超集与宿主库存比较；`families / missingCount / threshold`。不等同于逐字形覆盖检查，未用到的脚本槽可能需宿主复核 |
| `placeholder-prompt-left` | 当前占位符文字与匹配版式/母版的原始提示文字一致；`text / matchedCount / threshold`。页码、日期、页眉和页脚不当作提示 |
| `image-distorted` | 未旋转的渲染帧与裁剪后原图比例；`deviation / threshold / sourceWidth / sourceHeight`。旋转不算拉伸，裁剪后仍拉伸会报告；媒体封面与框架对象预览不作为普通图片 |

默认容差为 0.01px，重叠比例阈值 0.25，图片对称比例偏差阈值 0.05。它们来自固件原始分布及已知构造的复核，可由 `tolerancePx / overlapRatio / imageDeviation` 覆盖；报告保留实际使用值。结果是可定位的观察，重叠或拉伸也可能是作者有意设计，宿主据此决定是否编辑。

| 输入与边界 | 行为 |
|---|---|
| `checks` | 显式选择非空检查列表，默认七项；输出声明本次检查项 |
| `measureText` | 文字检查必须有真实测量；Node 不使用估算回退。可用现有 Font Provider 的 prepareLintText 重放准备；浏览器可用真实 Canvas |
| `fonts` | available/embedded 为非空名字组成的数组；embedded 可从解析结果的 embeddedFontSources/embeddedFonts 读取。库存由宿主负责，字重/字形支持仍遵循字体服务矩阵 |
| `canvasColor` | 未指定时按 W3C 假定白色；可指定实际不透明画布颜色 |
| `resolveContrast` | 复杂填充、文字描边/渐变/阴影或三维需要实际颜色配对；可返回配对数组，或在确实不显示时返回 `{ visible:false }`。缺少必需采样即整体拒绝，不假装背景为白色 |
| `resolveImageMetadata` | 可提供外链、EXIF 等已处理后的实际原图尺寸；默认只读会话资源和 Data URI 的编码像素尺寸，不自动访问网络 |
| `resolvePlaceholderPrompts` | 可在原始模板来源不可用时补充提示字符串 |
| `maxIssues` | 默认一万；超过上限抛 resource-limit，不截断后冒充完整报告 |
| `signal / onProgress` | 取消返回稳定 aborted；进度按完成页数表达；宿主编辑世代变化时取消旧任务，避免显示过期观察 |

复杂颜色可按需使用随包适配器，由宿主提供 RGBA8 光栅化器：

```ts
import { createSvgContrastSampler } from '@web-ppt/edit-core/lint/sampler';
const resolveContrast = createSvgContrastSampler({ rasterize, embeddedFonts });
const report = await lintPresentation(doc, { measureText, fonts, resolveContrast });
```

适配器使用当前 SVG 渲染、无字底图和文本标记图提取实际颜色；字体必须内联或可供光栅化器使用。完全遮挡的文字返回不可见，半透明遮挡额外采样字形覆盖，像素不足则明确拒绝并提示提高采样比例。

它不打包光栅化器，Node/Worker 和浏览器采用同一协议。背景指文字下方的填充，彼此重叠的文字由 overlap 单独报告；描边、阴影与渲染保真边界需结合源对象关系复核。结果不执行自动修复。

所有失败都带 reason，能定位时带 slideNumber/elementId；依赖缺失、回调失败、采样尺寸错误或取消均拒绝整次调用，不交付半份报告。输入是调用时的只读快照，外部资源应保持到调用结束。

输出 Schema 由 TypeScript 生成，经 `@web-ppt/edit-core/lint/schema.json` 发布；`npm run test:lint` / `test:lint:dist` 验证源码和产物。[对比度定义与公式](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)以 W3C 当前原文为依据。
