/**
 * 生成 fixtures/hardcases.pptx —— 官网「疑难杂症」一节的正确侧。
 *
 * 每页只放一个坑对应的图形，页序与官网卡片一一对应，改动时两边要同步。
 * 这些坑都是实际踩过并写进 AGENTS.md 的，不是编出来的教学例子。
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, px, slideXml, sp } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 480, H = 300;

const M = 'xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const r = (t, sty) => `<m:r>${sty ? `<m:rPr><m:sty m:val="${sty}"/></m:rPr>` : ''}<m:t>${t}</m:t></m:r>`;
const e = (inner) => `<m:e>${inner}</m:e>`;

/** 单个公式占满整页 */
const mathSlide = (omml, id) => slideXml(
  `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="case"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${px(W)}" cy="${px(H)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/>
<a:lstStyle><a:lvl1pPr algn="ctr"><a:defRPr sz="4400"/></a:lvl1pPr></a:lstStyle>
<a:p><a:pPr algn="ctr"/>
<m:oMathPara ${M}><m:oMath>${omml}</m:oMath></m:oMathPara></a:p></p:txBody></p:sp>`,
);

/** 单个预设形状占满整页 */
const shapeSlide = (prst, fill, ln, id) => slideXml(sp({
  x: 40, y: 30, w: W - 80, h: H - 100, prst, fill, ln, name: prst,
}));

const CASES = [
  // 1 组合附加符号：U+20D7 / U+0305 单独绘制时会漂移或画成点状圈
  mathSlide(`<m:acc><m:accPr><m:chr m:val="⃗"/></m:accPr>${e(r('v'))}</m:acc>` +
    `${r('·', 'p')}<m:bar>${e(`${r('x')}${r('y')}`)}</m:bar>`, 801),

  // 2 可伸缩定界符：矩阵整体压在数学轴上，上下不对称
  mathSlide(`<m:d>${e(`<m:m><m:mr>${e(r('a'))}${e(r('b'))}</m:mr><m:mr>${e(r('c'))}${e(r('d'))}</m:mr></m:m>`)}</m:d>`, 802),

  // 3 分数线压数学轴而非基线，嵌套时才看得出差别
  mathSlide(`<m:f><m:num>${r('1', 'p')}</m:num><m:den>${r('1', 'p')}${r('+', 'p')}` +
    `<m:f><m:num>${r('1', 'p')}</m:num><m:den>${r('x')}</m:den></m:f></m:den></m:f>`, 803),

  // 4 标注引线：三点开放子路径会被 fill 补成实心楔形
  shapeSlide('borderCallout2', '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>',
    '<a:ln w="19050"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:ln>', 804),

  // 5 云形：重叠椭圆在 evenodd 下互相挖空，必须走单条闭合轮廓
  shapeSlide('cloud', '<a:solidFill><a:schemeClr val="accent3"/></a:solidFill>',
    '<a:ln w="12700"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:ln>', 805),

  // 6 环形/禁止符：内圈要反向绕才挖得出洞
  shapeSlide('noSmoking', '<a:solidFill><a:schemeClr val="accent5"/></a:solidFill>',
    '<a:ln w="12700"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:ln>', 806),
];

const zip = deck({ name: 'HardCases', width: W, height: H, slides: CASES });
writeFileSync(join(root, 'fixtures/hardcases.pptx'), zip);
console.log(`fixtures/hardcases.pptx 已生成（${CASES.length} 个案例，${(zip.length / 1024).toFixed(1)} KB）`);
