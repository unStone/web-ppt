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
editor.exec({ type: 'AlignElements', ids: [elementId], edge: 'center' });
editor.exec({
  type: 'AddShape', slideId, preset: 'roundRect',
  rect: { x: 360, y: 180, w: 280, h: 160 },
});
const newShapeId = editor.selection.kind === 'elements' ? editor.selection.ids[0] : null;
const imageBytes = new Uint8Array(await imageFile.arrayBuffer());
editor.exec({
  type: 'AddImage', slideId, bytes: imageBytes, mime: 'image/png',
  rect: { x: 420, y: 180, w: 320, h: 220 },
});
editor.exec({
  type: 'AddTable', slideId, rows: 3, cols: 4,
  rect: { x: 180, y: 140, w: 920, h: 360 },
});
const layoutId = doc.layoutOrder[0];
const added = editor.exec({ type: 'AddSlide', layoutId, at: { after: slideId } });
const newSlideId = [...added.createdSlides][0];
editor.exec({ type: 'MoveSlide', id: newSlideId, at: { after: null } });
const duplicated = editor.exec({ type: 'DuplicateSlide', id: newSlideId });
const duplicateSlideId = [...duplicated.createdSlides][0];

const slide = editor.toSlide(slideId);
const svg = renderSlideToSvg(source, slide, { idPrefix: `${slideId}-` });
const dirty = renderElementToSvg(editor.effectiveElement(elementId), {
  idPrefix: `${slideId}-${elementId}-`,
});
// Replace this element's `dirty.markup` and `dirty.defs` partitions together.
// change.dirtyElements 与 change.dirtySlides 给出精确失效范围。

editor.subscribe(({ dirtyElements, dirtySlides, movedSlides, removedSlides, removedSlideFallbacks }) => {
  updateView(dirtyElements, dirtySlides);
  if (movedSlides.size || removedSlides.size) updatePageNavigator(doc.slideOrder);
  for (const [removedId, fallbackId] of removedSlideFallbacks) replaceActivePage(removedId, fallbackId);
});
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
Collaborative clients must pass a stable, client-unique `origin`; appended-row identities include it so two
structured-cloned documents can merge concurrent appends without sharing a path.

`RemoveElement` recursively removes an element tree while its inverse patch retains stable parent/z identity.
For a populated placeholder, the first command writes an empty-text override and keeps the shape; the next
command removes it. Save patches only the owning OOXML host or paragraph list and intentionally retains media
and relationships, which may be shared by other elements.

`SetZ { id, to: 'front' | 'back' | 'forward' | 'backward' }` changes layer order within one parent and source
part. Source `z` remains immutable; only moved elements carry a sparse `order`, so untouched objects pay no
duplicated ordering state. Subscriber events separate `reorderedElements`, whose existing DOM partitions can
move in place, from `renderElements`, which require new markup/defs.

`AlignElements { ids, edge: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom' }` aligns one
element to the slide or multiple elements to their visual AABB union. Rotated objects, nested elements in
flipped/non-uniformly scaled groups, and frame-only objects share the same world-to-parent transform. One command
is one undo unit; already aligned targets create no empty history. A React, Vue, Web Component, or vanilla toolbar
can map its six buttons directly to this JSON command without importing DOM internals.

`SetFill { id, fill }` edits vector fills on shapes: explicit no-fill, solid color, linear/radial gradients,
and renderer-supported DrawingML patterns. `SetStroke { id, stroke }` edits shape outlines and image borders,
including color, pixel width, preset dash, cap, join, compound line, and line ends. Colors are normalized to the
same `rgb()` / `rgba()` representation returned by core parsing; angles, stops, alpha, and line widths are also
quantized to round-trippable OOXML precision. Queries materialize solid/default cap/join/no-end values so UI code
does not mistake XML defaults for unknown state. Passing `null` removes the direct override and reveals the
source/theme value; `{ type: 'none' }`
is an explicit no-fill or no-stroke choice and remains direct formatting.

