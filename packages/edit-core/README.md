# @web-ppt/edit-core

**English** · [简体中文](https://github.com/unStone/web-ppt/blob/master/packages/edit-core/README-zh-CN.md)

The headless, framework-agnostic editing model for [Web-PPT](https://github.com/unStone/web-ppt).
It keeps parsed source values separate from user overrides, assigns stable session identities, and projects
an editable document back to the existing high-fidelity `Slide` schema. It has no DOM dependency.

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
// Replace this element's `dirty.markup` and `dirty.defs` partitions together.

const element = effectiveElement(doc, elementId);
if (element.kind === 'shape' && element.text) {
  const textLayer = document.querySelector<HTMLElement>('[data-text-layer]')!;
  textLayer.innerHTML = renderTextBodyToHtml(element.text, element.w, element.h);
  const editor = textLayer.firstElementChild as HTMLElement;
  editor.contentEditable = 'true';
  editor.spellcheck = false;

  // Safari engine mode: map pointer x to UTF-16 caret offsets without editing inside SVG.
  const engineLayout = layoutText(element.text, element.w, element.h);
  const caretStops = engineLayout.lines.flatMap((line) =>
    line.segments.flatMap((segment) => segment.carets));
}
```

The HTML result shares the preview renderer and carries `data-p` / `data-r`, bullet, empty-run, and autofit
markers for a contenteditable overlay. The core function stays DOM-free; the editor adapter owns focus and IME.
`layoutText` shares native SVG line breaking and returns paragraph/run identities plus UTF-16 caret stops.
Its `transform` maps logical coordinates for vertical text; pass `{ includeCarets: false }` for geometry-only work.

Load the preserving OOXML tree only on the save path; the default editing-model entry stays 2.92 KB gzip:

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

Untouched declarations, comments, processing instructions, prefixes, attribute order, self-closing form,
and `AlternateContent` remain lexical matches. `insertXmlInOrder` enforces OOXML sequence ordering. UTF-8
and UTF-16 byte order/BOM are retained; the optional `xml` entry is 7.14 KB gzip and has no DOM dependency.

`doc.meta.readonly` is `true` when a `.pptx` was not parsed with the package and write-back metadata.
Legacy `.ppt` documents remain editable through the future generated-save path; binary `.ppt` write-back is intentionally unsupported.
For collaborative ordering, pass the new element's stable ULID as the third argument to
`fractionalIndexBetween(lower, upper, ulid)`; single-user callers can omit it.

MIT
