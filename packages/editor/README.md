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
const view = session.mount(container, { mode: 'edit', zoom: 1, textMode: 'auto' });

const slideId = session.editor.doc.slideOrder[0];
const elementId = session.editor.doc.slides[slideId].children[0];
session.editor.exec({ type: 'SetXfrm', id: elementId, x: 120 });

view.setMode('view');       // same static preview DOM; interaction layers are hidden
view.setMode('edit');
view.setSlide(slideId);
view.setZoom(1.5);

const bytes = await session.editor.save();
view.destroy();             // destroys only this mounted view
session.dispose();          // destroys remaining views and releases ZIP bytes / blob URLs
```

`SlideEditor` owns three stacked layers: the existing SVG preview, an SVG interaction overlay, and an HTML
text overlay. A headless `Editor` transaction replaces only the dirty element's markup and defs partition;
unchanged sibling DOM nodes keep their identity. If more than 30% of the slide's top-level elements are dirty,
the view falls back to one full render. Stable `data-edit-id` values are assigned to top-level and nested group
nodes, so DOM hit testing never depends on part-local OOXML ids.

In edit mode, pointer selection uses the browser's native SVG hit testing. A click inside a group selects its
outermost group; double-click enters one group level and `Escape` leaves one level. `Alt`+click cycles through
overlapping candidates in `elementsFromPoint` z-order. Locked, user-hidden, and non-editable branches are
skipped. View mode does not intercept pointer events or mutate the shared headless selection. Selection changes
replace only the interaction overlay, leaving the static preview DOM untouched.

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
Use `localPoint` for geometry and `parentPoint` for `x` / `y` movement. The visual handles intentionally do not
bind drag gestures yet.

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
