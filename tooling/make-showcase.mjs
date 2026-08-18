/** 生成 fixtures/showcase.pptx —— 覆盖渲染器全部能力的回归测试文件 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { label, makePng, makeZip, NS, nvGrp, px, slideXml, solid, sp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280, H = 720;

const image1 = makePng(120, 90, (x, y) =>
  (Math.floor(x / 15) + Math.floor(y / 15)) % 2 === 0
    ? [68, 114, 196]
    : [Math.round((x / 120) * 255), Math.round((y / 90) * 255), 190]);

// ---------- 1. 形状库 ----------

const SHAPES = [
  'rect', 'roundRect', 'round1Rect', 'round2DiagRect', 'snip1Rect', 'snip2DiagRect', 'plaque', 'bevel',
  'frame', 'halfFrame', 'corner', 'diagStripe', 'foldedCorner', 'ellipse', 'triangle', 'rtTriangle',
  'diamond', 'parallelogram', 'trapezoid', 'pentagon', 'hexagon', 'heptagon', 'octagon', 'decagon',
  'homePlate', 'chevron', 'plus', 'teardrop', 'can', 'cube', 'donut', 'noSmoking',
  'pie', 'chord', 'blockArc', 'cloud', 'heart', 'lightningBolt', 'sun', 'moon',
  'smileyFace', 'irregularSeal1', 'gear6', 'funnel', 'star4', 'star5', 'star6', 'star8',
  'star12', 'star24', 'rightArrow', 'leftRightArrow', 'upDownArrow', 'quadArrow', 'bentArrow', 'uturnArrow',
  'curvedRightArrow', 'curvedUpArrow', 'stripedRightArrow', 'notchedRightArrow', 'circularArrow', 'rightArrowCallout', 'leftRightArrowCallout', 'mathPlus',
  'mathMultiply', 'mathDivide', 'mathEqual', 'mathNotEqual', 'ribbon', 'ribbon2', 'verticalScroll', 'horizontalScroll',
  'wave', 'doubleWave', 'wedgeRectCallout', 'wedgeRoundRectCallout', 'wedgeEllipseCallout', 'cloudCallout', 'leftBracket', 'bracketPair',
  'leftBrace', 'bracePair', 'flowChartProcess', 'flowChartDecision', 'flowChartInputOutput', 'flowChartPredefinedProcess', 'flowChartInternalStorage', 'flowChartDocument',
  'flowChartMultidocument', 'flowChartTerminator', 'flowChartPreparation', 'flowChartManualInput', 'flowChartManualOperation', 'flowChartConnector', 'flowChartOffpageConnector', 'flowChartPunchedCard',
  'flowChartPunchedTape', 'flowChartSummingJunction', 'flowChartOr', 'flowChartCollate', 'flowChartSort', 'flowChartExtract', 'flowChartMerge', 'flowChartOnlineStorage',
  'flowChartMagneticTape', 'flowChartMagneticDisk', 'flowChartMagneticDrum', 'flowChartDisplay', 'flowChartDelay', 'actionButtonHome', 'actionButtonForwardNext', 'actionButtonInformation',
  'actionButtonReturn', 'actionButtonSound', 'actionButtonMovie', 'actionButtonHelp', 'chartX', 'chartPlus', 'chartStar', 'gear9',
];

const COLS = 16, CELL_W = 76, CELL_H = 62, SHAPE_W = 50, SHAPE_H = 34;

const shapeGallery = SHAPES.map((prst, i) => {
  const col = i % COLS, row = Math.floor(i / COLS);
  const x = 16 + col * CELL_W, y = 48 + row * CELL_H;
  const accent = `accent${(i % 6) + 1}`;
  return (
    sp({ x: x + (CELL_W - SHAPE_W) / 2, y, w: SHAPE_W, h: SHAPE_H, prst, fill: solid(accent), ln: '<a:ln w="9525"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:ln>', name: prst }) +
    sp({ x, y: y + SHAPE_H + 1, w: CELL_W, h: 14, prst: 'rect', fill: '<a:noFill/>', text: label(prst.replace(/^flowChart|^actionButton/, ''), 600, '666666') })
  );
}).join('');

const slide1 = slideXml(
  sp({ x: 16, y: 8, w: 700, h: 34, prst: 'rect', fill: '<a:noFill/>', text: `<a:p><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>预设形状库（${SHAPES.length} 个）</a:t></a:r></a:p>` }) +
  shapeGallery,
);

// ---------- 2. 效果与填充 ----------

const effectDemos = [
  ['外阴影', '<a:effectLst><a:outerShdw blurRad="76200" dist="63500" dir="2700000"><a:srgbClr val="000000"><a:alpha val="45000"/></a:srgbClr></a:outerShdw></a:effectLst>', solid('accent1')],
  ['发光', '<a:effectLst><a:glow rad="152400"><a:schemeClr val="accent2"><a:alpha val="80000"/></a:schemeClr></a:glow></a:effectLst>', solid('accent2')],
  ['柔化边缘', '<a:effectLst><a:softEdge rad="114300"/></a:effectLst>', solid('accent6')],
  ['阴影+发光', '<a:effectLst><a:glow rad="76200"><a:schemeClr val="accent4"/></a:glow><a:outerShdw blurRad="50800" dist="38100" dir="5400000"><a:srgbClr val="000000"><a:alpha val="50000"/></a:srgbClr></a:outerShdw></a:effectLst>', solid('accent4')],
];

const fillDemos = [
  ['线性渐变 45°', '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs><a:gs pos="100000"><a:schemeClr val="accent2"/></a:gs></a:gsLst><a:lin ang="2700000"/></a:gradFill>'],
  ['三色渐变 0°', '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF5252"/></a:gs><a:gs pos="50000"><a:srgbClr val="FFD740"/></a:gs><a:gs pos="100000"><a:srgbClr val="69F0AE"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>'],
  ['径向渐变', '<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs><a:gs pos="100000"><a:schemeClr val="accent5"/></a:gs></a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>'],
  ['图案 diagCross', '<a:pattFill prst="diagCross"><a:fgClr><a:schemeClr val="accent1"/></a:fgClr><a:bgClr><a:srgbClr val="FFFFFF"/></a:bgClr></a:pattFill>'],
  ['图案 horz', '<a:pattFill prst="horz"><a:fgClr><a:schemeClr val="accent6"/></a:fgClr><a:bgClr><a:srgbClr val="F2F2F2"/></a:bgClr></a:pattFill>'],
  ['半透明 40%', '<a:solidFill><a:schemeClr val="accent3"><a:alpha val="40000"/></a:schemeClr></a:solidFill>'],
  ['lumMod 75%', '<a:solidFill><a:schemeClr val="accent1"><a:lumMod val="75000"/></a:schemeClr></a:solidFill>'],
  ['tint 40%', '<a:solidFill><a:schemeClr val="accent2"><a:tint val="40000"/></a:schemeClr></a:solidFill>'],
];

const slide2 = slideXml(
  sp({ x: 24, y: 14, w: 600, h: 34, prst: 'rect', fill: '<a:noFill/>', text: `<a:p><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>效果 · 填充</a:t></a:r></a:p>` }) +
  effectDemos.map(([name, effect, fill], i) =>
    sp({ x: 40 + i * 300, y: 80, w: 190, h: 110, prst: 'roundRect', fill, effect, text: label(name, 1000, 'FFFFFF') })).join('') +
  fillDemos.map(([name, fill], i) => {
    const x = 40 + (i % 4) * 300, y = 260 + Math.floor(i / 4) * 190;
    return sp({ x, y, w: 240, h: 110, prst: 'rect', fill, ln: '<a:ln w="6350"><a:solidFill><a:srgbClr val="999999"/></a:solidFill></a:ln>' }) +
      sp({ x, y: y + 114, w: 240, h: 20, prst: 'rect', fill: '<a:noFill/>', text: label(name, 900) });
  }).join(''),
);

// ---------- 3. 线条与箭头 ----------

const LINE_ENDS = ['triangle', 'stealth', 'diamond', 'oval', 'arrow', 'none'];
const DASHES = ['solid', 'dash', 'dot', 'dashDot', 'lgDash', 'lgDashDotDot', 'sysDash'];

const cxn = (x, y, w, h, ln, prst = 'straightConnector1') =>
  `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="${300 + Math.round(x + y)}" name="c"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>
<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>
<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>${ln}</p:spPr></p:cxnSp>`;

const slide3 = slideXml(
  sp({ x: 24, y: 14, w: 600, h: 34, prst: 'rect', fill: '<a:noFill/>', text: `<a:p><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>线条 · 箭头 · 连接线</a:t></a:r></a:p>` }) +
  LINE_ENDS.map((end, i) => {
    const y = 74 + i * 44;
    const ln = `<a:ln w="28575"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:headEnd type="${end}" w="med" len="med"/><a:tailEnd type="${end}" w="lg" len="lg"/></a:ln>`;
    return cxn(180, y, 320, 0, ln) +
      sp({ x: 24, y: y - 12, w: 150, h: 24, prst: 'rect', fill: '<a:noFill/>', text: label(end, 900) });
  }).join('') +
  DASHES.map((dash, i) => {
    const y = 74 + i * 38;
    const ln = `<a:ln w="19050"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:prstDash val="${dash}"/></a:ln>`;
    return cxn(700, y, 300, 0, ln) +
      sp({ x: 540, y: y - 12, w: 150, h: 24, prst: 'rect', fill: '<a:noFill/>', text: label(dash, 900) });
  }).join('') +
  ['bentConnector2', 'bentConnector3', 'curvedConnector3', 'curvedConnector4'].map((prst, i) =>
    cxn(60 + i * 300, 400, 200, 120, `<a:ln w="22225"><a:solidFill><a:schemeClr val="accent6"/></a:solidFill><a:tailEnd type="triangle"/></a:ln>`, prst) +
    sp({ x: 60 + i * 300, y: 530, w: 200, h: 22, prst: 'rect', fill: '<a:noFill/>', text: label(prst, 900) })).join('') +
  ['flat', 'rnd', 'sq'].map((cap, i) =>
    cxn(100 + i * 320, 620, 220, 0, `<a:ln w="47625" cap="${cap}"><a:solidFill><a:schemeClr val="accent4"/></a:solidFill></a:ln>`) +
    sp({ x: 100 + i * 320, y: 640, w: 220, h: 22, prst: 'rect', fill: '<a:noFill/>', text: label('cap=' + cap, 900) })).join(''),
);

// ---------- 4. 文字特性 ----------

const textPara = (runs, extra = '') => `<a:p>${extra}${runs}</a:p>`;
const run = (t, rPr = '') => `<a:r>${rPr ? `<a:rPr ${rPr.attrs ?? ''}>${rPr.body ?? ''}</a:rPr>` : ''}<a:t>${t}</a:t></a:r>`;

const slide4 = slideXml(
  sp({ x: 24, y: 14, w: 600, h: 34, prst: 'rect', fill: '<a:noFill/>', text: `<a:p><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>文字特性</a:t></a:r></a:p>` }) +
  `<p:sp><p:nvSpPr><p:cNvPr id="401" name="TextFeatures"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(30)}" y="${px(70)}"/><a:ext cx="${px(600)}" cy="${px(400)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
${textPara(run('普通 ') + run('加粗', { attrs: 'b="1"' }) + run(' 斜体', { attrs: 'i="1"' }) + run(' 下划线', { attrs: 'u="sng"' }) + run(' 删除线', { attrs: 'strike="sngStrike"' }), '<a:pPr><a:buNone/></a:pPr>')}
${textPara(run('化学式 H') + run('2', { attrs: 'baseline="-25000"' }) + run('O，数学 x') + run('2', { attrs: 'baseline="30000"' }) + run(' + y') + run('2', { attrs: 'baseline="30000"' }), '<a:pPr><a:buNone/></a:pPr>')}
${textPara(run('宽字间距文本', { attrs: 'spc="600"' }), '<a:pPr><a:buNone/></a:pPr>')}
${textPara(run('all caps text', { attrs: 'cap="all"' }) + run('  |  ') + run('small caps text', { attrs: 'cap="small"' }), '<a:pPr><a:buNone/></a:pPr>')}
${textPara(run('描边文字', { attrs: 'sz="2800" b="1"', body: '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:ln w="12700"><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:ln>' }), '<a:pPr><a:buNone/></a:pPr>')}
${textPara(run('渐变文字效果', { attrs: 'sz="2800" b="1"', body: '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs><a:gs pos="100000"><a:schemeClr val="accent2"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>' }), '<a:pPr><a:buNone/></a:pPr>')}
${textPara(run('高亮标记的文字', { attrs: 'sz="1600"', body: '<a:highlight><a:srgbClr val="FFF176"/></a:highlight>' }), '<a:pPr><a:buNone/></a:pPr>')}
${textPara(run('段落对齐：右对齐', { attrs: 'sz="1400"' }), '<a:pPr algn="r"><a:buNone/></a:pPr>')}
${textPara(run('段落对齐：居中', { attrs: 'sz="1400"' }), '<a:pPr algn="ctr"><a:buNone/></a:pPr>')}
${textPara(run('一级项目符号', { attrs: 'sz="1400"' }), '<a:pPr marL="285750" indent="-285750"><a:buClr><a:schemeClr val="accent2"/></a:buClr><a:buSzPct val="120000"/><a:buChar char="&#9679;"/></a:pPr>')}
${textPara(run('二级项目符号', { attrs: 'sz="1300"' }), '<a:pPr lvl="1" marL="571500" indent="-285750"><a:buChar char="&#9702;"/></a:pPr>')}
${textPara(run('罗马数字编号一', { attrs: 'sz="1300"' }), '<a:pPr marL="342900" indent="-342900"><a:buAutoNum type="romanLcPeriod"/></a:pPr>')}
${textPara(run('罗马数字编号二', { attrs: 'sz="1300"' }), '<a:pPr marL="342900" indent="-342900"><a:buAutoNum type="romanLcPeriod"/></a:pPr>')}
${textPara(run('带括号编号', { attrs: 'sz="1300"' }), '<a:pPr marL="342900" indent="-342900"><a:buAutoNum type="alphaLcParenBoth"/></a:pPr>')}
</p:txBody></p:sp>` +
  // 竖排文字
  `<p:sp><p:nvSpPr><p:cNvPr id="410" name="Vertical"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(680)}" y="${px(70)}"/><a:ext cx="${px(90)}" cy="${px(280)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${solid('accent5')}</p:spPr>
<p:txBody><a:bodyPr vert="eaVert" anchor="ctr"/><a:lstStyle/>
<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1600"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>竖排文字测试</a:t></a:r></a:p>
</p:txBody></p:sp>` +
  // 分栏 + 自动缩放
  `<p:sp><p:nvSpPr><p:cNvPr id="411" name="Cols"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(800)}" y="${px(70)}"/><a:ext cx="${px(450)}" cy="${px(170)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="F5F7FA"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr numCol="2" spcCol="228600"/><a:lstStyle/>
<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr sz="1100"/><a:t>双栏排版：左栏文本会自动流入右栏，用于验证 numCol 与 spcCol 的解析与渲染。</a:t></a:r></a:p>
<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr sz="1100"/><a:t>第二段继续填充，确保分栏高度计算正确。</a:t></a:r></a:p>
</p:txBody></p:sp>` +
  `<p:sp><p:nvSpPr><p:cNvPr id="412" name="AutoFit"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(800)}" y="${px(270)}"/><a:ext cx="${px(450)}" cy="${px(120)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FFF8E1"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr><a:normAutofit fontScale="70000" lnSpcReduction="10000"/></a:bodyPr><a:lstStyle/>
<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr sz="2000"/><a:t>normAutofit：字号缩放到 70%，行距压缩 10%，用于验证自动适应文本框。</a:t></a:r></a:p>
</p:txBody></p:sp>` +
  // 超链接
  `<p:sp><p:nvSpPr><p:cNvPr id="413" name="Links"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(680)}" y="${px(420)}"/><a:ext cx="${px(560)}" cy="${px(90)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/>
<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr sz="1400"><a:hlinkClick xmlns:r="${NS.r}" r:id="rId5"/></a:rPr><a:t>外部超链接（example.com）</a:t></a:r></a:p>
<a:p><a:pPr><a:buNone/></a:pPr><a:r><a:rPr sz="1400"><a:hlinkClick xmlns:r="${NS.r}" r:id="" action="ppaction://hlinkshowjump?jump=firstslide"/></a:rPr><a:t>跳转到第 1 页</a:t></a:r></a:p>
</p:txBody></p:sp>` +
  // 旋转与翻转
  ['rot="1800000"', 'rot="-1800000"', 'flipH', 'flipV'].map((mode, i) => {
    const opts = { x: 30 + i * 150, y: 520, w: 120, h: 70, prst: 'homePlate', fill: solid(`accent${i + 1}`), text: label(mode.replace(/"/g, ''), 800, 'FFFFFF') };
    if (mode.startsWith('rot')) opts.rot = mode.match(/-?\d+/)[0];
    if (mode === 'flipH') opts.flipH = true;
    if (mode === 'flipV') opts.flipV = true;
    return sp(opts);
  }).join(''),
);

// ---------- 5. 表格 ----------

const tcell = (t, opts = {}) => `<a:tc${opts.gridSpan ? ` gridSpan="${opts.gridSpan}"` : ''}${opts.rowSpan ? ` rowSpan="${opts.rowSpan}"` : ''}${opts.hMerge ? ' hMerge="1"' : ''}${opts.vMerge ? ' vMerge="1"' : ''}>
<a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr algn="${opts.algn ?? 'l'}"/><a:r><a:rPr sz="${opts.sz ?? 1200}"${opts.b ? ' b="1"' : ''}>${opts.color ? `<a:solidFill><a:srgbClr val="${opts.color}"/></a:solidFill>` : ''}</a:rPr><a:t>${t}</a:t></a:r></a:p></a:txBody>
<a:tcPr${opts.anchor ? ` anchor="${opts.anchor}"` : ''}>${opts.fill ?? ''}${opts.bdr ?? ''}</a:tcPr></a:tc>`;

const BORDER = (c = '4472C4', w = 12700) => `<a:lnL w="${w}"><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></a:lnL><a:lnR w="${w}"><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></a:lnR><a:lnT w="${w}"><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></a:lnT><a:lnB w="${w}"><a:solidFill><a:srgbClr val="${c}"/></a:solidFill></a:lnB>`;

const tableXml = `<p:graphicFrame>
<p:nvGraphicFramePr><p:cNvPr id="500" name="Table"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(40)}" y="${px(90)}"/><a:ext cx="${px(700)}" cy="${px(360)}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
<a:tbl>
<a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}</a:tableStyleId></a:tblPr>
<a:tblGrid><a:gridCol w="${px(220)}"/><a:gridCol w="${px(160)}"/><a:gridCol w="${px(160)}"/><a:gridCol w="${px(160)}"/></a:tblGrid>
<a:tr h="${px(56)}">
${tcell('功能模块', { b: true, sz: 1300, color: 'FFFFFF', anchor: 'ctr' })}
${tcell('.pptx', { b: true, sz: 1300, color: 'FFFFFF', algn: 'ctr', anchor: 'ctr' })}
${tcell('.ppt', { b: true, sz: 1300, color: 'FFFFFF', algn: 'ctr', anchor: 'ctr' })}
${tcell('备注', { b: true, sz: 1300, color: 'FFFFFF', algn: 'ctr', anchor: 'ctr' })}
</a:tr>
<a:tr h="${px(50)}">${tcell('形状渲染')}${tcell('完整', { algn: 'ctr' })}${tcell('规划中', { algn: 'ctr' })}${tcell('140+ 预设几何')}</a:tr>
<a:tr h="${px(50)}">${tcell('文本排版')}${tcell('完整', { algn: 'ctr' })}${tcell('纯文本', { algn: 'ctr' })}${tcell('含竖排/分栏')}</a:tr>
<a:tr h="${px(50)}">${tcell('跨列合并演示', { gridSpan: 2, fill: '<a:solidFill><a:srgbClr val="E8F0FE"/></a:solidFill>', algn: 'ctr' })}${tcell('', { hMerge: true })}${tcell('自定义边框', { bdr: BORDER('ED7D31', 19050), algn: 'ctr' })}${tcell('粗橙边框')}</a:tr>
<a:tr h="${px(50)}">${tcell('垂直居中', { anchor: 'ctr' })}${tcell('垂直底部', { anchor: 'b' })}${tcell('默认顶部')}${tcell('对齐测试', { algn: 'r' })}</a:tr>
<a:tr h="${px(50)}">${tcell('条纹行验证')}${tcell('band2', { algn: 'ctr' })}${tcell('band1', { algn: 'ctr' })}${tcell('交替底色')}</a:tr>
</a:tbl>
</a:graphicData></a:graphic></p:graphicFrame>`;

const slide5 = slideXml(
  sp({ x: 24, y: 14, w: 600, h: 34, prst: 'rect', fill: '<a:noFill/>', text: `<a:p><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>表格 · 图片</a:t></a:r></a:p>` }) +
  tableXml +
  // 图片：原图 / 裁剪 / 裁进形状 / 半透明 / 灰度
  [
    ['原图', '<a:stretch><a:fillRect/></a:stretch>', 'rect', ''],
    ['裁剪 25%', '<a:srcRect l="25000" t="25000" r="25000" b="25000"/><a:stretch><a:fillRect/></a:stretch>', 'rect', ''],
    ['裁进圆形', '<a:stretch><a:fillRect/></a:stretch>', 'ellipse', ''],
    ['裁进星形', '<a:stretch><a:fillRect/></a:stretch>', 'star5', ''],
  ].map(([name, fillMod, prst], i) => {
    const x = 790, y = 90 + i * 145;
    return `<p:pic>
<p:nvPicPr><p:cNvPr id="${520 + i}" name="${name}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/>${fillMod}</p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(160)}" cy="${px(120)}"/></a:xfrm>
<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom></p:spPr></p:pic>` +
      sp({ x: x + 175, y: y + 45, w: 140, h: 30, prst: 'rect', fill: '<a:noFill/>', text: label(name, 1000) });
  }).join('') +
  // 图片填充形状 + 平铺
  sp({ x: 1090, y: 90, w: 150, h: 120, prst: 'roundRect', fill: `<a:blipFill><a:blip r:embed="rId2"/><a:srcRect l="20000" t="20000" r="20000" b="20000"/><a:stretch><a:fillRect/></a:stretch></a:blipFill>` }) +
  sp({ x: 1090, y: 235, w: 150, h: 120, prst: 'rect', fill: `<a:blipFill><a:blip r:embed="rId2"><a:alphaModFix amt="45000"/></a:blip><a:tile sx="30000" sy="30000"/></a:blipFill>` }) +
  sp({ x: 1090, y: 380, w: 150, h: 30, prst: 'rect', fill: '<a:noFill/>', text: label('平铺+透明', 900) }) +
  sp({ x: 40, y: 480, w: 700, h: 30, prst: 'rect', fill: '<a:noFill/>', text: label('表格样式：首行强调 + 条纹行 + 合并单元格 + 自定义边框 + 垂直对齐', 1000) }),
);

// ---------- 6. custGeom / 组合 / 嵌套 ----------

const custShape = `<p:sp><p:nvSpPr><p:cNvPr id="600" name="CustGeomFormula"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(60)}" y="${px(90)}"/><a:ext cx="${px(260)}" cy="${px(260)}"/></a:xfrm>
<a:custGeom>
<a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst>
<a:gdLst>
<a:gd name="r1" fmla="*/ w 1 2"/>
<a:gd name="r2" fmla="*/ h 1 2"/>
<a:gd name="ir" fmla="*/ r1 adj 100000"/>
<a:gd name="q" fmla="*/ w 1 4"/>
</a:gdLst>
<a:pathLst><a:path w="1000" h="1000">
<a:moveTo><a:pt x="500" y="0"/></a:moveTo>
<a:cubicBezTo><a:pt x="780" y="0"/><a:pt x="1000" y="220"/><a:pt x="1000" y="500"/></a:cubicBezTo>
<a:cubicBezTo><a:pt x="1000" y="780"/><a:pt x="780" y="1000"/><a:pt x="500" y="1000"/></a:cubicBezTo>
<a:lnTo><a:pt x="500" y="700"/></a:lnTo>
<a:cubicBezTo><a:pt x="610" y="700"/><a:pt x="700" y="610"/><a:pt x="700" y="500"/></a:cubicBezTo>
<a:cubicBezTo><a:pt x="700" y="390"/><a:pt x="610" y="300"/><a:pt x="500" y="300"/></a:cubicBezTo>
<a:close/>
</a:path></a:pathLst></a:custGeom>
${solid('accent1')}</p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;

