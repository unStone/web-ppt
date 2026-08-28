import {
  changeValue, openFixture, saveAndReopen, selectPaneObject,
} from './site-editor-browser-helpers.mjs';

export async function runSiteEditorShapeToolbarContract(context) {
  const { evaluate, waitFor, click } = context;
  await openFixture(context, '/fixtures/sample-editor-shape-format.pptx', 'shape-format.pptx');
  await selectPaneObject(context, 'format-alpha-solid');
  await waitFor(`document.querySelector('#shapeInspector') && !document.querySelector('#shapeInspector').hidden`, '形状上下文面板');

  const before = await evaluate("document.querySelector('#shapeFillColor').value");
  await changeValue(context, '#shapeFillColor', '#123456');
  await waitFor(`document.querySelector('#shapeFillColor').value === '#123456'`, '形状填充写入');
  await click('#undo');
  await waitFor(`document.querySelector('#shapeFillColor').value === ${JSON.stringify(before)}`, '形状填充撤销');
  await click('#redo');
  await waitFor(`document.querySelector('#shapeFillColor').value === '#123456'`, '形状填充重做');

  await selectPaneObject(context, 'format-rich-stroke');
  const strokeBefore = await evaluate("document.querySelector('#shapeStrokeColor').value");
  await changeValue(context, '#shapeStrokeColor', '#654321');
  await waitFor(`document.querySelector('#shapeStrokeColor').value === '#654321'`, '形状描边写入');
  await click('#undo');
  await waitFor(`document.querySelector('#shapeStrokeColor').value === ${JSON.stringify(strokeBefore)}`, '形状描边撤销');
  await click('#redo');
  await waitFor(`document.querySelector('#shapeStrokeColor').value === '#654321'`, '形状描边重做');

  await selectPaneObject(context, 'format-alpha-solid');

  const shadowBefore = await evaluate("document.querySelector('#shapeShadow').checked");
  await click('#shapeShadow');
  await waitFor(`document.querySelector('#shapeShadow').checked === ${!shadowBefore}`, '形状阴影写入');
  await click('#undo');
  await waitFor(`document.querySelector('#shapeShadow').checked === ${shadowBefore}`, '形状阴影撤销');
  await click('#redo');
  await waitFor(`document.querySelector('#shapeShadow').checked === ${!shadowBefore}`, '形状阴影重做');

  await changeValue(context, '#linkType', 'external');
  await changeValue(context, '#linkHref', 'https://example.com/ppt');
  await click('#applyLink');
  await waitFor(`document.querySelector('#linkType').value === 'external'`, '元素链接写入');
  await click('#undo');
  await waitFor(`document.querySelector('#linkType').value === 'none'`, '元素链接撤销');
  await click('#redo');
  await waitFor(`document.querySelector('#linkType').value === 'external'`, '元素链接重做');

  const backgroundBefore = await evaluate("document.querySelector('#slideBackgroundColor').value");
  await changeValue(context, '#slideBackgroundColor', '#abcdef');
  await waitFor(`document.querySelector('#slideBackgroundColor').value === '#abcdef'`, '页面背景写入');
  await click('#undo');
  await waitFor(`document.querySelector('#slideBackgroundColor').value === ${JSON.stringify(backgroundBefore)}`, '页面背景撤销');
  await click('#redo');
  await waitFor(`document.querySelector('#slideBackgroundColor').value === '#abcdef'`, '页面背景重做');

  await click('#slideHidden');
  await waitFor("document.querySelector('#slideHidden').checked", '隐藏页面写入');
  await click('#undo');
  await waitFor("!document.querySelector('#slideHidden').checked", '隐藏页面撤销');
  await click('#redo');
  await waitFor("document.querySelector('#slideHidden').checked", '隐藏页面重做');

  await changeValue(context, '#slideNotes', '073 浏览器备注');
  await click('#applyNotes');
  await click('#undo');
  await waitFor("document.querySelector('#slideNotes').value === ''", '备注撤销');
  await click('#redo');
  await waitFor("document.querySelector('#slideNotes').value === '073 浏览器备注'", '备注重做');

  await changeValue(context, '#transitionType', 'fade');
  await click('#applyTransition');
  await waitFor("document.querySelector('#transitionType').value === 'fade'", '切换效果写入');
  await click('#undo');
  await waitFor("document.querySelector('#transitionType').value === 'none'", '切换效果撤销');
  await click('#redo');
  await waitFor("document.querySelector('#transitionType').value === 'fade'", '切换效果重做');

  const animationBefore = await evaluate("document.querySelectorAll('#animationTimeline li').length");
  await click('#addAnimation');
  await waitFor(`document.querySelectorAll('#animationTimeline li').length === ${animationBefore + 1}`, '动画写入');
  await click('#undo');
  await waitFor(`document.querySelectorAll('#animationTimeline li').length === ${animationBefore}`, '动画撤销');
  await click('#redo');
  await waitFor(`document.querySelectorAll('#animationTimeline li').length === ${animationBefore + 1}`, '动画重做');

  const recoveryDefault = await evaluate("document.querySelector('#recoveryToggle').checked");
  if (!recoveryDefault) throw new Error('本机恢复默认没有启用');
  await click('#recoveryToggle'); await click('#recoveryToggle');
  await waitFor("document.querySelector('#recoveryState').textContent === '恢复记录已写入本机'", '本机恢复记录落盘');
  await evaluate(`(async () => {
    window.confirm = () => true;
    const bytes = await fetch('/fixtures/sample-editor-shape-format.pptx').then((response) => response.arrayBuffer());
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'shape-format.pptx'));
    const input = document.querySelector('#fileInput'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor("!document.querySelector('#recoveryPrompt').hidden", '本机恢复提示');
  await evaluate(`(async () => {
    const bytes = await fetch('/fixtures/sample-editor-text.pptx').then((response) => response.arrayBuffer());
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'reentry-text.pptx'));
    const input = document.querySelector('#fileInput'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor(`document.querySelector('#fileName')?.textContent === 'reentry-text.pptx'
    && document.querySelector('#recoveryPrompt').hidden
    && !document.querySelector('#editorApp')?.dataset.loading`, '恢复决策被新打开取代');
  await evaluate(`(async () => {
    const bytes = await fetch('/fixtures/sample-editor-shape-format.pptx').then((response) => response.arrayBuffer());
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], 'shape-format.pptx'));
    const input = document.querySelector('#fileInput'); input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor("!document.querySelector('#recoveryPrompt').hidden", '重新进入本机恢复提示');
  await click('#restoreRecovery');
  await waitFor(`document.querySelector('#fileName')?.textContent.startsWith('● shape-format.pptx')
    && !document.querySelector('#editorApp')?.dataset.loading`, '恢复后的形状文稿');
  await selectPaneObject(context, 'format-alpha-solid');
  await waitFor(`document.querySelector('#shapeFillColor').value === '#123456'
    && document.querySelector('#slideHidden').checked
    && document.querySelector('#transitionType').value === 'fade'
    && document.querySelectorAll('#animationTimeline li').length === ${animationBefore + 1}`, '恢复内容验证');
  await selectPaneObject(context, 'format-rich-stroke');
  await waitFor(`document.querySelector('#shapeStrokeColor').value === '#654321'`, '恢复描边验证');

  await saveAndReopen(context, 'shape-format-reopen.pptx');
  await selectPaneObject(context, 'format-alpha-solid');
  await waitFor(`document.querySelector('#shapeFillColor').value === '#123456'
    && document.querySelector('#linkType').value === 'external'
    && document.querySelector('#slideBackgroundColor').value === '#abcdef'
    && document.querySelector('#slideHidden').checked
    && document.querySelector('#slideNotes').value === '073 浏览器备注'
    && document.querySelector('#transitionType').value === 'fade'
    && document.querySelectorAll('#animationTimeline li').length === ${animationBefore + 1}`, '形状与页面能力重开验证');
  await selectPaneObject(context, 'format-rich-stroke');
  await waitFor(`document.querySelector('#shapeStrokeColor').value === '#654321'`, '描边重开验证');
}
