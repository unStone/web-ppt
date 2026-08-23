/** 在两个独立进程中对照只读与编辑模式，并把技术方案的 M0 性能预算变成门禁。 */
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const bench = join(root, 'tooling/bench.mjs');

function run(edit) {
  const args = ['--expose-gc', bench, '30', '--json'];
  if (edit) args.push('--edit');
  const output = execFileSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 180_000,
  });
  return JSON.parse(output);
}

console.log('\n\x1b[36m▸ M0 编辑性能预算\x1b[0m');
const readonly = run(false);
const editable = run(true);
const failures = [];
const check = (name, ok, detail) => {
  if (ok) console.log(`  ✓ ${name} · ${detail}`);
  else failures.push(`${name} — ${detail}`);
};

check('同口径大文稿', readonly.pages >= 200 && readonly.pages === editable.pages
  && readonly.elements === editable.elements,
`${readonly.pages}/${editable.pages} 页，${readonly.elements}/${editable.elements} 元素`);
check('只读路径零编辑状态', readonly.defaultState.slideEditInfo === 0
  && readonly.defaultState.elementEditInfo === 0 && !readonly.defaultState.package,
`slide=${readonly.defaultState.slideEditInfo} element=${readonly.defaultState.elementEditInfo} package=${readonly.defaultState.package}`);

const baseMemory = readonly.memory.retainedBytes;
const editMemory = editable.memory.retainedBytes;
if (baseMemory === null || editMemory === null) {
  failures.push('内存预算 — 必须用 --expose-gc 得到回收后驻留量');
} else {
  const delta = (editMemory / baseMemory - 1) * 100;
  check('编辑常驻内存增量 ≤ 40%', editMemory <= baseMemory * 1.4,
    `${(baseMemory / 1024 / 1024).toFixed(1)}MB → ${(editMemory / 1024 / 1024).toFixed(1)}MB（${delta >= 0 ? '+' : ''}${delta.toFixed(1)}%）`);
}

const commit = editable.editDoc?.commitRenderMsPerOp;
check('提交并整页重渲 ≤ 16ms', typeof commit === 'number' && commit <= 16,
  `${typeof commit === 'number' ? commit.toFixed(3) : '缺失'}ms/次`);
const elementCommit = editable.editDoc?.elementCommitRenderMsPerOp;
check('脏元素提交并渲染 ≤ 8ms', typeof elementCommit === 'number' && elementCommit <= 8,
  `${typeof elementCommit === 'number' ? elementCommit.toFixed(3) : '缺失'}ms/次`);
const undoRender = editable.editDoc?.undoRenderMsPerOp;
const redoRender = editable.editDoc?.redoRenderMsPerOp;
check('200 组撤销 / 重做 + 脏页重渲均 ≤ 50ms', typeof undoRender === 'number'
  && typeof redoRender === 'number' && undoRender <= 50 && redoRender <= 50
  && editable.editDoc.historyOps === 200 && editable.editDoc.historyChecksum > 0,
  `undo ${typeof undoRender === 'number' ? undoRender.toFixed(3) : '缺失'}ms/次，` +
  `redo ${typeof redoRender === 'number' ? redoRender.toFixed(3) : '缺失'}ms/次，` +
  `历史 ${((editable.editDoc?.historyBytes ?? 0) / 1024).toFixed(1)}KB`);
const historyRebase = editable.editDoc?.historyRebaseMsPerOp;
check('200 组历史上的远端 rebase ≤ 8ms', typeof historyRebase === 'number'
  && historyRebase <= 8 && editable.editDoc.historyRebaseOps === 1000,
  `${typeof historyRebase === 'number' ? historyRebase.toFixed(3) : '缺失'}ms/次`);
const elementDom = editable.editDoc?.elementCommitDomMsPerOp;
check('脏元素提交并替换 DOM ≤ 16ms', typeof elementDom === 'number' && elementDom <= 16
  && editable.editDoc.elementDomNodes > 0,
  `${typeof elementDom === 'number' ? elementDom.toFixed(3) : '缺失'}ms/次，节点 ${editable.editDoc?.elementDomNodes ?? 0}`);
const textHtml = editable.editDoc?.textHtmlRenderMsPerOp;
check('文本编辑 HTML 生成 ≤ 8ms', typeof textHtml === 'number' && textHtml <= 8,
  `${typeof textHtml === 'number' ? textHtml.toFixed(3) : '缺失'}ms/次`);
const textLayout = editable.editDoc?.textLayoutMsPerOp;
check('文本行盒 + 字符映射 ≤ 8ms', typeof textLayout === 'number' && textLayout <= 8
  && editable.editDoc.textLayoutChecksum > 0,
  `${typeof textLayout === 'number' ? textLayout.toFixed(3) : '缺失'}ms/次`);
const textHtmlDom = editable.editDoc?.textHtmlDomMsPerOp;
check('文本编辑 HTML 上屏 ≤ 30ms', typeof textHtmlDom === 'number' && textHtmlDom <= 30
  && editable.editDoc.textHtmlDomNodes > 0,
  `${typeof textHtmlDom === 'number' ? textHtmlDom.toFixed(3) : '缺失'}ms/次，节点 ${editable.editDoc?.textHtmlDomNodes ?? 0}`);
check('有效投影缓存命中', typeof editable.editDoc?.cacheMs === 'number'
  && editable.editDoc.cacheMs < editable.editDoc.projectionMs,
  `冷投影 ${editable.editDoc?.projectionMs?.toFixed(2)}ms，210 页缓存 ${editable.editDoc?.cacheMs?.toFixed(2)}ms`);
const xmlRoundTrip = editable.editDoc?.xmlRoundTripMs;
check('210 页全部 XML 保留回环 ≤ 500ms', typeof xmlRoundTrip === 'number' && xmlRoundTrip <= 500
  && editable.editDoc.xmlRoundTripExact === editable.editDoc.xmlRoundTripParts,
  `${typeof xmlRoundTrip === 'number' ? xmlRoundTrip.toFixed(1) : '缺失'}ms，` +
  `${editable.editDoc?.xmlRoundTripExact ?? 0}/${editable.editDoc?.xmlRoundTripParts ?? 0} part`);
const opcSave = editable.editDoc?.opcSaveMs;
check('200 页 / 50MB 修改并序列化 3 页后保存 ≤ 500ms', typeof opcSave === 'number' && opcSave <= 500
  && editable.editDoc.opcSaveInputBytes >= 50 * 1024 * 1024
  && editable.editDoc.opcSaveDirtyParts === 3 && editable.editDoc.opcSavePreservedEntries > 3,
  `${typeof opcSave === 'number' ? opcSave.toFixed(1) : '缺失'}ms，` +
  `${((editable.editDoc?.opcSaveInputBytes ?? 0) / 1024 / 1024).toFixed(1)}MB，` +
  `直通 ${editable.editDoc?.opcSavePreservedEntries ?? 0} 条目`);

console.log('─'.repeat(60));
if (failures.length) {
  console.error(`\x1b[31m✗ ${failures.length} 项编辑性能预算失败\x1b[0m`);
  for (const failure of failures) console.error(`  · ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\x1b[32m✓ M0 性能与只读零状态预算全部通过\x1b[0m');
}