const arcShape = `<p:sp><p:nvSpPr><p:cNvPr id="601" name="CustArc"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(360)}" y="${px(90)}"/><a:ext cx="${px(260)}" cy="${px(260)}"/></a:xfrm>
<a:custGeom><a:avLst/><a:gdLst/>
<a:pathLst><a:path w="200" h="200" stroke="1" fill="none">
<a:moveTo><a:pt x="100" y="0"/></a:moveTo>
<a:arcTo wR="100" hR="100" stAng="16200000" swAng="16200000"/>
<a:lnTo><a:pt x="100" y="100"/></a:lnTo>
</a:path></a:pathLst></a:custGeom>
<a:ln w="38100"><a:solidFill><a:schemeClr val="accent2"/></a:solidFill><a:tailEnd type="triangle" w="lg" len="lg"/></a:ln></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;

const nestedGroup = `<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="610" name="Outer"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="900000"><a:off x="${px(680)}" y="${px(90)}"/><a:ext cx="${px(520)}" cy="${px(260)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(260)}" cy="${px(130)}"/></a:xfrm></p:grpSpPr>
${sp({ x: 0, y: 0, w: 120, h: 130, prst: 'roundRect', fill: solid('accent5'), text: label('外层 A', 900, 'FFFFFF') })}
<p:grpSp>
<p:nvGrpSpPr><p:cNvPr id="611" name="Inner"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="${px(140)}" y="${px(10)}"/><a:ext cx="${px(120)}" cy="${px(110)}"/><a:chOff x="0" y="0"/><a:chExt cx="${px(60)}" cy="${px(55)}"/></a:xfrm></p:grpSpPr>
${sp({ x: 0, y: 0, w: 60, h: 25, prst: 'ellipse', fill: solid('accent6'), text: label('内层1', 700, 'FFFFFF') })}
${sp({ x: 0, y: 30, w: 60, h: 25, prst: 'ellipse', fill: solid('accent4'), text: label('内层2', 700, 'FFFFFF') })}
</p:grpSp>
</p:grpSp>`;

const slide6 = slideXml(
  sp({ x: 24, y: 14, w: 700, h: 34, prst: 'rect', fill: '<a:noFill/>', text: `<a:p><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>自定义几何 · 组合嵌套 · 调节值</a:t></a:r></a:p>` }) +
  custShape + arcShape + nestedGroup +
  sp({ x: 60, y: 360, w: 260, h: 24, prst: 'rect', fill: '<a:noFill/>', text: label('custGeom + gdLst 公式', 900) }) +
  sp({ x: 360, y: 360, w: 260, h: 24, prst: 'rect', fill: '<a:noFill/>', text: label('custGeom arcTo + 箭头（开放路径）', 900) }) +
  sp({ x: 680, y: 360, w: 520, h: 24, prst: 'rect', fill: '<a:noFill/>', text: label('嵌套组合 + 组旋转 + 子坐标系缩放', 900) }) +
  // 调节值变化
  [10000, 25000, 45000].map((adj, i) =>
    sp({ x: 60 + i * 150, y: 410, w: 120, h: 100, prst: 'roundRect', avLst: `<a:gd name="adj" fmla="val ${adj}"/>`, fill: solid('accent1'), text: label(`adj ${adj / 1000}%`, 800, 'FFFFFF') })).join('') +
  [10000, 30000, 48000].map((adj, i) =>
    sp({ x: 540 + i * 150, y: 410, w: 120, h: 100, prst: 'donut', avLst: `<a:gd name="adj" fmla="val ${adj}"/>`, fill: solid('accent2') })).join('') +
  [[0, 90], [45, 270], [180, 90]].map(([st, sw], i) =>
    sp({ x: 60 + i * 150, y: 545, w: 120, h: 110, prst: 'pie', avLst: `<a:gd name="adj1" fmla="val ${st * 60000}"/><a:gd name="adj2" fmla="val ${(st + sw) * 60000}"/>`, fill: solid('accent4') })).join('') +
  [[180, 90], [225, 270]].map(([st, sw], i) =>
    sp({ x: 540 + i * 150, y: 545, w: 120, h: 110, prst: 'blockArc', avLst: `<a:gd name="adj1" fmla="val ${st * 60000}"/><a:gd name="adj2" fmla="val ${(st + sw) * 60000}"/><a:gd name="adj3" fmla="val 25000"/>`, fill: solid('accent6') })).join('') +
  sp({ x: 60, y: 665, w: 620, h: 24, prst: 'rect', fill: '<a:noFill/>', text: label('调节值：roundRect / donut / pie / blockArc', 900) }),
);

// ---------- 7. 立体效果 + 动画 ----------

const sp3d = (extrusionH, bevel, contour, material, rot) =>
  `<a:scene3d><a:camera prst="orthographicFront"${rot ? `><a:rot lat="${rot[1] * 60000}" lon="0" rev="${rot[0] * 60000}"/></a:camera>` : '/>'}` +
  `<a:lightRig rig="threePt" dir="t"/></a:scene3d>` +
  `<a:sp3d extrusionH="${extrusionH}"${contour ? ` contourW="${contour}"` : ''}${material ? ` prstMaterial="${material}"` : ''}>` +
  `<a:extrusionClr><a:schemeClr val="accent1"><a:shade val="60000"/></a:schemeClr></a:extrusionClr>` +
  (contour ? `<a:contourClr><a:schemeClr val="tx2"/></a:contourClr>` : '') +
  (bevel ? `<a:bevelT w="${bevel}" h="${bevel}" prst="circle"/>` : '') +
  `</a:sp3d>`;

const D3_DEMOS = [
  ['挤出 6pt', sp3d(76200, 0, 0, null, null), 'roundRect', 'accent1'],
  ['挤出 12pt', sp3d(152400, 0, 0, null, null), 'roundRect', 'accent2'],
  ['挤出 + 斜角', sp3d(114300, 76200, 0, null, null), 'ellipse', 'accent6'],
  ['挤出 + 轮廓', sp3d(114300, 0, 25400, null, null), 'hexagon', 'accent4'],
  ['金属材质', sp3d(114300, 50800, 0, 'metal', null), 'roundRect', 'accent5'],
  ['旋转视角', sp3d(152400, 50800, 0, null, [10, 60]), 'cube', 'accent2'],
];

const ANIM_SHAPES = [
  [701, '飞入 ←', 'accent1'],
  [702, '淡入', 'accent2'],
  [703, '擦除 ↓', 'accent6'],
  [704, '缩放', 'accent4'],
  [705, '旋转', 'accent5'],
];

const slide7 = slideXml(
  sp({ x: 24, y: 14, w: 700, h: 34, prst: 'rect', fill: '<a:noFill/>', text: `<a:p><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>立体效果 · 动画</a:t></a:r></a:p>` }) +
  D3_DEMOS.map(([name, scene, prst, accent], i) => {
    const x = 50 + (i % 3) * 260, y = 80 + Math.floor(i / 3) * 200;
    return sp({ x, y, w: 170, h: 110, prst, fill: solid(accent), effect: scene, name }) +
      sp({ x, y: y + 122, w: 170, h: 22, prst: 'rect', fill: '<a:noFill/>', text: label(name, 900) });
  }).join('') +
  sp({ x: 830, y: 80, w: 400, h: 26, prst: 'rect', fill: '<a:noFill/>', text: label('下面 5 个方块带入场动画（演示模式逐次点击）', 1000) }) +
  ANIM_SHAPES.map(([id, name, accent], i) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="anim${i}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(840)}" y="${px(130 + i * 92)}"/><a:ext cx="${px(380)}" cy="${px(72)}"/></a:xfrm>
<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${solid(accent)}</p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${name}</a:t></a:r></a:p></p:txBody></p:sp>`).join(''),
);

