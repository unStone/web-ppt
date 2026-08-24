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

view.setMode('view');       // same static preview DOM; interaction layers are hidden
view.setMode('edit');
view.setSlide(slideId);
view.setZoom(1.5);
view.setSnapping(false);   // can be changed without remounting

const bytes = await session.editor.save();
view.destroy();             // destroys only this mounted view
session.dispose();          // destroys remaining views and releases ZIP bytes / blob URLs
```

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

`Ctrl/Cmd+Z` undoes; `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` redoes. If the restored selection belongs to another
slide, only the edit view that received the shortcut reveals that slide; other shared views stay put. Active
pointer previews and regular or Shadow DOM text controls retain keyboard ownership, while single-element history
still replaces only that element's DOM partition.

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
engines to native SVG text when they fail to scale `foreignObject`; explicit `html` and `svg` modes are also
available. Full-slide renders and incremental element patches always use the same text mode.

One session can mount several views (for example, the main canvas and a thumbnail). Destroying a view never
releases shared resources; disposing the session destroys every remaining view and is idempotent. React, Vue,
Svelte, Web Components, and plain DOM adapters all use the same `openEditor` / `mount` seam—none of their
runtimes are dependencies of this package.

The published entry is measured during the repository build. `@web-ppt/core`, `@web-ppt/edit-core`, and
`@web-ppt/viewer-core` are peer dependencies.

MIT
