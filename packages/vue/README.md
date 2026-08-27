# @web-ppt/vue

Thin Vue bindings for the framework-agnostic `@web-ppt/editor`. The component owns only a container and
lifecycle; parsing, preview, editing, history, and saving remain in the shared editor session.

```bash
npm i @web-ppt/core@next @web-ppt/edit-core@next @web-ppt/viewer-core@next @web-ppt/editor@next @web-ppt/vue@next vue
```

```vue
<script setup lang="ts">
import { ref } from 'vue';
import { WebPptEditor, type WebPptEditorHandle } from '@web-ppt/vue';
import { createIndexedDbRecoveryStore, type RecoveryCandidate } from '@web-ppt/editor';

const props = defineProps<{ file: File }>();
const editor = ref<WebPptEditorHandle>();
const mode = ref<'view' | 'edit'>('edit');
const slideId = ref<string>();
const recoveryStore = createIndexedDbRecoveryStore({ namespace: 'vue-deck' });
const decideRecovery = (candidate: RecoveryCandidate) => openRecoveryModal(candidate);
const save = async () => download(await editor.value!.save());

function download(bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes], {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'edited.pptx' });
  link.click();
  URL.revokeObjectURL(url);
}
</script>

<template>
  <button @click="mode = mode === 'edit' ? 'view' : 'edit'">{{ mode }}</button>
  <button @click="editor?.undo()">Undo</button>
  <button @click="save">Save</button>
  <WebPptEditor
    ref="editor"
    :source="props.file"
    :mode="mode"
    :slide-id="slideId"
    :zoom="1"
    :open-options="{ recovery: { store: recoveryStore } }"
    :on-recovery="decideRecovery"
    style="width: 100%; height: 600px"
    @view-change="slideId = $event.slideId ?? undefined"
    @error="console.error"
  />
</template>
```

`useWebPptAdapter(binding)` accepts a ref, computed value, getter, or plain controlled binding and returns
`{ container, adapter, snapshot }`. `snapshot` carries `status`, progress, errors, the active session/view,
mode, slide, and zoom. Changing `source` atomically opens the replacement and releases the old owned session.
The same snapshot includes `formatPainter`; toolbars call
`adapter.startFormatPainter({ continuous: true })` / `adapter.cancelFormatPainter()`. Vue observes the editor
session controller rather than creating another painter state machine.
Page-transition controls use the same adapter: `queryTransition()`, `setTransition(value)`, and
`previewTransition(value?)` need no Vue-owned playback state. Preview works in view and edit modes; mutation is
edit-only. `SlideTransitionInput` and `SlideTransitionState` are re-exported for typed controls.
Element-animation controls follow the same seam: `queryAnimations()`, `setAnimations(steps | null)`, and
`previewAnimations(draft?)`. Targets are stable `ElementId`s; preview automatically runs all click groups without
mutating the model or history. `EditAnimationStep` and `SlideAnimationState` are re-exported.
`snapshot.value.textSearch` is the same shared find/replace state. A product toolbar binds it without maintaining
another index:

```vue
<script setup lang="ts">
const { adapter, snapshot } = useWebPptAdapter(binding);
const setQuery = (event: Event) => adapter.value?.setTextSearchQuery(
  (event.target as HTMLInputElement).value,
);
</script>
<template>
  <form @submit.prevent="adapter?.nextTextSearch()">
    <input aria-label="Find" :value="snapshot.textSearch.query"
      @focus="adapter?.openTextSearch({ mode: 'find' })"
      @input="setQuery" />
    <span>{{ snapshot.textSearch.currentIndex + 1 }}/{{ snapshot.textSearch.matches.length }}</span>
    <button type="button" :disabled="!snapshot.textSearch.canReplace"
      @click="adapter?.replaceCurrentText()">Replace</button>
  </form>
</template>
```

Unmount releases listeners, focus, Blob URLs, views, and owned package bytes. The entry is SSR-safe and handles
conditional remounts without retaining an old view.

The optional selection pane consumes the same adapter and therefore owns no duplicate document state:

```vue
<script setup lang="ts">
const { adapter, container } = useWebPptAdapter(binding);
</script>
<template>
  <div ref="container" />
  <WebPptSelectionPane :adapter="adapter" aria-label="Objects" />
</template>
```

It follows the adapter's controlled slide and view/edit mode, exposes its DOM controller through a component ref,
and detaches without disposing an external session.

While a journal is awaiting a decision, `snapshot.status` is `recovering` and `snapshot.recovery` contains its
lightweight metadata. The `onRecovery` function prop returns `restore`, `discard`, or `cancel`; source hashing,
IndexedDB writes, compaction, replay, and cleanup remain in `@web-ppt/editor` rather than the Vue component.

To share one session between several Vue, React, Web Component, Svelte, or vanilla views, ownership is explicit:

```vue
<WebPptEditor :session="session" session-ownership="external" mode="edit" />
<WebPptEditor :session="session" session-ownership="external" mode="view" />
```

Those components destroy their views but never dispose the injected session; the caller must call
`session.dispose()`. A `source` session is owned and disposed by its adapter. Never pass both.

| Vanilla `@web-ppt/editor` | Vue |
|---|---|
| `createWebPptAdapter()` | `useWebPptAdapter()` |
| `adapter.attach(element)` | returned `container` ref |
| `adapter.attachSelectionPane(element)` | `<WebPptSelectionPane :adapter="adapter" />` |
| `adapter.setDocument(...)` | `source` or external `session` prop |
| `adapter.setView(...)` | controlled `mode`, `slideId`, `zoom`, `snapping` props |
| `adapter.subscribe(...)` | returned `snapshot` |
| `adapter.save/undo/redo()` | component ref or returned `adapter` |
| `adapter.startFormatPainter/cancelFormatPainter()` | returned `adapter` + `snapshot.formatPainter` |
| `adapter.openTextSearch/.../replaceAllText()` | returned `adapter` + `snapshot.textSearch` |
| `adapter.query/set/previewAnimations()` | returned `adapter`; no Vue playback state |
| `adapter.dispose()` | automatic on unmount |

Validated in Node SSR and Chromium with Vue 3.5.41; the optional peer range supports Vue 3.3–3.5. The
framework-excluded ESM is about 1KB gzip, ships declarations, and does not add Vue to the base packages.