```ts
import {
  queryElementFill, queryElementStroke, SHAPE_PATTERN_PRESETS,
} from '@web-ppt/edit-core';

const fill = queryElementFill(editor.doc, selectedIds);
// { value, mixed, direct } is ready for React/Vue/Svelte/Web Component controls.
editor.exec({
  type: 'SetFill', id: elementId,
  fill: {
    type: 'gradient', angle: 45,
    stops: [{ pos: 0, color: '#38BDF8' }, { pos: 1, color: '#6366F1' }],
  },
});
editor.exec({
  type: 'SetStroke', id: elementId,
  stroke: { color: '#0F172A', width: 2, dash: [8, 6], cap: 'round', join: 'round' },
});
editor.exec({ type: 'SetFill', id: elementId, fill: null }); // restore inherited fill
const stroke = queryElementStroke(editor.doc, selectedIds);
```

Image-fill editing, effects, text color, and table-cell borders are separate capabilities rather than overloaded
variants of these two commands.

Slide property controls use stable page ids too. `SetBackground { id, fill }` accepts the same vector fills;
`SetHidden { id, v }` edits the slide-directory flag. In both commands `null` restores the parsed source.
`querySlideBackground` and `querySlideHidden` accept multiple `SlideId`s and return effective/source,
mixed/sourceMixed, and direct state. A background change requests one full-slide render; hidden metadata does
not rebuild visually unchanged SVG.

```ts
import { querySlideBackground, querySlideHidden } from '@web-ppt/edit-core';

const background = querySlideBackground(editor.doc, selectedSlideIds);
editor.exec({ type: 'SetBackground', id: slideId, fill: { type: 'solid', color: '#0F172A' } });
editor.exec({
  type: 'SetBackgroundImage', id: slideId, bytes: imageBytes, mime: 'image/png',
  crop: { l: 0.1, t: 0.05, r: 0.1, b: 0.05 }, alpha: 0.85,
});
editor.exec({ type: 'SetBackgroundCrop', id: slideId, crop: null }); // clear crop, keep image
editor.exec({ type: 'SetHidden', id: slideId, v: true });
const hidden = querySlideHidden(editor.doc, selectedSlideIds);
```

Image backgrounds use content-addressed media resources. Uploading identical bytes across pages stores one media
part; source and inherited image backgrounds can be cropped without editing the shared layout or master.

Hyperlinks use stable domain targets instead of page indexes or OOXML actions. `SetLink` edits shape/image links;
`SetRunProps` uses the same `link` field for a text range. `{ kind: 'none' }` explicitly removes a link, while
`null` restores the parsed source. `queryElementLink` and `queryRunLink` return effective/source/direct/mixed and
followable state, so React, Vue, Svelte, Web Component, and vanilla toolbars never inspect `src` or `ovr`.

```ts
import { queryElementLink, queryRunLink } from '@web-ppt/edit-core';

editor.exec({
  type: 'SetLink', id: elementId,
  target: { kind: 'slide', slideId: doc.slideOrder[2] },
});
const elementLink = queryElementLink(doc, [elementId]);
editor.exec({
  type: 'SetRunProps', id: elementId, range,
  props: { link: { kind: 'external', href: 'https://example.com/docs' } },
});
const runLink = queryRunLink(doc, elementId, range);
```

External targets accept normalized `http`, `https`, and `mailto` URLs only. Internal targets retain `SlideId`
through page reorder, undo/redo, save/reopen, and same/cross-document element copy. Relative or unsupported source
actions remain queryable and preserved as read-only source values.

`SetRunProps` applies sparse character-format overrides to a half-open text range. It supports font family,
font size in slide pixels, bold, italic, underline, and strike-through across run and paragraph boundaries.
Use `null` to remove a direct override and reveal the inherited OOXML value; formulas remain indivisible,
format-preserving atoms while dynamic fields retain their field identity on save. A collapsed headless range is intentionally a no-op—
pending typing style belongs to the mounted input adapter, so the document never stores zero-width OOXML runs.

```ts
import { queryRunProps } from '@web-ppt/edit-core';

const range = {
  from: { p: 0, r: 0, off: 2 },
  to: { p: 1, r: 0, off: 4 },
};
editor.exec({
  type: 'SetRunProps', id: elementId, range,
  props: { font: 'Inter', size: 24, b: true },
});
const state = queryRunProps(editor.doc, elementId, range);
// state.b: { value: true, mixed: false }; each property reports mixed state independently.
```

