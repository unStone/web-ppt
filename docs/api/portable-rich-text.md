# 高级文本生成保存与复制

`@web-ppt/edit-core/generate` 使用同一物化器处理无来源保存与跨文稿复制。公式保留 OMML 原子，
文字外观写入 DrawingML；正常文本编辑、历史、恢复与协同仍沿用已有命令。主入口不加载公式写入器。

| 内容 | 生成与复制范围 | 明确拒绝 |
|---|---|---|
| 公式 | 嵌套分式、根式、上下标、大算符、括号、矩阵、重音、上下限、多行公式组；形状与表格单元格 | 展示模型已丢失的原生内容，如非空隐藏参数、幻影、边框盒、前置脚标、特殊 run 属性和未知节点 |
| 公式字符属性 | 从段落默认值继承的统一字体、字号、颜色 | 同段内公式需要不同字符属性时拒绝；不猜测丢失的 run 格式 |
| 艺术字 | 原生预设名、整数 `val` 调整值 | 未知预设、非数值调整表达式、无效调整值 |
| 文字外观 | 纯色描边、线性渐变、单个外阴影、独立下划线颜色，可组合 | 路径渐变、渐变翻转或不随形状旋转、复杂线型、内阴影、变换阴影、效果图、非纯色下划线 |
| 资源 | 图片项目符号和既有关系闭包；复制载荷携带独立字节 | 缺少资源字节、无法生成独立包的外链图片 |
| 未支持来源 | 保留原包时继续走原生补丁保存 | 无来源生成带元素身份与原因拒绝；不会把公式替换为搜索文本 |

`TextRun.gradient` / `shadow` 保持现有 CSS 投影接口。新增 `gradientFill`（角度、精确色标、scaled）和
`shadowEffect`（偏移、模糊、颜色）承担生成语义；仅有 CSS 字符串，或 CSS 与结构值不一致时拒绝。
`generationIssues` 记录解析中无法在展示模型完整保留的来源信息。公式无需可视编辑器即可作为整体复制、移动与保存。

```ts
import { parse } from '@web-ppt/core';
import { createDoc } from '@web-ppt/edit-core';
import { copyPortableElements, generateEditDoc } from '@web-ppt/edit-core/generate';

const presentation = await parse(bytes, { edit: true, keepPackage: true, lazy: false });
const doc = createDoc(presentation);
const ids = doc.slides[doc.slideOrder[0]].children;
presentation.dispose();
const payload = copyPortableElements(doc, ids);
const savedBytes = generateEditDoc(doc).bytes;
// 目标 Editor 使用既有 PasteElements 命令接收 payload。
```

官网沿用选择窗格、复制/粘贴、撤销/重做与“保存副本”，无需新增操作入口。SDK 的真正无来源路径和
官网保留来源路径分别验证，避免把会话仍保有原包的成功误记成无来源成功。

| 验证 | 入口与证据 |
|---|---|
| 源码与包名契约 | `npm run test:portability` / `npm run test:portability:dist`；已接入 `test` / `verify` |
| 确定性样本 | `tooling/make-portable-rich-text-fixture.mjs`；已接入 `fixtures` |
| 渲染往返 | 独立进程比较三页、HTML 与 SVG 两条文字路径；图片地址替换为实际字节，defs id 不归一化 |
| 浏览器操作 | `node tooling/test-site-editor-browser.mjs --portable-copy-only`；已纳入官网完整门禁 |
| 独立读取器 | `npm run test:portability:libreoffice`；`out/portable-rich-text/libreoffice.json` |
| 入口成本 | `node tooling/measure-portability.mjs`；`out/portable-rich-text/measure.json`，采样内存不冒充峰值 |

2026-09-07 本机 Node 24.3.0 实测：生成入口 99,769B gzip（排除 core/edit-core peers），冷导入 5.5ms；
三页样本连续生成 25 次，中位 14.2ms、p95 20.8ms，输出 12,075B。堆/RSS 的最大采样增量约 91.9/179.4MiB，
包含多次调用之间未回收的分配；这组数值用于复现本机基线，不作为浏览器峰值或跨机器预算。

LibreOffice 26.2.5.2 重存保留独立公式形状的分式、根式、脚标与叶子文字；行内混排和表格公式会丢弃，
来源文件与生成文件结果相同。该行为可在 [LibreOffice 形状导入实现](https://github.com/LibreOffice/core/blob/master/oox/source/drawingml/shape.cxx)
中定位到含普通文本时放弃数学对象的分支。文字渐变与阴影也不能用其重存结果作为完整保真证明。
Windows PowerPoint 真机验收继续暂缓。

原生包装依据 [MS-ODRAWXML 数学公式示例](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-odrawxml/38b13e1f-1102-4bb7-819a-dd5d9abdb176)，
预设范围依据 [DrawingML TextShapeValues](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.textshapevalues?view=openxml-3.0.1)。
