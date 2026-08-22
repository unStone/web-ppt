# @web-ppt/viewer-core

**English** · [简体中文](https://github.com/unStone/web-ppt/blob/master/packages/viewer-core/README.zh-CN.md)

The headless layer of [Web-PPT](https://github.com/unStone/web-ppt).

`PresentationState` is a pure state machine with zero DOM — navigation, zoom, search, animation batching, auto-advance. Drive it from plain DOM, React, Vue or Svelte, or run it straight in Node for tests. `Viewer` is the thinnest possible DOM binding on top (inject SVG, set visibility, kick off playback — about 24 lines).

```bash
npm i @web-ppt/core @web-ppt/viewer-core
```

## Batteries included

```ts
import { parse } from '@web-ppt/core';
import { Viewer } from '@web-ppt/viewer-core';

const pres = await parse(file);
const v = new Viewer(container, pres, { animate: true, autoAdvance: true });

v.next();              // plays a pending animation batch, otherwise advances the slide
v.finishAnimations();  // jump to this slide's end state
v.setZoom(1.5);
v.search('keyword');   // → array of matching slide indices
await v.exportPng(2);  // → Blob
```

## Bring your own UI

```ts
import { PresentationState, playGroup, playTransition } from '@web-ppt/viewer-core';

const st = new PresentationState(pres, { skipHidden: true, animate: true });

st.subscribe((change) => {
  if (change.type === 'slide') {
    render(change.index);
    if (change.transition) playTransition(prevEl, nextEl, change.transition);
  } else if (change.type === 'animation' && change.group) {
    playGroup(container, change.group);
  }
});

st.next();
st.hiddenElementIds;   // element ids that should be hidden at the current batch
st.resolveLink(href);  // 'slide:3' → 2, external links → null
```

The state machine only decides *what should be visible*; the UI layer performs the actual playback through `playGroup` / `playTransition` — so switching frameworks rewrites no logic.

MIT
