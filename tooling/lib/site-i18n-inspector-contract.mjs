import { changeValue, openFixture, selectPaneObject, captureSaveAndReopen } from './site-editor-browser-helpers.mjs';
import { runSiteLanguageInputContract } from './site-language-input-contract.mjs';

export async function runSiteI18nInspectorContract(context) {
  const { evaluate, click, waitFor } = context;
  await click('[data-site-locale="en"]');
  await openFixture(context, '/fixtures/sample-editor-shape-format.pptx', '<形状 & 原文>.pptx');
  await selectPaneObject(context, 'format-alpha-solid');
  await evaluate("globalThis.__formatLanguageCanvas = document.querySelector('#canvasMount').firstElementChild");
  const fill = await evaluate("document.querySelector('#shapeFillColor').value");
  await changeValue(context, '#shapeFillColor', '#123456');
  await waitFor("document.querySelector('#statusText').textContent === 'Shape fill updated'", '形状填充英文结果');
  await click('[data-site-locale="zh-CN"]');
  if (!await evaluate(`document.querySelector('#statusText').textContent === '已更新形状填充'
    && document.querySelector('#shapeFillColor').value === '#123456'
    && document.querySelector('#canvasMount').firstElementChild === globalThis.__formatLanguageCanvas`)) throw new Error('切语言丢失形状格式或重建视图');
  await click('#undo'); await waitFor(`document.querySelector('#shapeFillColor').value === ${JSON.stringify(fill)}`, '双语填充撤销');
  await click('#redo'); await waitFor("document.querySelector('#shapeFillColor').value === '#123456'", '双语填充重做');
  await click('[data-site-locale="en"]');
  const stroke = await evaluate("document.querySelector('#shapeStrokeColor').value");
  await changeValue(context, '#shapeStrokeType', 'solid');
  await changeValue(context, '#shapeStrokeColor', '#654321');
  await waitFor("document.querySelector('#statusText').textContent === 'Shape stroke updated'", '形状描边英文结果');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '已更新形状描边'", '描边结果切中文');
  await click('#undo'); await waitFor(`document.querySelector('#shapeStrokeColor').value === ${JSON.stringify(stroke)}`, '双语描边撤销');
  await click('#redo'); await waitFor("document.querySelector('#shapeStrokeColor').value === '#654321'", '双语描边重做');
  await click('[data-site-locale="en"]');
  await click('#shapeShadow');
  await waitFor("document.querySelector('#statusText').textContent === 'Shape effects updated'", '形状效果英文结果');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '已更新形状效果'", '效果结果切中文');
  await runSiteLanguageInputContract(context, '对象格式');
  await captureSaveAndReopen(context, 'shape-language-saved.pptx');
  await selectPaneObject(context, 'format-alpha-solid');
  if (!await evaluate(`document.querySelector('#shapeFillColor').value === '#123456'
    && document.querySelector('#shapeStrokeColor').value === '#654321'
    && document.querySelector('#shapeShadow').checked && document.querySelector('#undo').disabled`)) throw new Error('双语形状格式没有保存重开');
  await runPreset(context);
  await runLinks(context);
}

async function runLinks(context) {
  const { evaluate, click, waitFor, request } = context;
  await openFixture(context, '/fixtures/sample-editor-animations.pptx', '<链接 & 原文>.pptx');
  await click('#slideList [data-slide-id]:nth-child(2)');
  await selectPaneObject(context, 'plain-a');
  const values = await evaluate("[...document.querySelector('#linkSlide').options].map((node) => node.value)");
  if (!await evaluate("[...document.querySelector('#linkSlide').options].every((node, index) => node.textContent === 'Slide ' + (index + 1))")) throw new Error('链接页面选项仍为中文');
  await changeValue(context, '#linkType', 'external');
  const address = 'https://example.com/ppt?source=%E5%A4%8D%E5%88%B6&lang=zh-CN';
  await click('#linkHref');
  await request('Input.insertText', { text: address });
  await evaluate("document.querySelector('#linkHref').setSelectionRange(8, 19)");
  await click('[data-site-locale="zh-CN"]');
  if (!await evaluate(`document.activeElement === document.querySelector('#linkHref')
    && document.activeElement.value === ${JSON.stringify(address)} && document.activeElement.selectionStart === 8
    && document.activeElement.selectionEnd === 19 && document.querySelector('#undo').disabled
    && [...document.querySelector('#linkSlide').options].every((node, index) => node.textContent === '第 ' + (index + 1) + ' 页')`)) throw new Error('切语言丢失链接原文、选区或没有翻译页标签');
  await click('[data-site-locale="en"]');
  await click('#applyLink');
  await waitFor("document.querySelector('#statusText').textContent === 'Hyperlink updated'", '链接英文成功状态');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '超链接已更新'", '链接成功切中文');
  await click('#undo'); await waitFor("document.querySelector('#linkType').value === 'none'", '链接双语撤销');
  await click('#redo'); await waitFor(`document.querySelector('#linkHref').value === ${JSON.stringify(address)}`, '链接双语重做');
  await click('#linkHref'); await evaluate("document.querySelector('#linkHref').select()");
  await request('Input.insertText', { text: 'javascript:void(0)' });
  await click('#applyLink');
  await waitFor("document.querySelector('#statusText').textContent.startsWith('对象操作失败：') && document.querySelector('#statusText').textContent.includes('SetLink.target.href')", '真实拒绝不安全链接');
  const diagnostic = await evaluate("document.querySelector('#statusText').textContent.slice('对象操作失败：'.length)");
  await click('[data-site-locale="en"]');
  await waitFor(`document.querySelector('#statusText').textContent === ${JSON.stringify('Object action failed: ' + diagnostic)}`, '链接错误原始诊断不翻译');
  await click('#undo'); await waitFor("document.querySelector('#linkType').value === 'none'", '失败链接不产生历史');
  await click('#redo'); await waitFor(`document.querySelector('#linkHref').value === ${JSON.stringify(address)}`, '失败后重做合法链接');
  await captureSaveAndReopen(context, 'link-language-saved.pptx');
  await click('#slideList [data-slide-id]:nth-child(2)');
  await selectPaneObject(context, 'plain-a');
  if (!await evaluate(`document.querySelector('#linkHref').value === ${JSON.stringify(address)} && document.querySelector('#undo').disabled`)) throw new Error('保存重开改写了链接原文');
  await changeValue(context, '#linkType', 'slide');
  const target = await evaluate("document.querySelector('#linkSlide').options[4].value");
  await changeValue(context, '#linkSlide', target);
  await click('[data-site-locale="zh-CN"]');
  if (!await evaluate(`document.querySelector('#linkSlide').value === ${JSON.stringify(target)}`)) throw new Error('页标签翻译改写了链接目标');
  await click('#applyLink');
  await click('#followLink');
  await waitFor("document.querySelector('#slideList [data-slide-id]:nth-child(5)').getAttribute('aria-current') === 'true'", '语言切换后链接导航到第五页');
  await click('[data-site-locale="en"]');
  await click('#slideList [data-slide-id]:nth-child(2)'); await selectPaneObject(context, 'plain-a');
  if (values.length !== 5 || !await evaluate("document.querySelector('#linkSlide').selectedIndex === 4")) throw new Error('链接回显目标不正确');
}