`SetParaProps` applies paragraph formatting to every paragraph touched by a range, including empty paragraphs.
A collapsed range formats its current paragraph immediately. The P0 property set is alignment, effective line-height
multiplier, spacing before/after in slide pixels, left margin in slide pixels, and signed first-line indent in slide
pixels. `null` removes only that direct `pPr` field and reveals its inherited level style; clearing a field that was
never direct is a strict no-op. `queryParaProps` reports an independent `{ value, mixed }` state for every property.

```ts
import { queryParaProps } from '@web-ppt/edit-core';

editor.exec({
  type: 'SetParaProps', id: elementId, range,
  props: { align: 'center', lineHeight: 1.5, spaceAfter: 8, indent: -12 },
});
const paragraphState = queryParaProps(editor.doc, elementId, range);
// paragraphState.align: { value: 'center', mixed: false }
```

`EditText` also accepts `replaceFragment`, a JSON-only rich-text splice for clipboard adapters. A fragment contains
paragraph strings and contiguous half-open marks with only the six P0 character properties; DOM nodes, CSS, and
OOXML source identities cannot cross this boundary. Unspecified fields inherit the replaced range's starting
style, blocks create paragraphs, and embedded `\n` values remain hard line breaks. `textFragmentFromRange()`
creates the inverse transport shape for copy/cut without exposing preservation metadata.

```ts
import { textFragmentFromRange } from '@web-ppt/edit-core';

const fragment = textFragmentFromRange(editor.effectiveElement(elementId).text!, range);
editor.exec({
  type: 'EditText', id: elementId,
  ops: [{ type: 'replaceFragment', ...range, fragment }],
});
```

`copyElements(doc, ids)` returns a versioned, JSON-only `ElementClipboardPayload`. Paste it through
`Editor.exec({ type: 'PasteElements', payload, at: { parentId, x, y } })`; the command allocates fresh session
and OOXML identities, preserves nested groups in slide coordinates, and enters history as one atomic unit.
Images are embedded as base64 plus SHA-256 and deduplicated against the destination package. Hyperlinks receive
new relationships. Complex objects such as SmartArt can reuse a verified same-package OPC closure; a different
package is rejected before any model identity is allocated instead of receiving a degraded preview.

`InsertRow` intentionally exposes append-only table semantics for now, shared by last-cell Tab and an
“add row at end” control. It does not accept an `at` value that would be unsafe across vertical merges. The new row
keeps the former last row's height, direct/input formatting, and horizontal merge topology, clears its content,
and recomputes `bandRow`, `lastRow`, and frame height. History stores one sparse stable-row patch, not a table copy.

```ts
editor.exec({ type: 'InsertRow', id: tableElementId });
```

`AddShape { slideId, preset, rect }` inserts a top-level DrawingML preset shape into an existing writable
slide. The command validates the preset and rectangle, allocates collision-free model/OOXML identities, selects
the new shape, and enters history as one tree patch. It is immediately compatible with the existing transform
and double-click text-editing paths. Toolbars in React, Vue, Svelte, Web Components, or vanilla code call this
same JSON command; the headless package does not depend on their runtimes.

`AddImage { slideId, bytes, mime, rect, placeholderId? }` recognizes complete PNG, JPEG, GIF, and WebP
containers from magic bytes, copies caller-owned bytes, and inserts one immediately renderable `ImageElement`.
SHA-256 deduplicates media already in the source package or inserted elsewhere in the session; each picture still
gets its own collision-free relationship and `p:pic` identity. Supplying an empty picture `placeholderId` replaces
the placeholder atomically. One tree-patch group owns element, relationship, media, Content Types, selection,
undo/redo, and minimal save semantics; the model stores one hash token instead of duplicating Base64 in `src`.
SVG input is deliberately excluded until its external references and scripts have a separate sanitizer contract.

