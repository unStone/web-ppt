import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { installDomEnv } from './lib/dom-env.mjs';
import { recordCount } from './lib/measured.mjs';

installDomEnv();

const root = resolve('.');
const out = resolve(root, 'out/viewer-notes-clear');
mkdirSync(out, { recursive: true });

const api = await bundleBrowser({
  root,
  entry: resolve(root, 'packages/viewer/src/viewer-notes.ts'),
  output: resolve(out, 'viewer-notes.mjs'),
});

let count = 0;
const check = (condition, label) => {
  assert(condition, label);
  count++;
};

const panel = document.createElement('div');
const body = document.createElement('div');
const button = document.createElement('button');
panel.hidden = false;
body.textContent = '上一份讲稿';
button.classList.add('active');
button.disabled = false;
button.setAttribute('aria-pressed', 'true');
button.setAttribute('aria-expanded', 'true');

api.resetViewerNotes(panel, body, button);
check(panel.hidden, 'reset 收起面板');
check(body.textContent === '', 'reset 清空上一份正文');
check(!button.classList.contains('active') && button.disabled, 'reset 去掉按下并禁用');
check(button.getAttribute('aria-pressed') === 'false' && button.getAttribute('aria-expanded') === 'false', 'reset 清掉展开态');

assert.throws(() => api.setViewerNotesOpen(panel, button, true), /未打开文稿/);
count++;
check(panel.hidden && body.textContent === '', '禁用时打开必须失败且不改面板');

api.enableViewerNotes(button);
check(!button.disabled, '打开成功后才启用');
api.setViewerNotesOpen(panel, button, true);
check(!panel.hidden && button.classList.contains('active'), '启用后可以打开');
check(button.getAttribute('aria-pressed') === 'true', '打开时 aria-pressed');
api.setViewerNotesOpen(panel, button, false);
check(panel.hidden && !button.classList.contains('active'), '可以再关');

const source = readFileSync(resolve(root, 'packages/viewer/src/main.ts'), 'utf8');
const detach = source.slice(source.indexOf('function detachOpen'), source.indexOf('function beginOpen'));
check(detach.includes('resetViewerNotes'), '换文件 / 失败换代收起备注');
check(!detach.includes('notesBody.textContent = viewer'), '换代不读当前页备注');
const html = readFileSync(resolve(root, 'packages/viewer/index.html'), 'utf8');
check(html.includes('id="btnNotes"') && html.includes('disabled'), '未打开时按钮默认不可用');
check(source.includes('setViewerNotesOpen(notesPanel, btnNotes, false)'), 'Esc 第三位关备注');
check(source.includes('if (!viewer) return;'), '没有 Viewer 时 N 不打开');

recordCount('viewerNotesClear', count);
console.log(`独立查看器失败后不再留着上一份备注 ${count} 项通过`);