/** 逐个点击触发的入场动画时间树 */
const ANIM_TIMING = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>
<p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>
${[[701, 2, 8, 'slide(fromLeft)'], [702, 10, 0, 'fade'], [703, 21, 4, 'wipe(up)'], [704, 22, 16, 'box(in)'], [705, 15, 0, 'fade']]
  .map(([spid, presetID, subtype, filter], i) => `
<p:par><p:cTn id="${10 + i * 3}" fill="hold" nodeType="clickEffect">
<p:stCondLst><p:cond delay="indefinite"/></p:stCondLst>
<p:childTnLst><p:par><p:cTn id="${11 + i * 3}" presetID="${presetID}" presetClass="entr" presetSubtype="${subtype}" fill="hold" nodeType="clickEffect">
<p:stCondLst><p:cond delay="0"/></p:stCondLst>
<p:childTnLst>
<p:set><p:cBhvr><p:cTn id="${12 + i * 3}" dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>
<p:animEffect transition="in" filter="${filter}"><p:cBhvr><p:cTn dur="600"/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>
</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`).join('')}
</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;

const slide7WithTiming = slide7.replace('</p:sld>', `${ANIM_TIMING}</p:sld>`);

// ---------- 骨架 ----------

/** 每页配一种切换效果 */
const TRANSITIONS = [
  '<p:transition spd="med"><p:fade/></p:transition>',
  '<p:transition spd="med"><p:push dir="l"/></p:transition>',
  '<p:transition spd="med"><p:wipe dir="d"/></p:transition>',
  '<p:transition spd="fast"><p:cover dir="u"/></p:transition>',
  '<p:transition spd="med"><p:split orient="horz" dir="out"/></p:transition>',
  '<p:transition spd="med"><p:zoom dir="in"/></p:transition>',
  '<p:transition spd="slow"><p:dissolve/></p:transition>',
];

