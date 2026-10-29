<div align="center">

# Web-PPT

**Open, present and edit PowerPoint — entirely in the browser.**

`.pptx` / `.ppt` → one JSON schema → SVG　·　no server　·　files never leave the tab

[![CI](https://github.com/unStone/web-ppt/actions/workflows/ci.yml/badge.svg)](https://github.com/unStone/web-ppt/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@web-ppt/core.svg)](https://www.npmjs.com/package/@web-ppt/core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/unStone/web-ppt/blob/master/LICENSE)

**[Live demo](https://unstone.github.io/web-ppt/)**　·　**[Online editor](https://unstone.github.io/web-ppt/editor.html)**　·　**[Sample gallery](https://unstone.github.io/web-ppt/samples.en.html)**　·　**[Docs](https://github.com/unStone/web-ppt/blob/master/docs/README.md)**

**English** · [简体中文](https://github.com/unStone/web-ppt/blob/master/README.md)

</div>

<br>

![Web-PPT presenting "Swiss Grid Systems": modular grid, Helvetica and a red anchor, with each slide's entrance animations](https://raw.githubusercontent.com/unStone/web-ppt/master/docs/demo-swiss.gif)

<p align="center"><sub>
<b>Swiss Grid Systems</b> · 14 slides · 664 elements · 91 groups, one entrance sequence per slide — the original sample file, rendered live in the browser by Web-PPT<br>
Sample by Hugo He · MIT · <a href="https://github.com/hugohe3/ppt-master/tree/a160e776b7faff5d2227d180d0f31c6253056fae/examples/ppt169_swiss_grid_systems">source</a> · <a href="https://unstone.github.io/web-ppt/samples.en.html?sample=swiss-grid-systems.pptx">open in the gallery</a>
</sub></p>

## Highlights

<table>
<tr>
<td width="33%" valign="top"><b>No server</b><br>Parsing and rendering happen in the current tab — no upload, no Office install, no conversion box</td>
<td width="33%" valign="top"><b>Animations kept</b><br>Transitions, entrance / exit effects and motion paths, revealed click batch by click batch</td>
<td width="33%" valign="top"><b>Old and new formats</b><br>Beyond <code>.pptx</code>, full support for the 1997–2003 binary <code>.ppt</code></td>
</tr>
<tr>
<td valign="top"><b>Portable output</b><br>A native <code>&lt;text&gt;</code> path exports standalone SVG and printable HTML that open anywhere, not just in a browser</td>
<td valign="top"><b>Full editing</b><br>Command history, incremental save, recovery and field-level collaboration</td>
<td valign="top"><b>Framework-free</b><br>Base packages use no framework and the core's only runtime dependency is fflate; React / Vue are optional thin adapters</td>
</tr>
</table>

## Real-world samples

None of these were made for the demo. Both come from the [sample gallery](https://unstone.github.io/web-ppt/samples.en.html); the recording script opens the original file through the same rendering path as the gallery page.

### Interactive courseware: EDDi welcome tutorial

The deck never uses "next slide" — 81 internal jump links form a button-driven navigation. Web-PPT keeps every link, so a click lands where the author intended (the red ring marks each recorded click).

![Web-PPT presenting the EDDi welcome tutorial: clicking JOIN, lesson buttons and items in the tools overview to jump between slides](https://raw.githubusercontent.com/unStone/web-ppt/master/docs/demo-eddi.gif)

<p align="center"><sub>
<b>EDDi welcome tutorial</b> · 29 slides · 604 elements · 301 original illustrations · 1040×720 canvas<br>
Presentation by Juliane Boenecke · illustrations by Annabell Koenen-Rindfrey · CC BY 4.0 · <a href="https://doi.org/10.5281/zenodo.8365637">source</a> · <a href="https://unstone.github.io/web-ppt/samples.en.html?sample=eddi-welcome-tutorial.pptx">open in the gallery</a>
</sub></p>

Both GIFs are recorded by `npm run demo-gif`; re-run it after an engine change and they are current again.

## Why this exists

| Approach | What it costs you |
|---|---|
| Office Online `iframe` | Requires the file to be **publicly reachable by URL** — unusable for confidential decks |
| Server-side conversion (LibreOffice / headless Office) | A conversion box to run and scale; animations and build steps are flattened |
| Convert to PDF or images up front | Same flattening, plus you lose text selection and search |
| Existing front-end libraries | Legacy `.ppt` unsupported; the most-used npm package [charges for source access](https://github.com/501351981/pptx-preview) |

Web-PPT keeps the file on the client, keeps the animations, and stays MIT all the way down — **including the 1997–2003 binary `.ppt` format**.

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

Editing is stable as of 0.5.0; install the whole stack from the same version:

```bash
npm i @web-ppt/core @web-ppt/edit-core @web-ppt/viewer-core @web-ppt/editor
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

| Capability | Docs |
|---|---|
| Picture / 3D effects | [appearance editing](https://github.com/unStone/web-ppt/blob/master/docs/api/appearance-editing.md) |
| Screen-reader canvas, EditContext, automatic ChartEx loading | [browser enhancements](https://github.com/unStone/web-ppt/blob/master/docs/api/browser-editing.md) |
| Comment panel and export opt-ins | [comments](https://github.com/unStone/web-ppt/blob/master/docs/api/comments.md) |
| Chart editing, SmartArt/OLE/ink, PDF/WebM and native PPT saving | [expanded capabilities](https://github.com/unStone/web-ppt/blob/master/docs/api/expanded-capabilities.md) |
| Experimental vector PDF | [scope and remaining validation](https://github.com/unStone/web-ppt/blob/master/docs/wayfinder/ppt-portability-fidelity/notes/vector-pdf-implementation.md) |

## Packages

| Package | Role | Depends on | Size (gzip) |
|---|---|---|---|
| [`@web-ppt/core`](https://github.com/unStone/web-ppt/tree/master/packages/core) | Parse / render / export. No framework, no DOM. | fflate | 136.05 KB |
| [`@web-ppt/edit-core`](https://github.com/unStone/web-ppt/tree/master/packages/edit-core) | Edit document, command history, projection and incremental save. No framework, no DOM. | `core`; lint uses Culori / RBush | 185.70 KB |
| [`@web-ppt/editor`](https://github.com/unStone/web-ppt/tree/master/packages/editor) | Editing session, native SVG selection and transforms, three-layer incremental DOM. | `core` + `edit-core` + `viewer-core` | 59.27 KB |
| [`@web-ppt/collab`](https://github.com/unStone/web-ppt/tree/master/packages/collab) | Optional field-level LWW collaboration and BroadcastChannel provider. | `edit-core` optional peer | 12.20 KB |
| [`@web-ppt/react`](https://github.com/unStone/web-ppt/tree/master/packages/react) | React component and hook. | `editor` + React optional peer | 1.12 KB |
| [`@web-ppt/vue`](https://github.com/unStone/web-ppt/tree/master/packages/vue) | Vue component and composable. | `editor` + Vue optional peer | 1.34 KB |
| [`@web-ppt/viewer-core`](https://github.com/unStone/web-ppt/tree/master/packages/viewer-core) | Navigation / zoom / search / animation batching. | `core` | 14.09 KB |
| [`@web-ppt/fonts`](https://github.com/unStone/web-ppt/tree/master/packages/fonts) | Font substitution and on-demand loading (zero font bytes in the package). | `core` | 3.44 KB |

Sizes sum the gzipped default entry and every relative static chunk, excluding peers and dynamic entries.

## Capabilities, performance and fidelity

| Area | Status |
|---|---|
| Format coverage | `.pptx` and `.ppt` cover 187 ECMA-376 presets, custom geometry, fills / strokes / effects, theme inheritance, tables, charts, media, groups, transitions, animations, notes, hyperlinks and encryption |
| Text rendering | `foreignObject` + HTML layout for screen preview; native `<text>` + own line breaking for standalone SVG and print, so exported files don't depend on a browser |
| Editing loop | Source values + overrides, command history, patch / generated save, recovery and collaboration; ordinary slides cannot mutate masters or layouts |
| Performance | 210 slides / 11,280 elements: **42 ms** lazy first paint, 376 ms full parse, 0.09 ms single-slide render, 40 MB JS heap |
| Regression | 212 render snapshots (30 test files × every slide × both text paths) compared byte for byte; `npm run compare` adds LibreOffice as ground truth |
| Main thread | Worker parsing blocks the main thread for zero time; images cross the boundary as `asset:N` tokens |

Full matrix: [format capabilities](https://github.com/unStone/web-ppt/blob/master/docs/api/format-capabilities.md); gaps and approximations: [format limitations](https://github.com/unStone/web-ppt/blob/master/docs/api/format-limitations.md); methodology: [performance and fidelity benchmarks](https://github.com/unStone/web-ppt/blob/master/docs/engineering/performance.md) (docs are currently maintained in Chinese).

## Architecture

![Web-PPT architecture: .pptx, .ppt, metafile and chart XML parsers converge on one schema; render/ draws it through the HTML-layout and native-text paths, while edit-core layers overrides on read-only source values, projects back into render/ and saves](https://raw.githubusercontent.com/unStone/web-ppt/master/docs/architecture.en.svg)

Every parsing pipeline converges on one schema, and the renderer knows the schema, never a file format; the editor layers overrides on read-only source values and projects back into the same renderer. See [architecture overview](https://github.com/unStone/web-ppt/blob/master/docs/engineering/architecture.md) and [architecture rules](https://github.com/unStone/web-ppt/blob/master/docs/engineering/architecture-rules.md).

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Start the viewer (`?file=/showcase.pptx` to pick a file) |
| `npm run dev:site` | Start the site (includes the in-browser live demo) |
| `npm run check` | TypeScript type check |
| `npm test` | Every test suite |
| `npm run build` | Build all eight publishable packages (core / edit-core / viewer-core / editor / react / vue / fonts / collab) |
| `npm run verify` | License / version / links / documented numbers against measured values |
| `npm run demo-gif` | Re-record the README demo GIFs from the sample gallery (needs Chrome and ffmpeg) |

Per-suite commands and assertion counts: [testing guide](https://github.com/unStone/web-ppt/blob/master/docs/engineering/testing.md); commands and debug pages: [development guide](https://github.com/unStone/web-ppt/blob/master/docs/engineering/development.md); conventions and known traps: [AGENTS.md](https://github.com/unStone/web-ppt/blob/master/AGENTS.md); full reading order: [documentation map](https://github.com/unStone/web-ppt/blob/master/docs/README.md).

## Community

| Channel | Where |
|---|---|
| Bugs / feature requests | [GitHub Issues](https://github.com/unStone/web-ppt/issues) |
| Discussion | [GitHub Discussions](https://github.com/unStone/web-ppt/discussions) |
| WeChat group (Chinese) | [QR code in the pinned issue](https://github.com/unStone/web-ppt/issues?q=is%3Aissue+label%3A%E4%BA%A4%E6%B5%81%E7%BE%A4) |

## License

[MIT](https://github.com/unStone/web-ppt/blob/master/LICENSE)

The demo GIFs in this README are recorded from third-party samples; copyright and license remain with their authors, as credited under each image.
