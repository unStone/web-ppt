import { captureSaveAndReopen, changeValue, openFixture } from './site-editor-browser-helpers.mjs';

export async function runSiteCommentEditBrowserContract(context) {
  const { evaluate, click, waitFor } = context;
  await openFixture(context, '/fixtures/sample-comment-edit.pptx', 'comment-edit.pptx');
  await click('#commentsTools');
  await waitFor("!!document.querySelector('[data-comment-editor]')", '批注编辑就绪');
  await changeValue(context, '[data-comment-editor] [name=author]', '浏览器作者');
  await changeValue(context, '[data-comment-editor] [name=text]', '  浏览器新增 <script>\n正文  ');
  await click('[data-comment-submit]');
  await waitFor("document.querySelectorAll('#commentsPanel li').length === 4", '新增批注');
  await click('#commentsPanel li:last-child [data-comment-action=reply]');
  await changeValue(context, '[data-comment-editor] [name=text]', '浏览器回复');
  await click('[data-comment-submit]');
  await waitFor("document.querySelectorAll('#commentsPanel li').length === 5 && [...document.querySelectorAll('[data-parent-comment-id] p')].some(p=>p.textContent==='浏览器回复')", '批注回复关系');
  await click('#commentsPanel li:first-child [data-comment-action=edit]');
  await changeValue(context, '[data-comment-editor] [name=text]', '修改原始批注');
  await click('[data-comment-submit]');
  await waitFor("document.querySelector('#commentsPanel li:first-child p')?.textContent === '修改原始批注'", '修改批注');
  await click('#commentsPanel li:first-child [data-comment-action=delete]');
  await waitFor("document.querySelectorAll('#commentsPanel li').length === 4", '删除批注');
  await click('#undo');
  await waitFor("document.querySelectorAll('#commentsPanel li').length === 5", '撤销批注删除');
  await click('[data-site-locale="en"]');
  await waitFor("document.querySelector('[data-comment-editor] [data-author]')?.textContent === 'Comment author'", '批注编辑切英文');
  await captureSaveAndReopen(context, 'comment-edit-saved.pptx');
  await click('#commentsTools');
  await waitFor("document.querySelectorAll('#commentsPanel li').length === 5 && !!document.querySelector('[data-comment-editor]')", '批注保存重开');
  if (!await evaluate("[...document.querySelectorAll('#commentsPanel li p')].some(p=>p.textContent==='  浏览器新增 <script>\\n正文  ') && !document.querySelector('#commentsPanel script')")) throw new Error('批注正文转义或空白损失');
  await click('#viewMode');
  await waitFor("document.querySelector('[data-comment-editor]')?.hidden && !document.querySelector('[data-comment-actions]')", '查看模式关闭编辑');
  await click('#editMode');
  await waitFor("document.querySelector('[data-comment-editor]')?.hidden === false", '重新进入编辑模式');
  await click('[data-site-locale="zh-CN"]');
  await click('#commentsPanel [data-close]');
  console.log('  批注编辑：增改删、回复、撤销、中英文、保存与查看模式通过');
}
