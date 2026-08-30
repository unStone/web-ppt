import { recordPerformanceBudget } from './browser-performance-contract.mjs';

const p95 = (samples) => {
  samples.sort((left, right) => left - right);
  return samples[Math.floor(samples.length * 0.95)];
};

/** 60 格批量格式从命令、投影、SVG 到同步布局读取必须落在一帧反馈预算内。 */
export async function runEditorTableStructureBrowserContract({ openEditor, load }) {
  const mount = document.createElement('div');
  mount.className = 'contract-offscreen';
  document.body.append(mount);
  const session = await openEditor(await load('sample-editor-add-table.pptx'), {
    idPrefix: 'browser-table-structure-',
  });
  try {
    const view = session.mount(mount, { mode: 'edit', textMode: 'svg', snapping: false });
    const id = view.insertTable(6, 10, { rect: { x: 80, y: 80, w: 1000, h: 480 } });
    const record = session.editor.doc.elements[id];
    const rows = Array.from({ length: 6 }, (_, r) => `#r${r}`);
    const columns = Array.from({ length: 10 }, (_, c) => `#c${c}`);
    const cells = rows.flatMap((row) => columns.map((column) => ({ row, column })));
    if (record.src.kind !== 'table' || cells.length !== 60
      || mount.querySelectorAll(`[data-edit-id="${id}"] [data-table-cell]`).length !== 60) {
      throw new Error('Chrome 60 格结构性能固件不完整');
    }
    const samples = [];
    for (let index = 0; index < 35; index++) {
      const color = index % 2 ? '#DBEAFE' : '#FDE68A';
      const started = performance.now();
      session.editor.exec(...cells.map((cell) => ({
        type: 'SetCellProps', id, cell, props: { fill: { type: 'solid', color } },
      })));
      mount.querySelector(`[data-edit-id="${id}"] [data-table-cell="5:9"]`)
        ?.getBoundingClientRect();
      samples.push(performance.now() - started);
      session.editor.undo();
    }
    const feedbackP95 = p95(samples);
    session.editor.exec({ type: 'InsertRow', id, at: { before: '#r1' } });
    session.editor.exec({ type: 'InsertColumn', id, at: { before: '#c1' } });
    const structured = session.editor.effectiveElement(id);
    if (structured.kind !== 'table' || structured.rows.length !== 7 || structured.colWidths.length !== 11
      || !mount.querySelector(`[data-edit-id="${id}"] [data-table-cell="6:10"]`)) {
      throw new Error('Chrome 表格结构命令没有完整反馈到末格 DOM');
    }
    recordPerformanceBudget('Chrome 60 格直接格式完整反馈 p95', feedbackP95, 16);
    return { p95: feedbackP95 };
  } finally {
    session.dispose();
    mount.remove();
  }
}
