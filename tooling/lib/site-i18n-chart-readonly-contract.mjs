import { readFileSync } from 'node:fs';
import { unzipSync } from 'fflate';
import { makeZip } from './ooxml.mjs';
import { selectPaneObject } from './site-editor-browser-helpers.mjs';

export async function runSiteI18nChartReadonlyContract(context) {
  const { evaluate, click, waitFor } = context;
  // 从同一确定性固件移除关系目标，真实解析器应保留缓存预览但拒绝数据写回。
  const parts = unzipSync(readFileSync(new URL('../../fixtures/sample-chart-data.pptx', import.meta.url)));
  delete parts['ppt/embeddings/chart-data.xlsx'];
  const encoded = Buffer.from(makeZip(Object.entries(parts))).toString('base64');
  await click('[data-site-locale="en"]');
  await evaluate(`(() => {
    window.confirm = () => true;
    const bytes = Uint8Array.from(atob(${JSON.stringify(encoded)}), (char) => char.charCodeAt(0));
    const files = new DataTransfer(); files.items.add(new File([bytes], 'chart-readonly.pptx'));
    const input = document.querySelector('#fileInput'); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await waitFor("document.querySelector('#fileName').textContent === 'chart-readonly.pptx' && !document.querySelector('#editorApp').dataset.loading", '缺工作簿固件就绪');
  await selectPaneObject(context, '图表');
  await waitFor("document.querySelector('[data-chart-status]').textContent === 'This chart data is read-only: 图表关系指向的内嵌工作簿不存在'", '只读绑定保留真实诊断');
  if (!await evaluate(`!document.querySelector('#chartInspector').hidden
    && [...document.querySelectorAll('#chartInspector input,#chartInspector button')].every((node) => node.disabled)
    && document.querySelector('[data-chart-grid] thead input').value === '2024 年'
    && document.querySelector('#undo').disabled && !document.querySelector('#saveFile').disabled`)) throw new Error('只读图表应保留原文、禁用数据修改且不影响文稿保存');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('[data-chart-status]').textContent === '此图表数据只读：图表关系指向的内嵌工作簿不存在'", '只读摘要切中文');
  if (!await evaluate("[...document.querySelectorAll('#chartInspector input,#chartInspector button')].every((node) => node.disabled)")) throw new Error('切语言不能解除只读图表限制');
}
