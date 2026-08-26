import React, { StrictMode, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { createApp, h, reactive } from 'vue';
import { openEditor } from '@web-ppt/editor';
import {
  WebPptEditor as ReactWebPptEditor, WebPptSelectionPane as ReactSelectionPane,
} from '@web-ppt/react';
import type {
  WebPptEditorHandle as ReactHandle, WebPptSelectionPaneHandle as ReactPaneHandle,
} from '@web-ppt/react';
import type { RecoveryStore, RecoveryStoreJournal } from '@web-ppt/editor';
import {
  WebPptEditor as VueWebPptEditor, WebPptSelectionPane as VueSelectionPane,
} from '@web-ppt/vue';
import type {
  WebPptEditorHandle as VueHandle, WebPptSelectionPaneHandle as VuePaneHandle,
} from '@web-ppt/vue';

const waitFor = async (predicate: () => boolean, label: string): Promise<void> => {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`${label} 超时`);
};

const mountPoint = (): HTMLDivElement => {
  const element = document.createElement('div');
  element.className = 'contract-offscreen';
  document.body.append(element);
  return element;
};

/** 真实框架运行时覆盖 StrictMode、受控更新、文件替换、共享 session 与 Vue 重挂载。 */
export async function runFrameworkAdaptersBrowserContract(
  load: (name: string) => Promise<ArrayBuffer>,
): Promise<{ reactReady: number; vueReady: number }> {
  const activeDownloads = new Set<string>();
  const download = async (bytes: Uint8Array, name: string): Promise<void> => {
    const url = URL.createObjectURL(new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }));
    activeDownloads.add(url);
    const link = Object.assign(document.createElement('a'), { href: url, download: name });
    document.body.append(link);
    link.click();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    link.remove();
    URL.revokeObjectURL(url);
    activeDownloads.delete(url);
  };
  const notes = await load('sample-editor-notes.pptx');
  const replacement = await load('sample-editor-add-slide.pptx');
  const reactMount = mountPoint();
  const reactRoot = createRoot(reactMount);
  const reactRef = createRef<ReactHandle>();
  const reactSessions: Array<NonNullable<ReactHandle['session']>> = [];
  let progress = 0;
  let changes = 0;
  let viewChanges = 0;
  let errors = 0;
  const reactProps = (source: ArrayBuffer, mode: 'view' | 'edit', zoom: number) => ({
    ref: reactRef, source, mode, zoom, textMode: 'svg' as const,
    openOptions: { idPrefix: 'react-adapter-' },
    onReady: (session: NonNullable<ReactHandle['session']>) => { reactSessions.push(session); },
    onProgress: () => { progress++; },
    onChange: () => { changes++; },
    onViewChange: () => { viewChanges++; },
    onError: () => { errors++; },
  });
  reactRoot.render(
    <StrictMode><ReactWebPptEditor {...reactProps(notes, 'view', 1.25)} /></StrictMode>,
  );
  await waitFor(() => reactRef.current?.session?.editor.doc.slideOrder.length === 4,
    'React StrictMode 打开');
  const firstSession = reactRef.current!.session!;
  if (reactMount.querySelectorAll('[data-web-ppt-editor]').length !== 1
    || reactRef.current!.view?.mode !== 'view' || reactRef.current!.view?.zoom !== 1.25
    || reactRef.current!.view?.setNotes('只读越权') !== false || firstSession.editor.isDirty()) {
    throw new Error('React StrictMode 初始视图、缩放或只读边界失败');
  }
  const secondSlide = firstSession.editor.doc.slideOrder[1];
  reactRoot.render(
    <StrictMode>
      <ReactWebPptEditor {...reactProps(notes, 'edit', 0.8)} slideId={secondSlide} />
    </StrictMode>,
  );
  await waitFor(() => reactRef.current?.view?.mode === 'edit'
    && reactRef.current.view.zoom === 0.8 && reactRef.current.view.slideId === secondSlide,
  'React 受控视图更新');
  reactRef.current!.view!.setNotes('React 编辑备注');
  if (changes < 1 || viewChanges < 1 || !firstSession.editor.isDirty()
    || reactRef.current!.undo() === null || firstSession.editor.isDirty()) {
    throw new Error('React change、受控页或撤销入口失败');
  }
  reactRef.current!.view!.setNotes('React 保存备注');
  const saved = await reactRef.current!.save();
  await download(saved, 'react-edited.pptx');
  if (!(saved instanceof Uint8Array) || saved.length === 0 || firstSession.editor.isDirty()) {
    throw new Error('React 保存入口失败');
  }
  reactRoot.render(
    <StrictMode><ReactWebPptEditor {...reactProps(replacement, 'edit', 1)} /></StrictMode>,
  );
  await waitFor(() => reactRef.current?.session !== firstSession
    && reactRef.current?.session?.editor.doc.slideOrder.length === 1, 'React 文件替换');
  if (!firstSession.disposed || reactMount.querySelectorAll('[data-web-ppt-editor]').length !== 1) {
    throw new Error('React 文件替换未释放旧 session 或产生重复视图');
  }
  const lastReactSession = reactRef.current!.session!;

  const recoveryRecords = new Map<string, RecoveryStoreJournal>();
  const recoveryStore: RecoveryStore = {
    async load(identity) {
      return structuredClone(recoveryRecords.get(identity.fingerprint) ?? null);
    },
    async reset(request) {
      if (request.signal?.aborted) throw request.signal.reason;
      const time = Date.now();
      recoveryRecords.set(request.source.fingerprint, {
        version: 1, source: structuredClone(request.source), idPrefix: request.idPrefix,
        epoch: request.epoch, createdAt: time, updatedAt: time, estimatedBytes: 0, frames: [],
      });
    },
    async append(request) {
      const current = recoveryRecords.get(request.source.fingerprint);
      if (!current || current.idPrefix !== request.idPrefix || current.epoch !== request.epoch) {
        throw new Error('恢复日志代际冲突');
      }
      const frames = [...current.frames, ...structuredClone(request.frames)];
      recoveryRecords.set(request.source.fingerprint, {
        version: 1, source: structuredClone(request.source), idPrefix: request.idPrefix,
        epoch: request.epoch, createdAt: current.createdAt,
        updatedAt: Math.max(current.updatedAt, frames[frames.length - 1].time),
        estimatedBytes: JSON.stringify(frames).length, frames,
      });
    },
    async remove(identity) {
      recoveryRecords.delete(identity.fingerprint);
    },
  };
  const recoverySeed = await openEditor(notes, {
    recovery: { store: recoveryStore, decide: () => 'restore' },
  });
  const recoverySlide = recoverySeed.editor.doc.slideOrder[0];
  recoverySeed.editor.exec({ type: 'SetNotes', id: recoverySlide, text: '跨框架恢复备注' });
  await recoverySeed.recovery!.flush();
  recoverySeed.dispose();

  const recoveryOpenOptions = {
    recovery: { store: recoveryStore, decide: () => 'discard' as const },
  };
  const reactRecoveryMount = mountPoint();
  const reactRecoveryRoot = createRoot(reactRecoveryMount);
  const reactRecoveryRef = createRef<ReactHandle>();
  let reactRecoveryPrompts = 0;
  reactRecoveryRoot.render(<ReactWebPptEditor ref={reactRecoveryRef} source={notes}
    openOptions={recoveryOpenOptions} onRecovery={() => {
      reactRecoveryPrompts++;
      return 'restore';
    }} />);
  await waitFor(() => reactRecoveryRef.current?.session?.editor.isDirty() === true,
    'React 恢复候选');
  if (reactRecoveryPrompts !== 1
    || reactRecoveryRef.current!.view!.queryNotes().value !== '跨框架恢复备注') {
    throw new Error('React 没有透传恢复决策或恢复模型');
  }
  const reactRecoverySession = reactRecoveryRef.current!.session!;
  reactRecoveryRoot.unmount();
  await waitFor(() => reactRecoverySession.disposed, 'React 恢复会话卸载');
  reactRecoveryMount.remove();

  const vueRecoveryMount = mountPoint();
  let vueRecoveryHandle: VueHandle | null = null;
  let vueRecoveryPrompts = 0;
  const vueRecoveryApp = createApp({
    setup: () => () => h(VueWebPptEditor, {
      ref: (value: unknown) => { vueRecoveryHandle = value as VueHandle | null; },
      source: notes, openOptions: recoveryOpenOptions,
      onRecovery: () => { vueRecoveryPrompts++; return 'restore'; },
    }),
  });
  vueRecoveryApp.mount(vueRecoveryMount);
  await waitFor(() => vueRecoveryHandle?.session?.editor.isDirty() === true,
    'Vue 恢复候选');
  if (vueRecoveryPrompts !== 1
    || vueRecoveryHandle!.view!.queryNotes().value !== '跨框架恢复备注') {
    throw new Error('Vue 没有透传恢复决策或恢复模型');
  }
  const vueRecoverySession = vueRecoveryHandle!.session!;
  vueRecoveryApp.unmount();
  if (!vueRecoverySession.disposed || vueRecoveryMount.childElementCount !== 0) {
    throw new Error('Vue 恢复会话卸载未释放资源');
  }
  vueRecoveryMount.remove();

  const external = await openEditor(notes, { idPrefix: 'framework-shared-' });
  const sharedReactMount = mountPoint();
  const sharedReactRoot = createRoot(sharedReactMount);
  const sharedReactRef = createRef<ReactHandle>();
  sharedReactRoot.render(
    <ReactWebPptEditor ref={sharedReactRef} session={external} sessionOwnership="external"
      mode="edit" textMode="svg" />,
  );

  const vueMount = mountPoint();
  const vueState = reactive({ mode: 'view' as 'view' | 'edit', zoom: 1 });
  let vueHandle: VueHandle | null = null;
  let vueReady = 0;
  const vueApp = createApp({
    setup: () => () => h(VueWebPptEditor, {
      ref: (value: unknown) => { vueHandle = value as VueHandle | null; },
      session: external, sessionOwnership: 'external', mode: vueState.mode,
      zoom: vueState.zoom, textMode: 'svg',
      onReady: () => { vueReady++; },
    }),
  });
  vueApp.mount(vueMount);
  await waitFor(() => !!sharedReactRef.current?.view && !!vueHandle?.view,
    'React/Vue 外部 session 双视图');
  const sharedReactPaneRef = createRef<ReactPaneHandle>();
  sharedReactRoot.render(<>
    <ReactWebPptEditor ref={sharedReactRef} session={external} sessionOwnership="external"
      mode="edit" textMode="svg" />
    <ReactSelectionPane ref={sharedReactPaneRef} adapter={sharedReactRef.current!.adapter} />
  </>);
  const vuePaneMount = mountPoint();
  let vuePaneHandle: VuePaneHandle | null = null;
  const vuePaneApp = createApp({
    setup: () => () => h(VueSelectionPane, {
      ref: (value: unknown) => { vuePaneHandle = value as VuePaneHandle | null; },
      adapter: vueHandle!.adapter,
    }),
  });
  vuePaneApp.mount(vuePaneMount);
  await waitFor(() => !!sharedReactPaneRef.current?.pane && !!vuePaneHandle?.pane,
    'React/Vue 选择窗格薄包装');
  if (sharedReactPaneRef.current!.pane!.mode !== 'edit' || vuePaneHandle!.pane!.mode !== 'view'
    || sharedReactMount.querySelectorAll('[role="treeitem"]').length === 0
    || vuePaneMount.querySelectorAll('[role="treeitem"]').length === 0) {
    throw new Error('React/Vue 选择窗格没有复用 adapter 的模式或目录');
  }
  sharedReactRef.current!.view!.setNotes('跨框架同步');
  if (vueHandle.view.queryNotes().value !== '跨框架同步'
    || vueHandle.view.setNotes('Vue 查看越权') !== false) {
    throw new Error('React/Vue 外部 session 同步或只读边界失败');
  }
  const painterSource = Object.values(external.editor.doc.elements)
    .find((record) => record.src.kind === 'shape' && record.meta.editable === 'full')!;
  external.editor.select({ kind: 'elements', ids: [painterSource.id], enteredGroup: null });
  if (!sharedReactRef.current!.adapter.startFormatPainter({ continuous: true })) {
    throw new Error('React adapter 没有启用共享会话格式刷');
  }
  await waitFor(() => vueHandle?.adapter.snapshot.formatPainter.active === true,
    'React/Vue 格式刷快照同步');
  if (sharedReactRef.current!.adapter.snapshot.formatPainter.source
      !== external.formatPainter.snapshot.source
    || vueHandle!.adapter.snapshot.formatPainter.source
      !== external.formatPainter.snapshot.source
    || vueHandle!.adapter.snapshot.formatPainter.readonly !== true
    || sharedReactRef.current!.view!.element.dataset.formatPainter !== 'continuous'
    || vueHandle!.view!.element.dataset.formatPainter !== 'continuous') {
    throw new Error('React/Vue 没有直接观察同一个会话格式刷状态机');
  }
  vueHandle!.adapter.cancelFormatPainter();
  if (sharedReactRef.current!.adapter.snapshot.formatPainter.active) {
    throw new Error('Vue adapter 取消没有同步到 React 视图');
  }
  vueState.mode = 'edit';
  vueState.zoom = 0.7;
  await waitFor(() => vueHandle?.view?.mode === 'edit' && vueHandle.view.zoom === 0.7,
    'Vue 受控模式更新');
  if (vuePaneHandle!.pane!.mode !== 'edit') throw new Error('Vue 选择窗格没有跟随受控模式');
  const notesBeforeVueEdit = vueHandle!.view!.queryNotes().value;
  vueHandle!.view!.setNotes('Vue 编辑备注');
  if (vueHandle!.undo() === null || vueHandle!.view!.queryNotes().value !== notesBeforeVueEdit) {
    throw new Error('Vue 编辑或撤销入口失败');
  }
  vueHandle!.view!.setNotes('Vue 保存备注');
  const vueSaved = await vueHandle!.save();
  await download(vueSaved, 'vue-edited.pptx');
  if (!(vueSaved instanceof Uint8Array) || vueSaved.length === 0 || external.editor.isDirty()) {
    throw new Error('Vue 保存下载入口失败');
  }
  vuePaneApp.unmount();
  vueApp.unmount();
  if (external.disposed || vueMount.childElementCount !== 0 || vuePaneMount.childElementCount !== 0) {
    throw new Error('Vue 卸载错误释放外部 session 或遗留 DOM');
  }
  vuePaneMount.remove();

  let remountedHandle: VueHandle | null = null;
  const remountedVue = createApp({
    setup: () => () => h(VueWebPptEditor, {
      ref: (value: unknown) => { remountedHandle = value as VueHandle | null; },
      session: external, sessionOwnership: 'external', mode: 'view', textMode: 'svg',
    }),
  });
  remountedVue.mount(vueMount);
  await waitFor(() => !!remountedHandle?.view, 'Vue 重挂载');
  remountedVue.unmount();
  sharedReactRoot.unmount();
  if (external.disposed || vueMount.childElementCount !== 0 || sharedReactMount.childElementCount !== 0) {
    throw new Error('跨框架重挂载/卸载所有权失败');
  }
  external.dispose();

  reactRoot.unmount();
  await waitFor(() => lastReactSession.disposed, 'React 卸载释放 session');
  if (reactMount.childElementCount !== 0 || errors !== 0 || progress < 2
    || activeDownloads.size !== 0
    || reactSessions.some((session) => !session.disposed)) {
    throw new Error('React StrictMode 卸载泄漏或事件失败');
  }
  reactMount.remove();
  sharedReactMount.remove();
  vueMount.remove();
  return { reactReady: reactSessions.length, vueReady };
}
