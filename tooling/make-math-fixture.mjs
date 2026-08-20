/** 生成 fixtures/sample-math.pptx —— 覆盖 OMML 各类结构的公式样本 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, label, slideXml, sp, px } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280, H = 720;

const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const r = (t, sty) => `<m:r>${sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : ''}<m:t>${t}</m:t></m:r>`;
const e = (inner) => `<m:e>${inner}</m:e>`;

/** 每个样本：标题 + 一段 OMML */
const CASES = [
  ['分式', `<m:f><m:num>${r('a')}${r('+', 'p')}${r('b')}</m:num><m:den>${r('2', 'p')}${r('c')}</m:den></m:f>`],
  ['根式', `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${e(`${r('x')}<m:sSup>${e(r('y'))}<m:sup>${r('2', 'p')}</m:sup></m:sSup>`)}</m:rad>`],
  ['n 次根', `<m:rad><m:deg>${r('3', 'p')}</m:deg>${e(`${r('x')}${r('+', 'p')}${r('1', 'p')}`)}</m:rad>`],
  ['上下标', `<m:sSubSup>${e(r('A'))}<m:sub>${r('i')}</m:sub><m:sup>${r('2', 'p')}</m:sup></m:sSubSup>`],
  ['求和', `<m:nary><m:naryPr><m:chr m:val="∑"/><m:limLoc m:val="undOvr"/></m:naryPr>` +
    `<m:sub>${r('i')}${r('=', 'p')}${r('1', 'p')}</m:sub><m:sup>${r('n')}</m:sup>` +
    `${e(`<m:sSub>${e(r('x'))}<m:sub>${r('i')}</m:sub></m:sSub>`)}</m:nary>`],
  ['积分', `<m:nary><m:naryPr><m:chr m:val="∫"/><m:limLoc m:val="subSup"/></m:naryPr>` +
    `<m:sub>${r('0', 'p')}</m:sub><m:sup>${r('∞', 'p')}</m:sup>` +
    `${e(`<m:sSup>${e(r('e'))}<m:sup>${r('−', 'p')}${r('x')}</m:sup></m:sSup>${r('d', 'p')}${r('x')}`)}</m:nary>`],
  ['括号自适应', `<m:d>${e(`<m:f><m:num>${r('1', 'p')}</m:num><m:den>${r('n')}</m:den></m:f>`)}</m:d>`],
  ['多参数括号', `<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr>${e(r('a'))}${e(r('b'))}${e(r('c'))}</m:d>`],
  ['矩阵', `<m:d>${e(`<m:m><m:mr>${e(r('a'))}${e(r('b'))}</m:mr><m:mr>${e(r('c'))}${e(r('d'))}</m:mr></m:m>`)}</m:d>`],
  ['重音', `<m:acc><m:accPr><m:chr m:val="⃗"/></m:accPr>${e(r('v'))}</m:acc>${r('·', 'p')}<m:bar>${e(`${r('x')}${r('y')}`)}</m:bar>`],
  ['极限', `<m:func><m:fName><m:limLow>${e(r('lim', 'p'))}<m:lim>${r('n')}${r('→', 'p')}${r('∞', 'p')}</m:lim></m:limLow></m:fName>${e(`<m:sSub>${e(r('a'))}<m:sub>${r('n')}</m:sub></m:sSub>`)}</m:func>`],
  ['嵌套分式', `<m:f><m:num>${r('1', 'p')}</m:num><m:den>${r('1', 'p')}${r('+', 'p')}<m:f><m:num>${r('1', 'p')}</m:num><m:den>${r('x')}</m:den></m:f></m:den></m:f>`],
];

const COLS = 4, CELL_W = 300, CELL_H = 150;

const gallery = CASES.map(([name, omml], i) => {
  const x = 30 + (i % COLS) * CELL_W;
  const y = 90 + Math.floor(i / COLS) * CELL_H;
  return (
    sp({ x, y, w: CELL_W - 20, h: 24, prst: 'rect', fill: '<a:noFill/>', text: label(name, 1000, '666666') }) +
    `<p:sp><p:nvSpPr><p:cNvPr id="${900 + i}" name="math-${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y + 26)}"/><a:ext cx="${px(CELL_W - 20)}" cy="${px(CELL_H - 46)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>
<a:ln w="9525"><a:solidFill><a:srgbClr val="DDDDDD"/></a:solidFill></a:ln></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><m:oMathPara ${M}><m:oMath>${omml}</m:oMath></m:oMathPara></a:p></p:txBody></p:sp>`
  );
}).join('');

// 行内公式：正文与公式混排，检验基线对齐与断行
const inline = `<p:sp><p:nvSpPr><p:cNvPr id="990" name="inline"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(30)}" y="${px(560)}"/><a:ext cx="${px(1220)}" cy="${px(120)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr wrap="square"/><a:lstStyle/><a:p><a:pPr algn="l"/>
<a:r><a:rPr sz="1600"/><a:t>行内混排：当 </a:t></a:r>
<m:oMath ${M}><m:sSup>${e(r('x'))}<m:sup>${r('2', 'p')}</m:sup></m:sSup>${r('+', 'p')}<m:sSup>${e(r('y'))}<m:sup>${r('2', 'p')}</m:sup></m:sSup>${r('=', 'p')}<m:sSup>${e(r('r'))}<m:sup>${r('2', 'p')}</m:sup></m:sSup></m:oMath>
<a:r><a:rPr sz="1600"/><a:t> 时，半径为 </a:t></a:r>
<m:oMath ${M}><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${e(`<m:sSup>${e(r('x'))}<m:sup>${r('2', 'p')}</m:sup></m:sSup>${r('+', 'p')}<m:sSup>${e(r('y'))}<m:sup>${r('2', 'p')}</m:sup></m:sSup>`)}</m:rad></m:oMath>
<a:r><a:rPr sz="1600"/><a:t> ，这是圆的方程。</a:t></a:r>
</a:p></p:txBody></p:sp>`;

const slide = slideXml(
  sp({ x: 30, y: 20, w: 800, h: 40, prst: 'rect', fill: '<a:noFill/>', text: `<a:p><a:r><a:rPr sz="2000" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>OMML 数学公式（${CASES.length} 种结构）</a:t></a:r></a:p>` }) +
  gallery + inline,
);

const zip = deck({ name: 'Math', width: W, height: H, slides: [slide] });
writeFileSync(join(root, 'fixtures/sample-math.pptx'), zip);
console.log(`fixtures/sample-math.pptx 已生成（${CASES.length} 种结构 + 行内混排，${(zip.length / 1024).toFixed(1)} KB）`);
