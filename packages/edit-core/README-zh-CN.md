# @web-ppt/edit-core

[English](README.md) · **简体中文**

[Web-PPT](https://github.com/unStone/web-ppt) 的无 DOM、无框架编辑模型。
它把解析源值与用户覆盖分开保存，为页和元素分配会话内稳定身份，再投影回现有高保真 `Slide` Schema。

```bash
npm i @web-ppt/core @web-ppt/edit-core
```

```ts
import { layoutText, parse, renderElementToSvg, renderSlideToSvg, renderTextBodyToHtml } from '@web-ppt/core';
import { createDoc, effectiveElement, invalidateElement, toSlide } from '@web-ppt/edit-core';

const source = await parse(file, { edit: true, keepPackage: true, lazy: false });
const doc = createDoc(source);
const slideId = doc.slideOrder[0];
const elementId = doc.slides[slideId].children[0];

doc.elements[elementId].ovr.x = 120;
invalidateElement(doc, elementId);

const slide = toSlide(doc, slideId);
const svg = renderSlideToSvg(source, slide, { idPrefix: `${slideId}-` });
const dirty = renderElementToSvg(effectiveElement(doc, elementId), {
  idPrefix: `${slideId}-${elementId}-`,
});
// 把该元素自己的 dirty.markup 与 dirty.defs 两个 DOM 分区一起替换。

const element = effectiveElement(doc, elementId);
if (element.kind === 'shape' && element.text) {
  const textLayer = document.querySelector<HTMLElement>('[data-text-layer]')!;
  textLayer.innerHTML = renderTextBodyToHtml(element.text, element.w, element.h);
  const editor = textLayer.firstElementChild as HTMLElement;
  editor.contentEditable = 'true';
  editor.spellcheck = false;

  // Safari engine 模式：不用在 SVG 内编辑，也能把指针 x 映射为 UTF-16 光标偏移。
  const engineLayout = layoutText(element.text, element.w, element.h);
  const caretStops = engineLayout.lines.flatMap((line) =>
    line.segments.flatMap((segment) => segment.carets));
}
```

HTML 结果与预览共用渲染器，并带 `data-p` / `data-r`、项目符号、空 run 和 autofit 标记，
可直接作为 contenteditable 覆盖层的内容。core 仍不访问 DOM；焦点与 IME 生命周期由编辑器适配层负责。
`layoutText` 与原生 SVG 共用断行，并返回段落/run 身份和 UTF-16 光标停靠点；竖排用返回的
`transform` 映射逻辑坐标。只需要行盒时可传 `{ includeCarets: false }` 跳过逐字测量。

保留型 OOXML 树只在保存时按需加载，默认编辑模型入口仍是 2.92KB gzip：

```ts
import {
  findXmlChild, findXmlDescendant, parseXmlTree, serializeXmlTreeBytes, setXmlAttribute,
} from '@web-ppt/edit-core/xml';

const tree = parseXmlTree(doc.package!.parts['ppt/slides/slide1.xml']);
const xfrm = findXmlDescendant(tree.root, { localName: 'xfrm' })!;
const off = findXmlChild(xfrm, { localName: 'off' })!;
setXmlAttribute(off, 'x', String(Math.round(element.x * 9525)));
const changedPart = serializeXmlTreeBytes(tree);
```

未触碰的声明、注释、处理指令、前缀、属性顺序、自闭合形态和 `AlternateContent` 保持原词法；
`insertXmlInOrder` 统一执行 OOXML sequence。UTF-8 / UTF-16 字节序和 BOM 均保留；可选的
`xml` 入口为 7.14KB gzip，同样不依赖 DOM。

若 `.pptx` 没有用编辑元数据与原包模式解析，`doc.meta.readonly` 会明确为 `true`，避免产生无法保存的修改。
旧 `.ppt` 走后续的生成式 `.pptx` 保存路径，不支持写回二进制 `.ppt`。
协同排序时把新元素的稳定 ULID 作为第三个参数传给
`fractionalIndexBetween(lower, upper, ulid)`；单机模式可省略。

MIT