const SLIDES = [slide1, slide2, slide3, slide4, slide5, slide6, slide7WithTiming]
  .map((xml, i) => xml.replace('<p:clrMapOvr>', `${TRANSITIONS[i] ?? ''}<p:clrMapOvr>`));

const contentTypes = `${XML}<Types xmlns="${NS.ct}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Default Extension="png" ContentType="image/png"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
<Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>
${SLIDES.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('\n')}
${SLIDES.map((_, i) => `<Override PartName="/ppt/notesSlides/notesSlide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"/>`).join('\n')}
<Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
</Types>`;

const rootRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;

const presentation = `${XML}<p:presentation xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst>
<p:sldIdLst>${SLIDES.map((_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 2}"/>`).join('')}</p:sldIdLst>
<p:sldSz cx="${px(W)}" cy="${px(H)}"/>
<p:notesSz cx="6858000" cy="9144000"/>
<p:defaultTextStyle><a:defPPr><a:defRPr sz="1800"/></a:defPPr></p:defaultTextStyle>
</p:presentation>`;

const presentationRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>
${SLIDES.map((_, i) => `<Relationship Id="rId${i + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('\n')}
<Relationship Id="rId${SLIDES.length + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles" Target="tableStyles.xml"/>
</Relationships>`;

const theme = `${XML}<a:theme xmlns:a="${NS.a}" name="Showcase">
<a:themeElements>
<a:clrScheme name="Showcase">
<a:dk1><a:sysClr val="windowText" lastClr="1A1A1A"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="EEF3FB"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
<a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Showcase">
<a:majorFont><a:latin typeface="Trebuchet MS"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Helvetica"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Showcase">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"><a:tint val="60000"/></a:schemeClr></a:gs><a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="80000"/></a:schemeClr></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>
<a:solidFill><a:schemeClr val="phClr"><a:shade val="90000"/></a:schemeClr></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst><a:outerShdw blurRad="57150" dist="19050" dir="5400000"><a:srgbClr val="000000"><a:alpha val="35000"/></a:srgbClr></a:outerShdw></a:effectLst></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`;

const slideMaster = `${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld>
<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree>${nvGrp}
${sp({ x: 0, y: H - 6, w: W, h: 6, prst: 'rect', fill: solid('accent1') })}
<p:sp><p:nvSpPr><p:cNvPr id="90" name="SlideNumber"/><p:cNvSpPr/><p:nvPr><p:ph type="sldNum" sz="quarter" idx="12"/></p:nvPr></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(W - 110)}" y="${px(H - 44)}"/><a:ext cx="${px(80)}" cy="${px(28)}"/></a:xfrm></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="r"/><a:fld id="{B2E8F1A0-1111-4A2B-9C3D-000000000001}" type="slidenum"><a:rPr sz="1100"><a:solidFill><a:srgbClr val="888888"/></a:solidFill></a:rPr><a:t>1</a:t></a:fld></a:p></p:txBody></p:sp>
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles>
<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill><a:latin typeface="+mj-lt"/><a:ea typeface="+mj-ea"/></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle>
<a:lvl1pPr marL="285750" indent="-285750"><a:spcBef><a:spcPts val="400"/></a:spcBef><a:buChar char="&#8226;"/><a:defRPr sz="1600"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill><a:latin typeface="+mn-lt"/><a:ea typeface="+mn-ea"/></a:defRPr></a:lvl1pPr>
<a:lvl2pPr marL="571500" indent="-285750"><a:buChar char="&#8211;"/><a:defRPr sz="1400"/></a:lvl2pPr>
</p:bodyStyle>
<p:otherStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:otherStyle>
</p:txStyles>
</p:sldMaster>`;

const slideMasterRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>
</Relationships>`;

