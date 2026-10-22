# Web-PPT

[![CI](https://github.com/unStone/web-ppt/actions/workflows/ci.yml/badge.svg)](https://github.com/unStone/web-ppt/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@web-ppt/core.svg)](https://www.npmjs.com/package/@web-ppt/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/unStone/web-ppt/blob/master/LICENSE)

**English** · [简体中文](https://github.com/unStone/web-ppt/blob/master/README.md)

A PowerPoint rendering and editing engine that runs entirely in the browser: `.pptx` / `.ppt` → one JSON schema → SVG.

No server, no Office install, no upload. Base packages are framework-free; React and Vue live only in optional adapter packages. Files never leave the tab, and the core runtime's only dependency is [fflate](https://github.com/101arrowz/fflate).

**[▶ Live demo](https://unstone.github.io/web-ppt/)** · **[✎ Online editor](https://unstone.github.io/web-ppt/editor.html)**

![Web-PPT rendering showcase.pptx](https://raw.githubusercontent.com/unStone/web-ppt/master/docs/demo.gif)

*Recorded by `npm run demo-gif` from `fixtures/showcase.pptx` in this repo.*

## Why this exists

| Approach | What it costs you |
|---|---|
| Office Online `iframe` | Requires the file to be **publicly reachable by URL** — unusable for confidential decks |
| Server-side conversion (LibreOffice / headless Office) | A conversion box to run and scale; animations and build steps are flattened |
| Convert to PDF or images up front | Same flattening, plus you lose text selection and search |
| Existing front-end libraries | Legacy `.ppt` unsupported; the most-used npm package [charges for source access](https://github.com/501351981/pptx-preview) |

Web-PPT keeps the file on the client, keeps the animations, and stays MIT all the way down — **including the 1997–2003 binary `.ppt` format**.

## Packages

| Package | Role | Depends on | Size (gzip) |
|---|---|---|---|
| [`@web-ppt/core`](https://github.com/unStone/web-ppt/tree/master/packages/core) | Parse / render / export. No framework, no DOM. | fflate | 134.43 KB |
| [`@web-ppt/edit-core`](https://github.com/unStone/web-ppt/tree/master/packages/edit-core) | Edit document, command history, projection and incremental save. No framework, no DOM. | `core`; lint uses Culori / RBush | 185.70 KB |
| [`@web-ppt/editor`](https://github.com/unStone/web-ppt/tree/master/packages/editor) | Editing session, native SVG selection and transforms, three-layer incremental DOM. | `core` + `edit-core` + `viewer-core` | 59.27 KB |
| [`@web-ppt/collab`](https://github.com/unStone/web-ppt/tree/master/packages/collab) | Optional field-level LWW collaboration and BroadcastChannel provider. | `edit-core` optional peer | 12.20 KB |
| [`@web-ppt/react`](https://github.com/unStone/web-ppt/tree/master/packages/react) | React component and hook. | `editor` + React optional peer | 1.12 KB |
| [`@web-ppt/vue`](https://github.com/unStone/web-ppt/tree/master/packages/vue) | Vue component and composable. | `editor` + Vue optional peer | 1.34 KB |
| [`@web-ppt/viewer-core`](https://github.com/unStone/web-ppt/tree/master/packages/viewer-core) | Navigation / zoom / search / animation batching. | `core` | 13.77 KB |
| [`@web-ppt/fonts`](https://github.com/unStone/web-ppt/tree/master/packages/fonts) | Font substitution and on-demand loading (zero font bytes in the package). | `core` | 2.69 KB |

Sizes sum the gzipped default entry and every relative static chunk, excluding peers and dynamic entries.

## Quick start

### View and export

```bash
npm i @web-ppt/core @web-ppt/viewer-core
```

```ts
import { parse, slideToSvgFile } from '@web-ppt/core';
import { Viewer } from '@web-ppt/viewer-core';

const pres = await parse(file);                      // File | Blob | ArrayBuffer | Uint8Array
const viewer = new Viewer(container, pres, { animate: true });
viewer.next();                                       // play a pending batch, else advance
viewer.search('keyword');
await viewer.exportPng(2);                           // → Blob

const svg = await slideToSvgFile(pres, pres.slides[0]);
```

Image ZIP, printable HTML, Worker parsing, media playback and driving `PresentationState` directly: [Viewer and rendering](https://github.com/unStone/web-ppt/blob/master/docs/api/viewer.md).

### Edit

Editing is on the beta line; install the whole stack from the same `next` version:

```bash
npm i @web-ppt/core@next @web-ppt/edit-core@next @web-ppt/viewer-core@next @web-ppt/editor@next
```

```ts
import { openEditor } from '@web-ppt/editor';

const session = await openEditor(file);
const view = session.mount(container, { mode: 'edit', zoom: 1 });
const slideId = session.editor.doc.slideOrder[0];
session.editor.exec({ type: 'SetXfrm', id: session.editor.doc.slides[slideId].children[0], x: 120 });
session.dispose();
```

Templates, design canvas, selection pane, shortcuts and clipboard, low-level `EditDoc`, preset handles and save paths: [Editor integration](https://github.com/unStone/web-ppt/blob/master/docs/api/editor.md).

The 0.7 template journey (`npm run test:v07`) covers template → theme → master → layout → ordinary slide → reopen; details are in [Editor integration](https://github.com/unStone/web-ppt/blob/master/docs/api/editor.md).

### Optional entries

- Picture / 3D effects: [appearance editing](https://github.com/unStone/web-ppt/blob/master/docs/api/appearance-editing.md)
- Screen-reader canvas, EditContext, automatic ChartEx loading: [browser enhancements](https://github.com/unStone/web-ppt/blob/master/docs/api/browser-editing.md)
- Comment panel and export opt-ins: [comments](https://github.com/unStone/web-ppt/blob/master/docs/api/comments.md)
- Chart editing, SmartArt/OLE/ink, PDF/WebM and native PPT saving: [expanded capabilities](https://github.com/unStone/web-ppt/blob/master/docs/api/expanded-capabilities.md)
- Experimental vector PDF: [scope and remaining validation](https://github.com/unStone/web-ppt/blob/master/docs/wayfinder/ppt-portability-fidelity/notes/vector-pdf-implementation.md)

## Capabilities and boundaries

- `.pptx` and `.ppt` cover 187 ECMA-376 presets, custom geometry, fills / strokes / effects, theme inheritance, tables, charts, media, groups, transitions, animations, notes, hyperlinks and encryption.
- Two text rendering paths: `foreignObject` + HTML layout for screen preview; native `<text>` + own line breaking for standalone SVG and print, so exported files don't depend on a browser.
- The editing loop is built on source values + overrides, command history, patch / generated save, recovery and collaboration; ordinary slides cannot mutate masters or layouts.

Full matrix: [format capabilities](https://github.com/unStone/web-ppt/blob/master/docs/api/format-capabilities.md); optional entries: [expanded capabilities](https://github.com/unStone/web-ppt/blob/master/docs/api/expanded-capabilities.md); gaps and approximations: [format limitations](https://github.com/unStone/web-ppt/blob/master/docs/api/format-limitations.md).

## Performance and fidelity

- 210 slides / 11,280 elements: **42 ms** lazy first paint, 376 ms full parse, 0.09 ms single-slide render, 40 MB JS heap.
- 210 render snapshots (29 test files × every slide × both text paths) are compared byte for byte; `npm run compare` adds LibreOffice as ground truth.
- Worker parsing blocks the main thread for zero time; images cross the boundary as `asset:N` tokens.

Details: [performance and fidelity benchmarks](https://github.com/unStone/web-ppt/blob/master/docs/engineering/performance.md) (docs are currently maintained in Chinese).

## Architecture

`.pptx`, `.ppt`, EMF/WMF and chart XML converge on one schema, and `render/` emits SVG; the editor layers overrides, history and incremental three-layer views on `EditDoc`. See [architecture overview](https://github.com/unStone/web-ppt/blob/master/docs/engineering/architecture.md) and [architecture rules](https://github.com/unStone/web-ppt/blob/master/docs/engineering/architecture-rules.md).

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Start the viewer (`?file=/showcase.pptx` to pick a file) |
| `npm run dev:site` | Start the site (includes the in-browser live demo) |
| `npm run check` | TypeScript type check |
| `npm test` | Every test suite |
| `npm run build` | Build all eight publishable packages (core / edit-core / viewer-core / editor / react / vue / fonts / collab) |
| `npm run verify` | License / version / links / documented numbers against measured values |

Per-suite commands and assertion counts: [testing guide](https://github.com/unStone/web-ppt/blob/master/docs/engineering/testing.md); commands and debug pages: [development guide](https://github.com/unStone/web-ppt/blob/master/docs/engineering/development.md); conventions and known traps: [AGENTS.md](https://github.com/unStone/web-ppt/blob/master/AGENTS.md); full reading order: [documentation map](https://github.com/unStone/web-ppt/blob/master/docs/README.md).

## Community

| Channel | Where |
|---|---|
| Bugs / feature requests | [GitHub Issues](https://github.com/unStone/web-ppt/issues) |
| Discussion | [GitHub Discussions](https://github.com/unStone/web-ppt/discussions) |
| WeChat group (Chinese) | [QR code in the pinned issue](https://github.com/unStone/web-ppt/issues?q=is%3Aissue+label%3A%E4%BA%A4%E6%B5%81%E7%BE%A4) |

## License

[MIT](https://github.com/unStone/web-ppt/blob/master/LICENSE)
