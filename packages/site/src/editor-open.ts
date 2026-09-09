import { prepareAdvancedRendering } from '@web-ppt/core/advanced-rendering';
import { prepareModernCharts } from '@web-ppt/core/modern-charts';
import { openEditor } from '@web-ppt/editor';
import type { SiteRecovery } from './editor-recovery';
import type { DocumentModules } from './editor-document-plugins';
import { languageReady } from './i18n/runtime';

function assertOpenActive(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException('打开已取消', 'AbortError');
}

export async function prepareEditorDocument(source: File | Blob | ArrayBuffer | Uint8Array,
  recovery: SiteRecovery, signal: AbortSignal) {
  await languageReady;
  const bytes = source instanceof Blob ? await source.arrayBuffer() : source;
  await Promise.all([prepareModernCharts(bytes), prepareAdvancedRendering(bytes)]);
  assertOpenActive(signal);
  const [adjustments, accessibility, inputEnhancement] = await Promise.all([
    import('@web-ppt/editor/adjustments'),
    import('@web-ppt/editor/accessibility').catch(() => undefined),
    'EditContext' in window ? import('@web-ppt/editor/edit-context').catch(() => undefined) : undefined,
  ]);
  assertOpenActive(signal);
  const session = await openEditor(source, {...recovery.openOptions(signal),embeddedFonts:'source'});
  try {
    assertOpenActive(signal);
    const doc = session.editor.doc;
    const elements = Object.values(doc.elements);
    const has = (name: string) => elements.some(record => record.ovr.extensions?.[name] !== undefined);
    if (Object.values(doc.slides).some(record => record.ovr.extensions?.comments !== undefined)) {
      const { registerCommentEditing } = await import('@web-ppt/edit-core/comments');
      registerCommentEditing();
    }
    if (has('appearance')) {
      const { registerAppearanceEditing } = await import('@web-ppt/edit-core/appearance');
      registerAppearanceEditing();
    }
    // 旧覆盖可能已经随复制形成共享关系；首次挂载前迁移，不能等检查器打开后才恢复画面。
    if (has('chart-data') || doc.extensions?.['chart-shared'] !== undefined) {
      const { registerSharedChartEditing } = await import('@web-ppt/edit-core/chart-shared');
      registerSharedChartEditing();
    }
    if (has('chart-design')) await import('@web-ppt/edit-core/chart-design');
    if (has('chart-ex-data')) await import('@web-ppt/edit-core/chart-ex');
    if (has('ink')) await import('@web-ppt/edit-core/ink');
    if (has('ole')) await import('@web-ppt/edit-core/ole');
    if (has('smartart')) await import('@web-ppt/edit-core/smartart');
    assertOpenActive(signal);
    const modules: DocumentModules = { adjustments, accessibility, inputEnhancement };
    return { session, modules };
  } catch (error) {
    // 恢复后加载任一扩展失败或被取代，尚未交给产品插件的会话也必须释放。
    session.dispose();
    throw error;
  }
}