const slideLayout = `${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj">
<p:cSld name="Blank"><p:spTree>${nvGrp}</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const slideLayoutRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const tableStyles = `${XML}<a:tblStyleLst xmlns:a="${NS.a}" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}">
<a:tblStyle styleId="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}" styleName="Medium Style 2 - Accent 1">
<a:wholeTbl>
<a:tcTxStyle><a:fontRef idx="minor"><a:scrgbClr r="0" g="0" b="0"/></a:fontRef><a:schemeClr val="dk1"/></a:tcTxStyle>
<a:tcStyle><a:tcBdr>
<a:left><a:ln w="12700" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:left>
<a:right><a:ln w="12700" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:right>
<a:top><a:ln w="12700" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:top>
<a:bottom><a:ln w="12700" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:bottom>
</a:tcBdr><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="20000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle>
</a:wholeTbl>
<a:band1H><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="accent1"><a:tint val="40000"/></a:schemeClr></a:solidFill></a:fill></a:tcStyle></a:band1H>
<a:band2H><a:tcStyle><a:tcBdr/><a:fill><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:fill></a:tcStyle></a:band2H>
<a:firstRow>
<a:tcTxStyle b="on"><a:fontRef idx="minor"><a:scrgbClr r="0" g="0" b="0"/></a:fontRef><a:schemeClr val="lt1"/></a:tcTxStyle>
<a:tcStyle><a:tcBdr><a:bottom><a:ln w="38100" cmpd="sng"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></a:bottom></a:tcBdr>
<a:fill><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:fill></a:tcStyle>
</a:firstRow>
</a:tblStyle>
</a:tblStyleLst>`;

const NOTES = [
  '形状库：验证 140+ 预设几何的 path 生成，任何一个渲染成矩形都说明该形状未实现。',
  '效果与填充：阴影 / 发光 / 柔化边缘走 SVG filter，渐变与图案走 defs。',
  '线条：线端箭头用 SVG marker，虚线按线宽缩放 dasharray。',
  '文字：上下标 / 字间距 / 大小写 / 描边 / 渐变 / 高亮 / 竖排 / 分栏 / 自动缩放 / 超链接。',
  '表格：tableStyles.xml 的首行、条纹行解析，合并单元格与自定义边框。',
  '自定义几何：gdLst 公式求值、arcTo、嵌套组合的子坐标系缩放。',
  '立体效果按等轴测风格近似（挤出 + 斜角高光 + 轮廓）；右侧 5 个方块带逐次点击的入场动画，需在演示模式下查看。',
];

const notesSlide = (i) => `${XML}<p:notes xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld><p:spTree>${nvGrp}
<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1200"/><a:t>${NOTES[i]}</a:t></a:r></a:p></p:txBody></p:sp>
</p:spTree></p:cSld></p:notes>`;

const slideRels = (i) => {
  const rels = [`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`];
  rels.push(`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>`);
  rels.push(`<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide${i + 1}.xml"/>`);
  rels.push(`<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>`);
  return `${XML}<Relationships xmlns="${NS.rel}">${rels.join('\n')}</Relationships>`;
};

const entries = [
  ['[Content_Types].xml', contentTypes],
  ['_rels/.rels', rootRels],
  ['ppt/presentation.xml', presentation],
  ['ppt/_rels/presentation.xml.rels', presentationRels],
  ['ppt/theme/theme1.xml', theme],
  ['ppt/tableStyles.xml', tableStyles],
  ['ppt/slideMasters/slideMaster1.xml', slideMaster],
  ['ppt/slideMasters/_rels/slideMaster1.xml.rels', slideMasterRels],
  ['ppt/slideLayouts/slideLayout1.xml', slideLayout],
  ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', slideLayoutRels],
  ['ppt/media/image1.png', image1],
];
SLIDES.forEach((xml, i) => {
  entries.push([`ppt/slides/slide${i + 1}.xml`, xml]);
  entries.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, slideRels(i)]);
  entries.push([`ppt/notesSlides/notesSlide${i + 1}.xml`, notesSlide(i)]);
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
const zip = makeZip(entries);
writeFileSync(join(root, 'fixtures/showcase.pptx'), zip);
console.log(`fixtures/showcase.pptx 已生成（${SLIDES.length} 页，${SHAPES.length} 个形状，${(zip.length / 1024).toFixed(1)} KB）`);
