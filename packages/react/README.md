# @web-ppt/react

Thin React bindings for the framework-agnostic `@web-ppt/editor`. The component owns only a container and
lifecycle; parsing, preview, editing, history, and saving remain in the shared editor session.

```bash
npm i @web-ppt/core @web-ppt/edit-core @web-ppt/viewer-core @web-ppt/editor @web-ppt/react react
```

```tsx
import { useRef, useState } from 'react';
import { WebPptEditor, type WebPptEditorHandle } from '@web-ppt/react';
import { createIndexedDbRecoveryStore } from '@web-ppt/editor';

const recoveryStore = createIndexedDbRecoveryStore({ namespace: 'react-deck' });

export function Deck({ file }: { file: File }) {
  const editor = useRef<WebPptEditorHandle>(null);
  const [mode, setMode] = useState<'view' | 'edit'>('edit');
  const [slideId, setSlideId] = useState<string>();

  return <>
    <button onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}>{mode}</button>
    <button onClick={() => editor.current?.undo()}>Undo</button>
    <button onClick={async () => download(await editor.current!.save())}>Save</button>
    <WebPptEditor
      ref={editor}
      source={file}
      mode={mode}
      slideId={slideId}
      zoom={1}
      openOptions={{ recovery: { store: recoveryStore } }}
      onRecovery={(candidate) => openRecoveryModal(candidate)}
      onViewChange={(state) => setSlideId(state.slideId ?? undefined)}
      onError={console.error}
      style={{ width: '100%', height: 600 }}
    />
  </>;
}

function download(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'edited.pptx' });
  link.click();
  URL.revokeObjectURL(url);
}
```

`useWebPptAdapter(binding)` exposes the same controlled contract without the component. It returns
`{ containerRef, adapter, snapshot }`; `snapshot` carries `status`, progress, errors, the active session/view,
mode, slide, and zoom. Changing `source` atomically opens the replacement and releases the old owned session.
The same snapshot includes `formatPainter`; call `adapter.startFormatPainter({ continuous: true })` or
`adapter.cancelFormatPainter()` from a toolbar. React only observes the editor session controller and does not
create another painter state machine.
Page-transition controls follow the same seam: `adapter.queryTransition()`, `adapter.setTransition(value)`, and
`adapter.previewTransition(value?)` work in a product toolbar without React-owned playback state. Preview is
available in view and edit modes; mutation remains edit-only. `SlideTransitionInput` and `SlideTransitionState`
are re-exported for typed controls.
Element-animation controls use the same adapter: `queryAnimations()`, `setAnimations(steps | null)`, and
`previewAnimations(draft?)`. Targets are stable `ElementId`s; preview automatically runs every click group and
does not mutate the model or history. `EditAnimationStep` and `SlideAnimationState` are re-exported.
`snapshot.textSearch` follows the same rule: render its query, match count, current match, invalidation flag, and
`canReplace` directly, then call adapter actions from the toolbar:

```tsx
const { adapter, snapshot } = useWebPptAdapter(binding);
return <form onSubmit={(event) => { event.preventDefault(); adapter?.nextTextSearch(); }}>
  <input
    aria-label="Find"
    value={snapshot.textSearch.query}
    onChange={(event) => adapter?.setTextSearchQuery(event.target.value)}
    onFocus={() => adapter?.openTextSearch({ mode: 'find' })}
  />
  <span>{snapshot.textSearch.currentIndex + 1}/{snapshot.textSearch.matches.length}</span>
  <button type="button" disabled={!snapshot.textSearch.canReplace}
    onClick={() => adapter?.replaceCurrentText()}>Replace</button>
</form>;
```

Unmount releases listeners, focus, Blob URLs, views, and owned package bytes. The entry is SSR-safe, including
React StrictMode's development setup/cleanup/setup cycle.

The optional selection pane reuses that adapter; it does not maintain another document or selection:

```tsx
const { adapter, containerRef } = useWebPptAdapter(binding);
return <div className="deck">
  <div ref={containerRef} />
  <WebPptSelectionPane adapter={adapter} aria-label="Objects" />
</div>;
```

`WebPptSelectionPane` follows controlled slide and view/edit mode changes, exposes its DOM controller through a
ref, and detaches without disposing an external session.

While a journal is awaiting a decision, `snapshot.status` is `recovering` and `snapshot.recovery` contains its
lightweight metadata. `onRecovery` may return `restore`, `discard`, or `cancel`; source hashing, IndexedDB writes,
compaction, replay, and cleanup remain in `@web-ppt/editor` rather than the React component.

To share one session between several React, Vue, Web Component, Svelte, or vanilla views, ownership is explicit:

```tsx
<WebPptEditor session={session} sessionOwnership="external" mode="edit" />
<WebPptEditor session={session} sessionOwnership="external" mode="view" />
```

Those components destroy their views but never dispose the injected session; the caller must call
`session.dispose()`. A `source` session is owned and disposed by its adapter. Never pass both.

| Vanilla `@web-ppt/editor` | React |
|---|---|
| `createWebPptAdapter()` | `useWebPptAdapter()` |
| `adapter.attach(element)` | returned `containerRef` |
| `adapter.attachSelectionPane(element)` | `<WebPptSelectionPane adapter={adapter} />` |
| `adapter.setDocument(...)` | `source` or external `session` prop |
| `adapter.setView(...)` | controlled `mode`, `slideId`, `zoom`, `snapping` props |
| `adapter.subscribe(...)` | returned `snapshot` |
| `adapter.save/undo/redo()` | component ref or returned `adapter` |
| `adapter.startFormatPainter/cancelFormatPainter()` | returned `adapter` + `snapshot.formatPainter` |
| `adapter.openTextSearch/.../replaceAllText()` | returned `adapter` + `snapshot.textSearch` |
| `adapter.query/set/previewAnimations()` | returned `adapter`; no React playback state |
| `adapter.dispose()` | automatic on unmount |

Validated in Node SSR and Chromium with React 19.2.8; the optional peer range supports React 18.2–19. The
framework-excluded ESM is under 1KB gzip, ships declarations, and does not add React to the base packages.