async function runPreset(context) {
  const { evaluate, click, waitFor, request } = context;
  await openFixture(context, '/fixtures/sample-editor-preset-shape.pptx', '<预设 & 原文>.pptx');
  await selectPaneObject(context, 'preset-source');
  await click('#startShapeAdjustments');
  await waitFor("document.querySelector('#statusText').textContent === 'Drag the orange handles on the shape to adjust its appearance'", '预设调节柄英文指导');
  await evaluate("globalThis.__presetLanguageHandle = document.querySelector('[data-ppt-preset-handle]')");
  await click('[data-site-locale="zh-CN"]');
  if (!await evaluate(`document.querySelector('#statusText').textContent === '拖动形状上的橙色圆点来调整外观'
    && document.querySelector('[data-ppt-preset-handle]') === globalThis.__presetLanguageHandle
    && document.querySelector('#undo').disabled`)) throw new Error('切语言取消调节柄或产生历史');
  const point = await evaluate(`(() => {
    const rect = document.querySelector('[data-ppt-preset-handle]').getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await request('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
  await request('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'left', buttons: 1, x: point.x + 18, y: point.y });
  await request('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, x: point.x + 18, y: point.y });
  await waitFor("!document.querySelector('#undo').disabled", '切语言后真实拖动调节柄');
  await click('#undo'); await waitFor("document.querySelector('#undo').disabled", '调节柄撤销不含语言切换');
  await click('#redo');
  await click('[data-site-locale="en"]');
  await changeValue(context, '#shapePreset', 'hexagon');
  await waitFor("document.querySelector('#statusText').textContent === 'Shape type changed; existing text and formatting are preserved'", '切换预设英文结果');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '已切换形状类型；原有文字和格式保持不变'", '预设结果切中文');
  if (!await evaluate("document.querySelector('#canvasMount').textContent.includes('保留文字与格式') && document.querySelector('#shapePreset').value === 'hexagon'")) throw new Error('预设切换改写了文稿文字或枚举');
  await click('#undo'); await waitFor("document.querySelector('#shapePreset').value === 'roundRect'", '双语预设撤销');
  await click('#redo'); await waitFor("document.querySelector('#shapePreset').value === 'hexagon'", '双语预设重做');
  await selectPaneObject(context, 'preset-no-handle');
  await click('[data-site-locale="en"]');
  await click('#startShapeAdjustments');
  await waitFor("document.querySelector('#statusText').textContent === 'This shape has no adjustable parameters'", '无调节参数英文说明');
  await click('[data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#statusText').textContent === '当前形状没有可调参数'", '无调节参数中文说明');
  await selectPaneObject(context, 'preset-custom');
  if (!await evaluate("document.querySelector('#startShapeAdjustments').disabled")) throw new Error('自由形状不应开放预设调节柄');
  await click('[data-site-locale="en"]');
  await captureSaveAndReopen(context, 'preset-language-saved.pptx');
  await selectPaneObject(context, 'preset-source');
  if (!await evaluate("document.querySelector('#shapePreset').value === 'hexagon' && document.querySelector('#canvasMount').textContent.includes('保留文字与格式') && document.querySelector('#undo').disabled")) throw new Error('预设双语操作未保存重开');
}
