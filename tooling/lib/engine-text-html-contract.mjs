/** engine HTML 必须直接表达公开行盒，而不是把断行再次交给浏览器。 */
export function runEngineTextHtmlContract({ lib, parsed, check, eq, near }) {
  console.log('\n\x1b[36m▸ Engine 文字编辑行盒\x1b[0m');
  const presentation = parsed.get('sample-editor-engine-text.pptx');
  const element = presentation?.slides.flatMap((slide) => slide.elements)
    .find((candidate) => candidate.kind === 'shape' && candidate.name === 'Engine 跨行基准');
  if (!check('engine 专用固件暴露跨行文本形状', !!element?.text)) return;

  const layout = lib.layoutText(element.text, element.w, element.h);
  const browser = lib.renderTextBodyToHtml(element.text, element.w, element.h);
  const explicitBrowser = lib.renderTextBodyToHtml(element.text, element.w, element.h, { layout: 'browser' });
  const engine = lib.renderTextBodyToHtml(element.text, element.w, element.h, { layout: 'engine' });
  eq('显式 browser 模式保持默认 HTML 逐字节身份', explicitBrowser, browser);
  check('固件确实产生多条 engine 视觉行', layout.lines.length >= 4, `实际 ${layout.lines.length}`);

  const host = document.createElement('div');
  host.innerHTML = engine;
  const root = host.firstElementChild;
  const lines = [...host.querySelectorAll('[data-engine-line]')];
  check('engine HTML 标记排版来源且关闭浏览器自动换行',
    root?.getAttribute('data-layout') === 'engine'
      && root.style.position === 'relative'
      && root.style.whiteSpace === 'pre');
  eq('engine HTML 每条视觉行一一对应 layoutText', lines.length, layout.lines.length);
  for (let index = 0; index < Math.min(lines.length, layout.lines.length); index++) {
    const expected = layout.lines[index];
    near(`engine 第 ${index + 1} 行 x`, Number(lines[index].dataset.x), expected.x, 0.01);
    near(`engine 第 ${index + 1} 行 y`, Number(lines[index].dataset.y), expected.y, 0.01);
  }
  check('跨行 run 被拆成带源半开区间的多个可编辑分段',
    host.querySelectorAll('[data-r="0.0"][data-from][data-to]').length >= 2);

  const semanticNode = (node) => {
    if (node.nodeType === node.TEXT_NODE) return node.nodeValue ?? '';
    if (node.nodeType !== node.ELEMENT_NODE) return '';
    if (node.hasAttribute('data-bullet')) return '';
    if (node.localName === 'svg' && node.hasAttribute('data-r')) return '\uFFFC';
    if (node.localName === 'br') return '\n';
    let value = [...node.childNodes].map(semanticNode).join('');
    if (node.dataset.empty === 'true' && value.startsWith('\u00A0')) value = value.slice(1);
    return value;
  };
  const actualText = [...root.querySelectorAll('[data-p]')]
    .map((paragraph) => semanticNode(paragraph)).join('\n');
  const expectedText = element.text.paragraphs.map((paragraph) => paragraph.runs
    .map((run) => run.math?.length ? '\uFFFC' : run.text).join('')).join('\n');
  eq('engine 视觉行盒保留完整模型编辑串且不把软换行写进内容', actualText, expectedText);
  check('layoutText 省略的硬换行仍有不可见语义锚点',
    !!host.querySelector('[data-engine-semantic] [data-r="0.2"] br'));
  check('空 run 和空段仍有可定位标记',
    !!host.querySelector('[data-r="0.4"][data-empty="true"]')
      && !!host.querySelector('[data-p="1"] [data-empty="true"]'));
  check('项目符号有不可编辑视觉盒且不进入正文语义串',
    !!host.querySelector('[data-p="3"] [data-bullet="true"][contenteditable="false"]'));

  const byName = (name) => presentation.slides.flatMap((slide) => slide.elements)
    .find((candidate) => candidate.kind === 'shape' && candidate.name === name);
  const vertical = byName('Engine 竖排基准');
  const verticalLayout = lib.layoutText(vertical.text, vertical.w, vertical.h);
  const verticalHost = document.createElement('div');
  verticalHost.innerHTML = lib.renderTextBodyToHtml(vertical.text, vertical.w, vertical.h, { layout: 'engine' });
  eq('竖排 engine HTML 使用与原生 SVG 相同的局部仿射变换',
    verticalHost.firstElementChild.style.transform.replace(/\s/g, ''),
    `matrix(${verticalLayout.transform.join(',')})`);
  eq('竖排 engine HTML 仍逐行消费交换宽高后的行盒',
    verticalHost.querySelectorAll('[data-engine-line]').length, verticalLayout.lines.length);

  const columns = byName('Engine 分栏基准');
  const columnLayout = lib.layoutText(columns.text, columns.w, columns.h);
  const columnHost = document.createElement('div');
  columnHost.innerHTML = lib.renderTextBodyToHtml(columns.text, columns.w, columns.h, { layout: 'engine' });
  const columnXs = [...columnHost.querySelectorAll('[data-engine-line]')]
    .map((line) => Number(line.dataset.x));
  check('分栏 engine HTML 的物理 x 覆盖两列且与 layoutText 顺序相同',
    new Set(columnLayout.lines.map((line) => line.columnIndex)).size === 2
      && columnXs.every((x, index) => Math.abs(x - columnLayout.lines[index].x) <= 0.01));

  const formula = byName('Engine 公式基准');
  const formulaHost = document.createElement('div');
  formulaHost.innerHTML = lib.renderTextBodyToHtml(formula.text, formula.w, formula.h, { layout: 'engine' });
  check('公式在 engine DOM 中仍是只允许 0/1 两侧停靠的 SVG 原子',
    !!formulaHost.querySelector('svg[data-r="0.1"][data-from="0"][data-to="1"]'));

  const autofit = byName('Engine 裸自动缩放');
  const autofitLayout = lib.layoutText(autofit.text, autofit.w, autofit.h);
  const autofitHost = document.createElement('div');
  autofitHost.innerHTML = lib.renderTextBodyToHtml(autofit.text, autofit.w, autofit.h, { layout: 'engine' });
  near('裸 normAutofit 的 engine HTML 与 SVG 行盒共用有效字号比例',
    Number(autofitHost.firstElementChild.dataset.fontScale), autofitLayout.scale, 0.005);
  const fixedBrowser = document.createElement('div');
  fixedBrowser.innerHTML = lib.renderTextBodyToHtml(
    autofit.text, autofit.w, autofit.h, { layout: 'browser', scale: 0.61 },
  );
  const fixedEngine = document.createElement('div');
  fixedEngine.innerHTML = lib.renderTextBodyToHtml(
    autofit.text, autofit.w, autofit.h, { layout: 'engine', scale: 0.61 },
  );
  check('已解决的 autofit 比例让 browser/engine 跳过二次求解且保留 normal 身份',
    fixedBrowser.firstElementChild.dataset.fontScale === '0.61'
      && fixedBrowser.firstElementChild.dataset.autofit === 'normal'
      && fixedEngine.firstElementChild.dataset.fontScale === '0.61'
      && fixedEngine.firstElementChild.dataset.autofit === 'normal');

  const overriddenText = {
    ...autofit.text,
    insets: [0, 0, 0, 0],
    paragraphs: autofit.text.paragraphs.map((paragraph) => ({
      ...paragraph,
      runs: paragraph.runs.map((run) => ({ ...run, text: run.text.repeat(2) })),
    })),
  };
  const overriddenOptions = { insets: [24, 18, 20, 16], vert: 'vert270' };
  const sourceBoxScale = lib.layoutText(overriddenText, autofit.w, autofit.h).scale;
  const effectiveBoxScale = lib.layoutText(
    overriddenText, autofit.w, autofit.h, overriddenOptions,
  ).scale;
  const overrideBrowser = document.createElement('div');
  overrideBrowser.innerHTML = lib.renderTextBodyToHtml(
    overriddenText, autofit.w, autofit.h, { layout: 'browser', ...overriddenOptions },
  );
  const overrideEngine = document.createElement('div');
  overrideEngine.innerHTML = lib.renderTextBodyToHtml(
    overriddenText, autofit.w, autofit.h, { layout: 'engine', ...overriddenOptions },
  );
  check('自动缩放使用编辑面实际的边距与竖排内容盒',
    effectiveBoxScale !== sourceBoxScale
      && Math.abs(Number(overrideBrowser.firstElementChild.dataset.fontScale) - effectiveBoxScale) <= 0.005
      && Math.abs(Number(overrideEngine.firstElementChild.dataset.fontScale) - effectiveBoxScale) <= 0.005,
  `source=${sourceBoxScale} effective=${effectiveBoxScale} browser=${overrideBrowser.firstElementChild.dataset.fontScale} engine=${overrideEngine.firstElementChild.dataset.fontScale}`);

  const oldDocument = globalThis.document;
  globalThis.document = undefined;
  try {
    check('engine HTML 纯序列化可在 Worker 中运行',
      lib.renderTextBodyToHtml(element.text, element.w, element.h, { layout: 'engine' })
        .includes('data-layout="engine"'));
  } finally {
    globalThis.document = oldDocument;
  }
}
