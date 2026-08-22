# @web-ppt/fonts

**English** · [简体中文](https://github.com/unStone/web-ppt/blob/master/packages/fonts/README.zh-CN.md)

The fonts a deck asks for usually aren't installed on the machine viewing it. This package swaps in a **free substitute that downloads on demand**, so the text still lays out close to the original.

There is **not one byte of font data in the package** (2.8 KB gzip). Slices point at already-published [fontsource](https://fontsource.org/) versions served by jsDelivr; nothing downloads until it's actually rendered.

```bash
npm i @web-ppt/fonts
```

## Usage

```ts
import { collectFonts } from '@web-ppt/core';
import { loadFontsFor } from '@web-ppt/fonts';

// Only the current slide: fill in on navigation, and slices already fetched are free
const usages = collectFonts([pres.slides[viewer.index]]);
await loadFontsFor(usages);
viewer.refresh(); // layout is synchronous, loading is async — the first frame always breaks on the fallback
```

`loadFontsFor` does three things, none of them optional:

| Step | Why |
|---|---|
| Skip families already installed locally | Zero download beats every loading strategy |
| Fetch the substitute's `@font-face` and **rewrite the family name to the original's** | The slide says "Calibri". CSS has no aliasing mechanism, so the only way that text picks up the substitute is for the `@font-face` to carry that exact name |
| Prepend `local()` to `src` | A same-named `@font-face` **shadows** the system font. Without this line, people who *do* have the original get dragged into downloading a substitute instead |

On-demand loading is left entirely to `unicode-range` — fontsource's CSS ships the slice boundaries, and the browser fetches only the slices it actually renders.

## Substitution table

**Every Latin entry is metric-compatible**: each character's advance width matches the original exactly, so line breaks land where PowerPoint puts them. This is the same set LibreOffice uses.

| Font in the deck | Substitute | Metric-compatible |
|---|---|---|
| Calibri | Carlito | ✓ |
| Cambria | Caladea | ✓ |
| Arial / Helvetica | Arimo | ✓ |
| Times New Roman | Tinos | ✓ |
| Courier New | Cousine | ✓ |
| Segoe UI / Tahoma / Verdana | Open Sans | ✗ similar shapes only |

Chinese: Microsoft YaHei / PingFang / SimHei / DengXian → Noto Sans SC, the SimSun family → Noto Serif SC, KaiTi → LXGW WenKai.

Only **redistributable, subsettable** fonts are included (OFL / Apache). MiSans, HarmonyOS Sans and Alibaba PuHuiTi are "free for commercial use" but each restricts redistribution and modification, so they stay out of the built-in table — add them yourself through `overrides`:

```ts
await loadFontsFor(usages, {
  overrides: { 思源黑体: { family: 'Noto Sans SC', metricCompatible: false, cjk: true } },
});
```

## Know what CJK costs

CJK is substituted by default — the usage you pass in should all get handled, and silently dropping half of it would be the surprising behaviour. But the two sides have very different economics:

| | Latin | CJK |
|---|---|---|
| Cost for one slide | ~30 KB (one slice) | **553 KB** (22 distinct hanzi spread across 18 slices) |
| What you get | Metric compatibility; breaks match PowerPoint | A different glyph shape — hanzi are monospaced full-width, so breaks wouldn't move anyway |
| Cost of not doing it | Different advance widths, every line ending wrong | The system CJK font catches it and looks fine |

A slice is ~30 KB and holds ~160 codepoints; using one character out of it still costs the whole slice. A full Chinese deck converges around 1 MB. **Marginal cost is per slice, not per character** — "it only uses 22 hanzi" is the worst case, not the best.

Bandwidth-sensitive contexts can turn it off, or make it a user setting (which is what the project's own site does):

```ts
await loadFontsFor(usages, { cjk: false });

// When the user turns it off mid-session, withdraw the injected declarations and re-render.
// Only the declarations go — the downloaded bytes stay in the HTTP cache, so turning it back on is free
unloadFonts({ cjkOnly: true });
viewer.refresh();
```

## Self-hosting

Don't want to depend on jsDelivr? Point at your own base; the directory layout matches fontsource's npm packages:

```ts
await loadFontsFor(usages, { base: 'https://cdn.example.com/npm' });
```

## The other half: exports

An SVG loaded through `<img>` is an isolated document and can't see fonts registered on the page. Exporting to PNG or standalone SVG means inlining the slices you hit — the character sets `collectFonts` returns exist for exactly this.

## License

MIT. The substitute fonts remain under their own licenses (OFL-1.1 / Apache-2.0); this package distributes no font files.
