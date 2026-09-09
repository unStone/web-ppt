import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import ts from 'typescript';

const path = 'packages/site/src/editor-chart-recovery-labels.ts';
const original = readFileSync(path, 'utf8');
const source = original.replace("import { setText } from './i18n/runtime';",
  'const setText = (...args) => globalThis.__chartRecoveryLabels.write(...args);')
  .replace("import('@web-ppt/edit-core/chart-shared')", 'globalThis.__chartRecoveryLabels.load()');
assert.ok(!source.includes("from './i18n/runtime'"));
assert.ok(!source.includes("import('@web-ppt/edit-core/chart-shared')"));
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { bindChartRecoveryLabels } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

for (const mode of ['normal', 'dispose', 'resolved', 'retry', 'replacement']) {
  const dom = new JSDOM('<div id="view"><svg data-ppt-layer="static"><g data-edit-root="frame"><text>图表编辑未恢复</text></g><g data-edit-root="user"><text>图表编辑未恢复</text></g></svg></div>');
  const document = dom.window.document;
  globalThis.MutationObserver = dom.window.MutationObserver;
  let resolve, reject, loaded = 0, writes = 0, unresolved = true;
  const loading = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  globalThis.__chartRecoveryLabels = {
    load() { loaded++; return loading; },
    write(label) { writes++; label.textContent = 'Chart edits not restored'; },
  };
  const chart = { queryChartData: () => ({ binding: { unresolved } }) };
  const records = {
    frame: { id: 'frame', meta: { editable: 'frame' }, src: { kind: 'group' } },
    user: { id: 'user', meta: { editable: 'full' }, src: { kind: 'shape' } },
  };
  const session = { editor: { doc: { elements: records },
    effectiveElement: id => ({ kind: id === 'frame' && unresolved ? 'unsupported' : 'shape' }) } };
  const release = bindChartRecoveryLabels(session, { element: document.querySelector('#view') });
  try {
    assert.equal(loaded, 1);
    if (mode === 'dispose') release();
    if (mode === 'resolved') unresolved = false;
    if (mode === 'retry') reject(new Error('temporary import failure')); else resolve(chart);
    await tick(); await tick();
    assert.equal(document.querySelector('[data-edit-root="user"] text').textContent, '图表编辑未恢复');
    assert.equal(writes, ['normal', 'replacement'].includes(mode) ? 1 : 0);
    if (mode === 'retry' || mode === 'replacement') {
      globalThis.__chartRecoveryLabels.load = () => { loaded++; return Promise.resolve(chart); };
      if (mode === 'replacement') document.querySelector('[data-edit-root="frame"]').innerHTML = '<text>图表编辑未恢复</text>';
      else document.querySelector('svg').append(document.createElement('g'));
      await tick(); await tick();
      assert.equal(writes, mode === 'retry' ? 1 : 2, '失败后重试或原节点重绘都要重新登记消息');
      assert.equal(document.querySelector('[data-edit-root="frame"] text').textContent, 'Chart edits not restored');
    }
  } finally { release(); dom.window.close(); delete globalThis.__chartRecoveryLabels; delete globalThis.MutationObserver; }
}
console.log('图表恢复提示：加载失败重试、节点重绘、用户文字保持、提前恢复与卸载通过');
