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
import { createDoc, Editor } from '@web-ppt/edit-core';

const source = await parse(file, { edit: true, keepPackage: true, lazy: false });
const doc = createDoc(source);
const editor = new Editor(doc);
const slideId = doc.slideOrder[0];
const elementId = doc.slides[slideId].children[0];

const change = editor.exec({ type: 'SetXfrm', id: elementId, x: 120 });
editor.exec({ type: 'SetFlip', id: elementId, h: true });

const slide = editor.toSlide(slideId);
const svg = renderSlideToSvg(source, slide, { idPrefix: `${slideId}-` });
const dirty = renderElementToSvg(editor.effectiveElement(elementId), {
  idPrefix: `${slideId}-${elementId}-`,
});
// Replace this element's `dirty.markup` and `dirty.defs` partitions together.
// change.dirtyElements 与 change.dirtySlides 给出精确失效范围。

editor.subscribe(({ dirtyElements, dirtySlides }) => updateView(dirtyElements, dirtySlides));
editor.undo();
editor.redo();
const pptxBytes = await editor.save(); // dynamically loads the OOXML/ZIP save path

const element = editor.effectiveElement(elementId);
if (element.kind === 'shape' && element.text) {
  const textLayer = document.querySelector<HTMLElement>('[data-text-layer]')!;
  textLayer.innerHTML = renderTextBodyToHtml(element.text, element.w, element.h);
  const textEditor = textLayer.firstElementChild as HTMLElement;
  textEditor.contentEditable = 'true';
  textEditor.spellcheck = false;

  // Safari engine mode: map pointer x to UTF-16 caret offsets without editing inside SVG.
  const engineLayout = layoutText(element.text, element.w, element.h);
  const caretStops = engineLayout.lines.flatMap((line) =>
    line.segments.flatMap((segment) => segment.carets));
}
```

Commands and patches are plain JSON. A transaction validates and commits atomically, creates one local undo
unit, and restores selection on undo/redo. Repeated edits with the same `mergeKey` merge for at most 500ms;
remote `origin` values apply without entering local history. `isDirty()` compares the current state with the
last `markSaved()` checkpoint. React, Vue, Web Components, or vanilla adapters only need `subscribe()` and
the two projection methods; none of their runtimes enter this package.

`RemoveElement` recursively removes an element tree while its inverse patch retains stable parent/z identity.
For a populated placeholder, the first command writes an empty-text override and keeps the shape; the next
command removes it. Save patches only the owning OOXML host or paragraph list and intentionally retains media
and relationships, which may be shared by other elements.

`SetZ { id, to: 'front' | 'back' | 'forward' | 'backward' }` changes layer order within one parent and source
part. Source `z` remains immutable; only moved elements carry a sparse `order`, so untouched objects pay no
duplicated ordering state. Subscriber events separate `reorderedElements`, whose existing DOM partitions can
move in place, from `renderElements`, which require new markup/defs.

The HTML result shares the preview renderer and carries `data-p` / `data-r`, bullet, empty-run, and autofit
markers for a contenteditable overlay. The core function stays DOM-free; the editor adapter owns focus and IME.
`layoutText` shares native SVG line breaking and returns paragraph/run identities plus UTF-16 caret stops.
Its `transform` maps logical coordinates for vertical text; pass `{ includeCarets: false }` for geometry-only work.

`Editor.save()` is the normal API: it writes current transforms, layer order, placeholder clears, and element removals, refreshes `doc.package` for the
next save, and advances the dirty checkpoint only after a successful write. For save diagnostics, use the
detailed method without changing lifecycle semantics:

```ts
const result = await editor.saveDetailed();
// result.mode: identity | passthrough | repacked
// result.fallbackReason explains why a package had to be rebuilt.
```

Load the lower-level preserving OOXML tree only when building another writer:

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

The lower-level OPC patcher remains available for standalone package transforms:

```ts
import { disposeOpcPackage, patchOpcPackage } from '@web-ppt/edit-core/opc';

const packageHandle = doc.package!;
const saved = patchOpcPackage(packageHandle, {
  'ppt/slides/slide1.xml': changedPart,
});
const pptxBytes = saved.bytes;
// saved.mode: identity | passthrough | repacked
// A non-null fallbackReason lets the UI explain why this save rebuilt the archive.
```

Do not assign a low-level result to a live `EditDoc`: `Editor.save()` coordinates the package with its undo
baseline. To intentionally adopt a complete external snapshot, call `replaceDocPackage(doc, saved.package)`;
this explicitly resets that baseline. `disposeDoc(doc)` releases the current package. If you keep a save
result outside an `EditDoc`, call `disposeOpcPackage(saved.package)` when it is no longer needed.

Untouched declarations, comments, processing instructions, prefixes, attribute order, self-closing form,
and `AlternateContent` remain lexical matches. `insertXmlInOrder` enforces OOXML sequence ordering, while
`reorderXmlChildren` replaces only existing target slots. UTF-8 and UTF-16 byte order/BOM are retained.
Measured Vite output is 14.19 KB gzip for the initial editing entry, 7.72 KB for `xml`, and 4.37 KB for `opc`;
calling save after the main entry adds 14.62 KB on demand. Clean local
headers, extra fields, and compressed streams are copied byte-for-byte. ZIP64, descriptors, archive comments,
and encrypted entries return an explicit reason and deterministically repack. Every entry is DOM-free.

`doc.meta.readonly` is `true` when a `.pptx` was not parsed with the package and write-back metadata.
Legacy `.ppt` documents remain editable through the future generated-save path; binary `.ppt` write-back is intentionally unsupported.
For collaborative ordering, pass the new element's stable ULID as the third argument to
`fractionalIndexBetween(lower, upper, ulid)`; single-user callers can omit it.

MIT
