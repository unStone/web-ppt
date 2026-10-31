import { openFixture, selectPaneObject, changeValue, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';

export async function runSiteObjectEditBrowserContract(context) {
  const { evaluate, waitFor, click } = context;
  await openFixture(context, '/fixtures/sample-smartart-edit.pptx', 'smartart-edit-ui.pptx');
  await selectPaneObject(context, 'SmartArt');
  const root = '[data-smartart-editor]';
  await waitFor(`!!document.querySelector('${root} textarea')`, 'SmartArt 内部工具');
  await click('[data-site-locale="en"]');
  await waitFor(`document.querySelector('#chartInspector h2').textContent === 'SmartArt nodes'`, 'SmartArt 英文工具');
  await changeValue(context, `${root} textarea`, '原文 <新节点> & 编辑');
  await evaluate(`[...document.querySelectorAll('${root} button')].find((n) => n.textContent === 'Apply node text').click()`);
  await waitFor(`document.querySelector('#canvasMount').textContent.includes('原文 <新节点> & 编辑')`, '修改数据节点影响实际绘图');
  await click('#undo');
  await waitFor(`!document.querySelector('#canvasMount').textContent.includes('原文 <新节点> & 编辑')`, 'SmartArt 撤销');
  await click('#redo');
  await waitFor(`!document.querySelector('#chartInspector').hidden && document.querySelector('#canvasMount').textContent.includes('原文 <新节点> & 编辑')`, 'SmartArt 重做');
  await click(`${root} form button:nth-of-type(3)`);
  await waitFor(`document.querySelector('${root} [name="node"]').options.length === 4`, 'SmartArt 新增子节点');
  const added = await evaluate(`[...document.querySelector('${root} [name="node"]').options].find((n) => n.textContent.endsWith('New node')).value`);
  await changeValue(context, `${root} [name="node"]`, added);
  await changeValue(context, `${root} [name="parent"]`, '');
  await waitFor(`document.querySelector('${root} [name="parent"]').value === ''`, 'SmartArt 子节点提升为顶层');
  await click('[data-site-locale="zh-CN"]');
  await waitFor(`document.querySelector('#chartInspector h2').textContent === 'SmartArt 节点'`, 'SmartArt 中文工具');
  await captureSaveAndReopen(context, 'smartart-edit-reopened.pptx');
  await selectPaneObject(context, 'SmartArt');
  await waitFor(`document.querySelector('${root} [name="node"]')?.options.length === 4
    && document.querySelector('#canvasMount').textContent.includes('原文 <新节点> & 编辑')`, 'SmartArt 数据和缓存保存重开');
  await openFixture(context, '/fixtures/sample-ole-edit.pptx', 'ole-edit-ui.pptx');
  await selectPaneObject(context, 'Object 21');
  const ole = '[data-ole-editor]';
  await waitFor(`!!document.querySelector('${ole} [aria-label="营业数据 B2"]')`, 'OLE 工作簿内部工具');
  await changeValue(context, `${ole} [aria-label="营业数据 B2"]`, '6789');
  await waitFor(`document.querySelector('${ole} [aria-label="营业数据 B2"]')?.value === '6789'`, 'OLE 单元格编辑');
  await click('#undo');
  await waitFor(`document.querySelector('${ole} [aria-label="营业数据 B2"]')?.value === '100'`, 'OLE 单元格撤销');
  await click('#redo');
  await waitFor(`document.querySelector('${ole} [aria-label="营业数据 B2"]')?.value === '6789'`, 'OLE 单元格重做');
  await click('#slideList [data-slide-id]:nth-child(2)');
  await selectPaneObject(context, 'Object 22');
  await waitFor(`!!document.querySelector('${ole} textarea')`, 'OLE 文档内部工具');
  await changeValue(context, `${ole} textarea`, '浏览器修改的嵌入标题');
  await waitFor(`document.querySelector('${ole} textarea')?.value === '浏览器修改的嵌入标题'`, 'OLE 文档段落编辑');
  // 014：run 级编辑——只改一个片段，段落里其余片段不动。
  // 撤销断言不比较捕获的旧值：面板每次命令后整体重建，捕获值与重建后的 DOM
  // 之间没有稳定对应关系（CI 上曾因捕获竞态连续三次失败），改断言撤销后片段
  // 不再是改后文字且整段替换保留。
  await waitFor(`document.querySelectorAll('${ole} .ole-run input').length >= 2`, 'OLE 文档 run 级工具', 400);
  await changeValue(context, `${ole} .ole-run input`, '片段级改字');
  await waitFor(`document.querySelector('${ole} .ole-run input')?.value === '片段级改字'`, 'OLE run 级编辑生效', 400);
  await click('#undo');
  await waitFor(`document.querySelector('${ole} .ole-run input')?.value !== '片段级改字'`, 'run 级撤销回退片段', 400);
  await waitFor(`document.querySelector('${ole} textarea')?.value === '浏览器修改的嵌入标题'`, 'run 级撤销保留整段替换', 400);
  await click('#redo');
  await waitFor(`document.querySelector('${ole} .ole-run input')?.value === '片段级改字'`, 'OLE run 级重做', 400);
  await captureSaveAndReopen(context, 'ole-edit-reopened.pptx');
  await selectPaneObject(context, 'Object 21');
  await waitFor(`document.querySelector('${ole} [aria-label="营业数据 B2"]')?.value === '6789'`, 'OLE 工作簿保存重开');
  await click('#slideList [data-slide-id]:nth-child(2)');
  await selectPaneObject(context, 'Object 22');
  await waitFor(`document.querySelector('${ole} .ole-run input')?.value === '片段级改字'`, 'OLE run 级保存重开');
  // 015：单元格样式与富文本入口（选中 B2 后操作，含英文文案与撤销）
  await click('#slideList [data-slide-id]:nth-child(1)');
  await selectPaneObject(context, 'Object 21');
  await waitFor(`!!document.querySelector('${ole} [aria-label="营业数据 B2"]')`, 'OLE 工作簿再次就绪');
  await evaluate(`document.querySelector('${ole} [aria-label="营业数据 B2"]')?.focus()`);
  await waitFor(`document.querySelector('${ole} .ole-style') !== null`, '样式与富文本表单在场');
  await evaluate(`(() => { const form = document.querySelector('${ole} .ole-style'); const color = form.querySelector('[aria-label="填充颜色"]'); color.value = 'e2efda'; [...form.querySelectorAll('button')].find((n) => n.textContent === '应用样式').click(); })()`);
  await click('#undo');
  await waitFor(`document.querySelector('${ole} [aria-label="营业数据 B2"]')?.value === '6789'`, '样式命令撤销后单元格值不受影响');
  await click('[data-site-locale="en"]');
  await waitFor(`[...document.querySelectorAll('${ole} .ole-style button')].some((n) => n.textContent === 'Apply style')`, '样式表单英文文案');
  await click('[data-site-locale="zh-CN"]');
  await evaluate(`document.querySelector('${ole} [aria-label="营业数据 B2"]')?.focus()`);
  await evaluate(`(() => {
    const rich = document.querySelector('${ole} .ole-rich');
    rich.querySelector('input[aria-label="富文本片段文字"]').value = '富文本一';
    [...rich.querySelectorAll('button')].find((n) => n.textContent === '添加片段').click();
  })()`);
  await evaluate(`(() => {
    const rich = document.querySelector('${ole} .ole-rich');
    rich.querySelectorAll(':scope > div > div:nth-of-type(2) > input')[0].value = '富文本二';
    [...rich.querySelectorAll('button')].find((n) => n.textContent === '设为富文本').click();
  })()`);
  await click('#undo');
  await waitFor(`document.querySelector('${ole} [aria-label="营业数据 B2"]')?.value === '6789'`, '富文本命令撤销后单元格值不受影响');
  await openFixture(context, '/fixtures/sample-ink-edit.pptx', 'ink-edit-ui.pptx');
  await selectPaneObject(context, '墨迹 1');
  const ink = '[data-ink-editor]';
  await waitFor(`document.querySelector('${ink} [name="stroke"]')?.options.length === 2`, '墨迹笔画工具');
  await changeValue(context, `${ink} [aria-label="笔画颜色"]`, '#cc2200');
  await click(`${ink} button:nth-of-type(1)`);
  await waitFor(`!document.querySelector('#chartInspector').hidden && document.querySelector('[data-ink-editor] [aria-label="笔画颜色"]')?.value === '#cc2200' && document.querySelector('#canvasMount path[stroke="#cc2200"]') !== null`, '墨迹笔刷实际投影');
  await click(`${ink} button:nth-of-type(4)`);
  await waitFor(`document.querySelector('${ink} [name="stroke"]')?.options.length === 1`, '删除单笔画');
  await click('#undo');
  await waitFor(`document.querySelector('${ink} [name="stroke"]')?.options.length === 2`, '撤销删除笔画');
  const box = await evaluate(`(() => { const svg = document.querySelector('${ink} svg'); svg.scrollIntoView({ block: 'center' }); const b = svg.getBoundingClientRect(); return { x: b.x + b.width * 0.3, y: b.y + b.height * 0.4 }; })()`);
  await context.request('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 4; i++) await context.request('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + i * 9, y: box.y + i * 5, button: 'left', buttons: 1 });
  await context.request('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 36, y: box.y + 20, button: 'left', buttons: 0, clickCount: 1 });
  await waitFor(`document.querySelector('${ink} [name="stroke"]')?.options.length === 3`, '真实指针手绘新增笔画');
  await captureSaveAndReopen(context, 'ink-edit-reopened.pptx');
  await selectPaneObject(context, '墨迹 1');
  await waitFor(`document.querySelector('${ink} [name="stroke"]')?.options.length === 3 && document.querySelector('#canvasMount path[stroke="#cc2200"]') !== null`, '墨迹原生笔画保存重开');
}


