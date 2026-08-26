# @web-ppt/editor

**English** · [简体中文](https://github.com/unStone/web-ppt/blob/master/packages/editor/README-zh-CN.md)

The framework-agnostic browser DOM layer for [Web-PPT](https://github.com/unStone/web-ppt). It opens a
source file once, owns its parsed resources and headless editing model, and mounts one or more high-fidelity
slide views without uploading the file.

```bash
npm i @web-ppt/core @web-ppt/edit-core @web-ppt/viewer-core @web-ppt/editor
```

```ts
import { openEditor } from '@web-ppt/editor';

const session = await openEditor(file);
const view = session.mount(container, {
  mode: 'edit', zoom: 1, textMode: 'auto', snapping: true,
  snapMargins: { left: 24, right: 24, top: 24, bottom: 24 }, // optional slide px
});

const slideId = session.editor.doc.slideOrder[0];
const elementId = session.editor.doc.slides[slideId].children[0];
session.editor.exec({ type: 'SetXfrm', id: elementId, x: 120 });
session.editor.exec({ type: 'AlignElements', ids: [elementId], edge: 'center' });
session.editor.exec({
  type: 'AddShape', slideId, preset: 'roundRect',
  rect: { x: 360, y: 180, w: 280, h: 160 },
});
const layoutId = session.editor.doc.layoutOrder[0];
const added = session.editor.exec({ type: 'AddSlide', layoutId, at: { after: slideId } });
view.setSlide([...added.createdSlides][0]);
session.editor.exec({ type: 'MoveSlide', id: view.slideId, at: { after: null } });
const duplicated = session.editor.exec({ type: 'DuplicateSlide', id: view.slideId });
view.setSlide([...duplicated.createdSlides][0]);

await view.insertImage(imageFile, { rect: { x: 420, y: 180, w: 320, h: 220 } });
// Or from a toolbar click: const imageId = await view.chooseImage();
const tableId = view.insertTable(3, 4); // rows, columns; replaces a selected empty content placeholder

view.setMode('view');       // same static preview DOM; interaction layers are hidden
view.setMode('edit');
view.setSlide(slideId);
view.setZoom(1.5);
view.setSnapping(false);   // can be changed without remounting

notesTextarea.value = view.queryNotes().value;
notesTextarea.addEventListener('input', () => view.setNotes(notesTextarea.value));
// View mode can still queryNotes(), but setNotes() returns false without mutating the shared model.

const bytes = await session.editor.save();
view.destroy();             // destroys only this mounted view
session.dispose();          // destroys remaining views and releases ZIP bytes / blob URLs
```

## Autosave and crash recovery

Storage is opt-in. Once `recovery` is provided, the source is read once, identified by a full-byte SHA-256, and
parsed from those same bytes. Transactions are appended in asynchronous batches, so canvas commits never wait for
IndexedDB.

```ts
import { createIndexedDbRecoveryStore, openEditor } from '@web-ppt/editor';

const recoveryStore = createIndexedDbRecoveryStore({ namespace: 'my-editor' });
const session = await openEditor(file, {
  recovery: {
    store: recoveryStore,
    decide: async (candidate) => showRecoveryDialog({
      changedAt: new Date(candidate.updatedAt),
      actions: ['restore', 'discard', 'cancel'],
    }),
    onError: (error) => showAutosaveWarning(error),
  },
});

await session.recovery?.flush(); // await queued frames before a critical navigation
session.dispose();
await recoveryStore.close();     // share one store across sessions; close it at app shutdown
```

Equal bytes across `File`, `Blob`, `ArrayBuffer`, and `Uint8Array` resolve to one journal; equal names or sizes do
not. `restore` reuses the stored `idPrefix` before any DOM is visible, while `discard` atomically replaces the old
journal with an empty, new-generation reservation. Late writes from an older tab are rejected instead of reviving
discarded edits. `cancel` neither parses nor mounts nor changes the journal. A clean tail is reset without prompting.
Edits made after a save retain the complete chain from the original source.

Defaults compact more than 64 chunks back to 32 and retain at most 20 journals, 16MB, or 30 days. `stats()`,
`cleanup()`, and factory options expose those controls. Compaction regroups patch frames unchanged and coalesces only
consecutive metadata-only frames, preserving the final selection/savepoint state. Append/quota failures never roll back committed edits; they surface through
`session.recovery.error`, `flush()` rejection, and `onError` without an unhandled rejection.

A custom `RecoveryStore` implements `load`, atomic `reset`, atomic `append`, and `remove`. It must persist and compare
the supplied `epoch`; this is the generation guard that prevents a stale session from appending after discard. Its
`reset` must also reject before commit when `request.signal` is aborted, so a superseded open cannot overwrite the
latest reservation.

You may still supply `idPrefix + recoveryFrames` from `@web-ppt/edit-core` for custom persistence, but not together
with `recovery`. Framework adapters use O(1) reference identity for both stores and manual logs rather than scanning
them on every render.

## Framework adapter contract

`createWebPptAdapter()` is the lifecycle boundary used by `@web-ppt/react` and `@web-ppt/vue`; Svelte, Web
Components, and other hosts can bind it directly. It is safe to import during SSR and in a Worker because no DOM or
IndexedDB global is touched until a session or store is explicitly created; `attach()` is the first DOM boundary.

```ts
import { applyWebPptAdapterBinding, createWebPptAdapter } from '@web-ppt/editor';

const adapter = createWebPptAdapter({ onError: console.error });
adapter.attach(container);
await applyWebPptAdapterBinding(adapter, {
  source: file, mode: 'edit', slideId, zoom: 1,
  onViewChange: (state) => routeTo(state.slideId),
});
const bytes = await adapter.save();
adapter.dispose();
```

The adapter owns sessions opened from `source` and atomically releases them on replacement or disposal. To share
an existing session across several adapters, pass `{ session, sessionOwnership: 'external' }`; each adapter then
destroys only its view and the caller remains responsible for `session.dispose()`. Concurrent stale opens dispose
their late result. `snapshot` and `subscribe()` expose idle/opening/recovering/ready/error state, progress, the
recovery candidate, session, view, mode, stable slide id, and zoom without introducing a second presentation model.
When persistence is enabled, `onRecovery(candidate)` returns `restore`, `discard`, or `cancel`; React and Vue pass
through this same callback.

Every host maps the same four operations; no rendering or editor state is reimplemented:

| Host | Create / update / destroy mapping |
|---|---|
| React | effect creates adapter → props call `applyWebPptAdapterBinding` → cleanup calls `dispose` |
| Vue | `onMounted` creates → reactive effect applies binding → `onBeforeUnmount` disposes |
| Svelte | `onMount` creates and returns `dispose`; `$effect` applies the controlled binding |
| Web Component | `connectedCallback` creates/attaches; attributes apply binding; `disconnectedCallback` disposes |

For a reconnectable custom element, create a fresh adapter on every `connectedCallback` rather than retaining a
disposed controller. Container mounting remains `adapter.attach(this)`, so Shadow DOM is optional and product CSS
or toolbars stay outside the contract.

`SlideEditor` owns three stacked layers: the existing SVG preview, an SVG interaction overlay, and an HTML
text overlay. A headless `Editor` transaction replaces only the dirty element's markup and defs partition;
unchanged sibling DOM nodes keep their identity. The view falls back to one full render only when more than eight
partitions and over 30% of the slide's top-level elements are dirty, avoiding ratio distortion on small slides.
Stable `data-edit-id` values are assigned to top-level and nested group nodes, so DOM hit testing never depends
on part-local OOXML ids.

In edit mode, pointer selection uses the browser's native SVG hit testing. A click inside a group selects its
outermost group; double-click enters one group level and `Escape` leaves one level. `Alt`+click cycles through
overlapping candidates in `elementsFromPoint` z-order. Locked, user-hidden, and non-editable branches are
skipped. View mode does not intercept pointer events or mutate the shared headless selection. Selection changes
replace only the interaction overlay, leaving the static preview DOM untouched.

`Shift`, `Ctrl`, or macOS `Command`+click toggles a direct selectable child in the current slide or entered
group. Combining the selection modifier with `Alt` still reaches an unselected object behind the current stack.
A modified marquee previews and commits the symmetric difference between the valid prior selection and fully
contained objects; a modified blank click preserves the selection. Results follow paint order, create no history,
and never rebuild the static preview.

When an edit view has focus, arrow keys nudge in slide space by `1px`; `Shift`+arrow nudges by `10px`.
Multi-selections and elements inside rotated, flipped, non-uniformly scaled groups receive the same world-space
delta. Auto-repeat from one physical hold is one undo unit, while a press after key-up starts another. A locked,
hidden, non-editable, or off-page member rejects the whole operation. View mode, active pointer gestures, and
form/contenteditable controls in either regular or Shadow DOM keep ownership of their arrow keys.

`Tab` and `Shift`+`Tab` cycle forward or backward through the direct selectable children of the current slide
or entered group, in paint order and with wrap-around. A selection owned by another mounted page starts at this
view's first or last candidate. The traversal changes selection only: it creates no history entry and preserves
the static preview DOM. Form and contenteditable controls, including those in Shadow DOM, keep native Tab focus.

After a table cell is opened in the same text editor, `Tab` and `Shift`+`Tab` move only between visible merge-start
cells. `Tab` in the final cell runs one `InsertRow` transaction and enters the first cell of the new blank row.
Table style, frame height, static preview, selection box, and caret update together without losing focus. View mode
never emits the structural command.

`Ctrl/Cmd+Z` undoes; `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` redoes. If the restored selection belongs to another
slide, only the edit view that received the shortcut reveals that slide; other shared views stay put. Active
pointer previews and regular or Shadow DOM text controls retain keyboard ownership, while single-element history
still replaces only that element's DOM partition.

`Delete` or `Backspace` removes the current element selection as one undo unit. Groups are recursive; frame-only
objects such as charts, SmartArt, and OLE lose their outer frame without garbage-collecting potentially shared
relationships or media. A populated placeholder clears its text on the first deletion and removes its frame on
the second. Delete and undo remove or reinsert only the affected markup/defs partitions in stable z-order, so
untouched sibling DOM identities survive. Form controls, contenteditable or Shadow DOM text, and active pointer
gestures keep native keyboard ownership.

`Ctrl/Cmd+]` moves forward, `Ctrl/Cmd+Shift+]` brings to front, `Ctrl/Cmd+[` moves backward, and
`Ctrl/Cmd+Shift+[` sends to back. A multi-selection moves as one undo unit without reversing its internal order;
group children and frame-only objects use the same semantics, and boundary operations create no empty history.
Views move existing markup partitions in place, preserving defs, hyperlink wrappers, untouched siblings, and
node identities in every shared view.

Focused edit views support native `Ctrl/Cmd+C`, `X`, and `V` through synchronous `ClipboardEvent` handling.
The view writes `application/x-web-ppt-elements+json` and `text/plain`, never calls permission-gated
`navigator.clipboard`, and pastes multiple element trees as one undo unit. `Ctrl/Cmd+D` duplicates the current
selection by 10 slide pixels without changing the system clipboard. View mode, active pointer gestures,
text/table selections, and form/contenteditable descendants retain browser ownership. Small pastes insert only
new markup/defs partitions; large batches may use the existing bounded full-slide fallback.

Links keep PowerPoint's edit/view distinction. Edit-mode clicks only select; `Ctrl/Cmd+Enter` or
`view.followLink()` follows the current single element/text link. In view mode, internal links are focusable with
`Tab`, activate with `Enter`, and route through the view's stable `SlideId` state; safe external links open with
`noopener,noreferrer`. A framework can intercept both through one callback and return `true` when its router handled
the target:

```ts
const view = session.mount(container, {
  mode: 'edit',
  onLinkFollow(target, context) {
    if (target.kind === 'slide') {
      appRouter.openSlide(target.slideId);
      return true;
    }
  },
});
view.followLink({ kind: 'external', href: 'https://example.com/docs' });
```

The callback receives only `LinkTarget` (`external` or stable `slide`), never a raw page index or OOXML action.
View mode installs no edit pointer/keyboard/clipboard listeners; mode switches and `destroy()` release their
listeners symmetrically, so multiple React/Vue/Svelte/Web Component/vanilla views keep local navigation state.

Double-clicking an editable shape opens the HTML text layer with native selection and IME composition. Selected
text responds to `Ctrl/Cmd+B`, `I`, and `U` as one undo unit; the equivalent `beforeinput` format events are also
handled. At a collapsed caret these shortcuts update view-local pending typing style, and the next insertion plus
its format commit as one history unit without creating a zero-width model run. The live DOM range is published as
`session.editor.selection`; non-collapsed ranges can use headless `SetRunProps` / `queryRunProps` directly. A mounted
toolbar uses the view seam below so collapsed-caret typing style stays with the owning input view. Every mounted
view refreshes while the active browser range is preserved. Switching to view mode closes the input layer and keeps
the high-fidelity static preview.

```ts
const unregister = view.registerTextUi(toolbarElement);
boldButton.addEventListener('pointerdown', (event) => {
  event.preventDefault(); // keep native selection/focus stable
  const state = view.queryRunProps();
  if (state) view.setRunProps({ b: state.b.mixed || state.b.value !== true });
});
centerButton.addEventListener('pointerdown', (event) => {
  event.preventDefault();
  const state = view.queryParaProps();
  if (state) view.setParaProps({ align: 'center' });
});
// unregister() when this toolbar no longer belongs to the view.
```

Paragraph controls use the same live DOM Range and remain framework-neutral. `setParaProps` formats every touched
paragraph—including the current paragraph at a collapsed caret—in one undo unit, then restores the browser Range.
`queryParaProps` returns per-property mixed state for alignment, effective line height, spacing, margin, and indent.
The command refreshes all views sharing the session; an external toolbar registered with `registerTextUi` does not
steal focus or accidentally close text editing.

Text-mode `Ctrl/Cmd+C`, `X`, and `V` use the same synchronous browser clipboard events as native editors. Copy and
cut publish sanitized `text/plain` plus `text/html`; default paste keeps only font, size, bold, italic, underline,
and strike-through, while `Ctrl/Cmd+Shift+V` ignores HTML. Blocks become PPT paragraphs and `<br>` remains a hard
line break. External HTML is parsed in a detached tree and never injected into the live editor; scripts, style
sheets, link targets, image sources, hidden metadata, and unsupported CSS are discarded. If sanitized HTML text
does not equal `text/plain`, formatting is dropped instead of guessing offsets. A paste or cut is one undo unit.
Image-only paste on the canvas routes through the same `AddImage` command and creates one undo unit. Text/table
selections still retain their native paste ownership.

Product toolbars stay outside the base DOM package. Their six alignment actions call the headless
`AlignElements` command directly; the mounted view synchronously patches only elements that actually moved and
refreshes the interaction frame. This keeps the same integration surface for React, Vue, Web Components, and
vanilla applications without putting a framework runtime into the editor package.

Fill and outline controls use the same external-toolbar seam. The editor entry re-exports
`queryElementFill`, `queryElementStroke`, and `SHAPE_PATTERN_PRESETS`, so an adapter can derive mixed/effective
state and submit JSON commands without reading SVG or importing editor internals. Every mounted edit and view
surface updates the target markup/defs partition; unchanged siblings and the page SVG keep their DOM identity.

```ts
import { openEditor, queryElementFill } from '@web-ppt/editor';

const state = queryElementFill(session.editor.doc, selectedIds);
session.editor.exec({
  type: 'SetFill', id: selectedIds[0],
  fill: { type: 'solid', color: state.mixed ? '#2563EB' : '#0EA5E9' },
});
session.editor.exec({
  type: 'SetStroke', id: selectedIds[0],
  stroke: { color: '#0F172A', width: 2, dash: null },
});
```

Page-sidebars use the re-exported `querySlideBackground` / `querySlideHidden` functions and submit
`SetBackground` / `SetHidden` through the same headless editor. Multiple mounted edit/view surfaces showing the
target page receive the new background synchronously; surfaces on other pages retain their SVG identity.
For local files, call `await view.setBackgroundImage(file, options)` or `view.chooseBackgroundImage()`; use
`view.setBackgroundCrop(cropOrNull)` for an existing or inherited image background. These methods are available to
React, Vue, Web Component, and vanilla toolbars without exposing OPC relationships or media hashes.

Shape palettes use the same framework-neutral seam: call `session.editor.exec({ type: 'AddShape', ... })`.
Every mounted view inserts the new SVG partition synchronously, the edit view shows its selection frame, and a
double-click opens the existing text editor. View mode exposes no creation gesture; product code decides when to
offer the command without importing DOM internals.

Image buttons can call `view.chooseImage()` for the built-in local file input or `view.insertImage(file, options)`
when a React, Vue, Web Component, or vanilla toolbar already owns a `File`/`Blob`. PNG, JPEG, GIF, and WebP are
recognized from their bytes rather than the filename or browser MIME. Files stay local; the default 5MB limit
keeps the insertion inside the standard 8MB undo budget and can be changed explicitly. While bytes are read the
view exposes `aria-busy="true"`; failures reject the promise and dispatch `webpptimageerror`. Double-clicking an
empty picture placeholder uses the same path and replaces that placeholder plus the image in one undo unit.

Table pickers call synchronous `view.insertTable(rows, cols, options?)`. An explicit `rect` is used as-is; without
one, the view replaces the selected empty content placeholder or computes a centered size from the grid. The result
is a native DrawingML table whose cells open in the existing text editor and whose final-cell `Tab` uses the existing
append-row path. The method returns the new stable element id, while view mode rejects creation.

Page navigators use the equivalent `AddSlide` seam shown above. The headless result identifies the new page;
each mounted edit or view surface switches with its existing `setSlide` method, so a toolbar never mutates DOM
or scans for generated ids. An edit surface draws empty layout placeholders only in its interaction layer and
double-click opens the existing text editor; view surfaces and exported/saved output contain no helper UI.

Reordering uses the adjacent `MoveSlide { id, at: { after } }` seam. Subscribe to `movedSlides`, then read the
final `session.editor.doc.slideOrder`; mounted view/edit canvases keep their stable `slideId` and only derived
page-number or relative-link partitions are refreshed. Framework adapters never need a shadow page-order model.

Deletion uses `session.editor.exec({ type: 'RemoveSlide', id })`. All mounted view/edit canvases showing that page
close active input and switch to the public `removedSlideFallbacks` target; canvases on surviving pages keep their
stable `slideId` and SVG root. A React, Vue, Svelte, Web Component, or vanilla navigator can consume the same map.
Disable the command when `session.editor.doc.slideOrder.length === 1`.

Duplication uses `DuplicateSlide { id }` and reports the new stable page through `createdSlides`. Existing canvases
stay on their current pages and preserve active input; a React/Vue/Svelte/Web Component adapter can switch or mount
another canvas explicitly with that returned id. The copy is inserted after its source; compose `MoveSlide` when the
user chooses another destination.

The interaction SVG draws one exact oriented bounding box for a single selection and the world-space AABB union
for a multi-selection. It adds eight resize handles and one rotation handle; their stroke and size stay constant
in screen pixels at every view zoom. Rotated/flipped elements and nested groups use the same transform order as
the core renderer.

Custom adapters can use the same pure coordinate seam without mounting another view:

```ts
import {
  elementFrameToSlidePoint, screenToSlidePoint,
  slideToElementFramePoint, slideToElementParentPoint,
} from '@web-ppt/editor';

const slidePoint = screenToSlidePoint(
  { x: event.clientX, y: event.clientY },
  { left: canvasRect.left, top: canvasRect.top, zoom: view.zoom },
);
const localPoint = slideToElementFramePoint(session.editor.doc, elementId, slidePoint);
const parentPoint = slideToElementParentPoint(session.editor.doc, elementId, slidePoint);
const origin = elementFrameToSlidePoint(session.editor.doc, elementId, { x: 0, y: 0 });
```

These functions are DOM-free and include every ancestor group's rotation, flip, child offset, and child scale.
Use `localPoint` for geometry and `parentPoint` for `x` / `y` movement.

Dragging an element selects and moves it in one gesture; dragging any member of a multi-selection preserves and
moves the whole selection. A 3-screen-pixel threshold separates clicks from moves. The view captures the primary
pointer, coalesces preview updates with `requestAnimationFrame`, and translates temporary SVG wrappers plus the
interaction overlay—no model, defs, or static element identity changes during the gesture. Pointer-up removes the
ghosts before committing one `SetXfrm` transaction. `Escape`, pointer cancellation/loss, page or mode changes,
and view destruction restore the original DOM without history. Nested rotated/flipped groups are converted into
each element's parent coordinate space.

Movement snaps within a six-screen-pixel threshold to the slide center/edges and direct siblings' edges/centers;
equal gaps are shown as paired bidirectional spacing arrows. Optional `snapMargins` add four host-defined slide
guides without guessing a document margin. Candidates are resolved independently per axis in stable priority
order, so overlapping choices do not jitter with element traversal order. Hold `Ctrl` to disable snapping during
the current gesture, or use `snapping: false` / `view.setSnapping(false)` for the whole view. Guides exist only in
the interaction SVG and every cancellation path removes them without changing the model.

The eight resize handles have a 4-screen-pixel outward hit margin. Corners resize both axes, edge handles resize
one axis, `Shift` preserves aspect ratio, and `Alt` keeps the center fixed; modifiers can be pressed or released
during the gesture. Crossing the opposite anchor normalizes positive dimensions, swaps the active handle without
a visual jump, and toggles `flipH` / `flipV`. Single rotated/flipped and nested elements keep the opposite anchor
fixed in their parent space; multi-selections resize from their shared world-space AABB. Preview frames reuse the
same pointer-capture/rAF lifecycle as movement and touch only temporary wrappers plus the interaction overlay.
Pointer-up commits every selected root in one undo unit.

The rotation handle has the same four-screen-pixel hit margin. A single selection converts pointer angles into
the element's parent space through its own flip and every rotated/flipped ancestor; a multi-selection rotates all
selected roots around the shared AABB center. Angles accumulate continuously across ±180°, `Shift` can snap to
15° at any point in the gesture, and a live value appears beside a single selection. Preview still touches only
ghost wrappers; pointer-up writes OOXML's 1/60000-degree value in one transaction, while every cancellation path
commits nothing.

`textMode: 'auto'` is the default. It reuses `viewer-core`'s runtime probe and switches affected Safari/iOS
engines to native SVG text when they fail to scale `foreignObject`. The out-of-SVG `contenteditable` then consumes
the same absolute engine line boxes from core. Explicit `html` and `svg` modes are also available. Soft wraps stay
out of the model while hard breaks, empty paragraphs, RTL, vertical text, columns, and math remain editable at
source UTF-16 positions. Full-slide renders, incremental patches, and the active editor use one text mode.

One session can mount several views (for example, the main canvas and a thumbnail). Destroying a view never
releases shared resources; disposing the session destroys every remaining view and is idempotent. React, Vue,
Svelte, Web Components, and plain DOM adapters all use the same `openEditor` / `mount` seam—none of their
runtimes are dependencies of this package.

The published entry measures 40.61 KB gzip. `@web-ppt/core`, `@web-ppt/edit-core`, and
`@web-ppt/viewer-core` are peer dependencies.

MIT