`AddTable { slideId, rows, cols, rect, placeholderId? }` inserts a 1–75 by 1–75 native DrawingML table. Integer
EMU distribution keeps column and row sums exact. The source deck's default table style and current theme are
resolved once for the immediate model and referenced by the saved `a:tbl`, so first-row/banding colors do not jump
after reopening. Empty cells are editable immediately and already carry the append-row templates used by final-cell
`Tab`. An empty content placeholder can be replaced atomically; save changes only the owning slide part.

`doc.layoutOrder` and `doc.layouts` expose the source deck's real layout catalog only in edit mode.
`AddSlide { layoutId, at: { after } }` creates one page from that layout without cloning another slide. The
returned `createdSlides` set is the stable hand-off to any React, Vue, Svelte, Web Component, or vanilla page
navigator; subscribers receive the same set. Empty title/body placeholders keep layout geometry and text style
but not prompt content, while date/footer/page-number placeholders remain OOXML fields. Undo/redo restores the
same model and OPC identities; save adds the required package references without rebuilding untouched parts.

`MoveSlide { id, at: { after } }` reorders an existing or newly created page by stable identities; `null` moves
it to the front. It emits `movedSlides` without pretending the page was removed and re-created, so React, Vue,
Svelte, Web Component, and vanilla navigators can read the final `doc.slideOrder` while mounted canvases keep
their current `SlideId`. Undo/redo, page-number fields, relative links, section membership, notes, and minimal
OOXML save all follow the same order.

`RemoveSlide { id }` deletes an existing or session-created page and rejects deleting the only remaining page.
Transactions and subscriptions expose `removedSlides` plus `removedSlideFallbacks`: each removed id maps to its
nearest surviving successor, or the predecessor at the tail. This lets any framework update its active route
without deriving transient indexes. Undo/redo restores the same page/element/OPC identities. Save removes the
slide indexes and parts plus an exclusively owned notes slide, while shared media and unknown relationship targets
remain untouched.

`DuplicateSlide { id }` snapshots the page's current effective tree and inserts an independent copy immediately
after it. The returned `createdSlides` identity is the only value framework adapters need; use a separate
`MoveSlide` command for another destination. Page/element ids, slide/notes parts, presentation ids, and notes
back-references are independent, while layout, media, charts, comments, and unknown targets keep sharing their
original package resources. Later edits or deletion of either page cannot mutate the other.

`querySlideNotes(doc, ids)` returns `value/source/mixed/sourceMixed/direct` for plain-text speaker notes, so
toolbars never inspect `src/ovr`. `SetNotes { id, text }` maps newlines to DrawingML paragraphs and treats an
empty string as an explicit clear. Transactions publish only `notesSlides` and do not dirty the canvas projection.
Old or session-created pages without notes materialize their OPC closure only on first edit; shared notes first fork
to an independent part while other placeholders, formatting, notesMaster, external links, and unknown extensions
remain byte-preserved.

The HTML result shares the preview renderer and carries `data-p` / `data-r`, bullet, empty-run, and autofit
markers for a contenteditable overlay. The core function stays DOM-free; the editor adapter owns focus and IME.
`layoutText` shares native SVG line breaking and returns paragraph/run identities plus UTF-16 caret stops.
Its `transform` maps logical coordinates for vertical text; pass `{ includeCarets: false }` for geometry-only work.

`Editor.save()` is the normal API: it writes current transforms, layer order, text, character and paragraph formatting,
appended table rows, new shapes/pages, page duplication/removals, speaker notes, placeholder clears, and element removals, refreshes `doc.package` for the
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
Measured Vite output, including each entry's static shared chunks, is 62.33 KB gzip for the editing entry,
8.07 KB for `xml`, and 4.38 KB for `opc`; calling save after the main entry adds 8.30 KB on demand. Clean local
headers, extra fields, and compressed streams are copied byte-for-byte. ZIP64, descriptors, archive comments,
and encrypted entries return an explicit reason and deterministically repack. Every entry is DOM-free.

`doc.meta.readonly` is `true` when a `.pptx` was not parsed with the package and write-back metadata.
Legacy `.ppt` documents remain editable through the future generated-save path; binary `.ppt` write-back is intentionally unsupported.
For collaborative ordering, pass the new element's stable ULID as the third argument to
`fractionalIndexBetween(lower, upper, ulid)`; single-user callers can omit it.

MIT
