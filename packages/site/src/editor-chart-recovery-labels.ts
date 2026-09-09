import type { EditorSession, SlideEditor } from '@web-ppt/editor';
import { setText } from './i18n/runtime';

export function bindChartRecoveryLabels(session: EditorSession, view: SlideEditor): () => void {
  const layer = view.element.querySelector('[data-ppt-layer="static"]')!;
  const visited = new WeakSet<Element>();
  const pending = new WeakSet<Element>();
  let disposed = false;
  const sync = async () => {
    const candidates = [...layer.querySelectorAll<SVGElement>('[data-edit-root]')].filter(root => {
      const record = session.editor.doc.elements[root.dataset.editRoot!];
      const label = root.querySelector('text');
      return label && !visited.has(label) && !pending.has(label) && record?.meta.editable === 'frame' && record.src.kind === 'group'
        && session.editor.effectiveElement(record.id).kind === 'unsupported';
    });
    if (!candidates.length) return;
    const labels = candidates.map(root => root.querySelector('text')!);
    labels.forEach(label => pending.add(label));
    try {
      // 与打开服务使用同一入口；恢复文稿已经加载它，不再另取一份 SDK 薄适配。
      const chart = await import('@web-ppt/edit-core/chart-shared');
      if (disposed) return;
      for (const root of candidates) {
        if (!layer.contains(root)) continue;
        const id = root.dataset.editRoot!;
        // 只翻译已由 SDK 明确标记的失败占位，不把文稿文字或其他格式的预览当作产品词条。
        try {
          if (!chart.queryChartData(session.editor.doc, id).binding.unresolved) continue;
          const label = root.querySelector('text');
          if (label) { setText(label, '图表编辑未恢复'); visited.add(label); }
        } catch { /* 其他类型的原生框架仍保留自己的预览。 */ }
      }
    } finally { labels.forEach(label => pending.delete(label)); }
  };
  const refresh = () => { void sync().catch(() => {}); };
  const observer = new MutationObserver(refresh);
  observer.observe(layer, { childList: true, subtree: true });
  refresh();
  return () => { disposed = true; observer.disconnect(); };
}
