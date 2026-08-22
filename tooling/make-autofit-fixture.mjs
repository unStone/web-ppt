/**
 * 生成 fixtures/sample-autofit.pptx —— 文本自动缩放回归文件。
 *
 * `<a:normAutofit/>` 不带 fontScale 时，缩放比例要由渲染器自己算。
 * 实测 8 个真实演讲文件里共 229 处裸 normAutofit、仅 39 处带 fontScale，
 * 而在此之前所有固件一处裸 normAutofit 都没有 —— 这条分支从未被测过。
 *
 * 四种情形各一页：
 *   1 溢出 + 裸 normAutofit      → 应缩小到放得下
 *   2 放得下 + 裸 normAutofit    → 不应缩小
 *   3 溢出 + 无 autofit          → 应照常溢出（规范默认 noAutofit）
 *   4 溢出 + 显式 fontScale=50%  → 用文件里的值，不再自行计算
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { label, makeZip, NS, nvGrp, px, slideXml, solid, sp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280, H = 720;

/** 一段够长、在 420×140 的框里按 2000(20pt) 必然溢出的文字 */
const LONG =
  '<a:p><a:r><a:rPr sz="2000"/><a:t>自动缩放回归：这一段文字在给定的文本框里按标称字号排版必定溢出，'
  + '渲染器应当自行计算缩放比例把它塞进框内，而不是让它溢出到版面之外。真实演讲文件里'
  + '大量文本框只写了裸的 normAutofit 而不带 fontScale，PowerPoint 与 LibreOffice 都会'
  + '自行计算缩放；若照标称字号渲染，整段文字会盖住下方内容甚至跑出版面。</a:t></a:r></a:p>';
/** 同样的框里放得下的短文字 */
const SHORT = '<a:p><a:r><a:rPr sz="2000"/><a:t>短文字，放得下</a:t></a:r></a:p>';

const BOX = { x: 60, y: 180, w: 420, h: 140 };

/** 两段同样的文字，一段 150% 百分比行距、一段 24pt 绝对行距 */
const SPACED =
  '<a:p><a:pPr><a:lnSpc><a:spcPct val="150000"/></a:lnSpc></a:pPr>'
  + '<a:r><a:rPr sz="1400"/><a:t>百分比行距 150%：这一段有三行，用来验证行高的基准是字体行高而不是字号。</a:t></a:r></a:p>'
  + '<a:p><a:pPr><a:lnSpc><a:spcPts val="2400"/></a:lnSpc></a:pPr>'
  + '<a:r><a:rPr sz="1400"/><a:t>绝对行距 24pt：同样三行，换算方式与百分比行距不同。</a:t></a:r></a:p>';

const page = (title, text, bodyPr) => slideXml(
  sp({
    x: 40, y: 60, w: W - 80, h: 60, prst: 'rect', fill: '<a:noFill/>',
    text: `<a:p><a:r><a:rPr sz="2400" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>${title}</a:t></a:r></a:p>`,
  }) + sp({
    ...BOX, prst: 'rect', fill: solid('accent1'), name: 'target',
    bodyPr, text,
  }) + sp({
    x: 520, y: 180, w: 400, h: 140, prst: 'rect', fill: '<a:noFill/>',
    text: label('左侧框 420×140，标称 20pt', 900, '606060'),
  }),
);

const PAGES = [
  ['溢出 + 裸 normAutofit → 应缩小', LONG, '<a:bodyPr><a:normAutofit/></a:bodyPr>'],
  ['放得下 + 裸 normAutofit → 不缩', SHORT, '<a:bodyPr><a:normAutofit/></a:bodyPr>'],
  ['溢出 + 无 autofit → 照常溢出', LONG, '<a:bodyPr/>'],
  ['溢出 + 显式 fontScale 50% → 用文件值', LONG, '<a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr>'],
  // 极端长文本：想塞进去需要缩到 25% 以下，用来验证下限确实生效
  ['远超容量 → 缩到 25% 下限为止', LONG.replace('</a:t>', '重复'.repeat(1500) + '</a:t>'),
    '<a:bodyPr><a:normAutofit/></a:bodyPr>'],
  // 行距：spcPct 是「单倍行距」的百分比，而单倍行距是字体行高（≈1.2em）不是字号。
  // 把 150% 直接当 CSS line-height:1.5 用，每行会矮两成；spcPts 则是绝对点值，
  // 两条必须走不同的换算，放在一页里对照着看。
  ['行距 150% (spcPct) 与 24pt (spcPts) 对照', SPACED, '<a:bodyPr/>'],
];
const SLIDES = PAGES.map(([t, txt, bp]) => page(t, txt, bp));

const contentTypes = `${XML}<Types xmlns="${NS.ct}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
${SLIDES.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join('\n')}
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
</Relationships>`;

const theme = `${XML}<a:theme xmlns:a="${NS.a}" name="Autofit">
<a:themeElements>
<a:clrScheme name="Autofit">
<a:dk1><a:sysClr val="windowText" lastClr="1A1A1A"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2>
<a:accent1><a:srgbClr val="2E75B6"/></a:accent1><a:accent2><a:srgbClr val="A6A6A6"/></a:accent2>
<a:accent3><a:srgbClr val="70AD47"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="ED7D31"/></a:accent5><a:accent6><a:srgbClr val="7030A0"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Autofit">
<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Autofit">
<a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst><a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme>
</a:themeElements>
</a:theme>`;

const slideMaster = `${XML}<p:sldMaster xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}">
<p:cSld>
<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>
<p:spTree>${nvGrp}</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
<p:txStyles>
<p:titleStyle><a:lvl1pPr algn="l"><a:defRPr sz="3200" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:defRPr></a:lvl1pPr></p:titleStyle>
<p:bodyStyle><a:lvl1pPr><a:buNone/><a:defRPr sz="1600"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:bodyStyle>
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

const slideRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
</Relationships>`;

const entries = [
  ['[Content_Types].xml', contentTypes],
  ['_rels/.rels', rootRels],
  ['ppt/presentation.xml', presentation],
  ['ppt/_rels/presentation.xml.rels', presentationRels],
  ['ppt/theme/theme1.xml', theme],
  ['ppt/slideMasters/slideMaster1.xml', slideMaster],
  ['ppt/slideMasters/_rels/slideMaster1.xml.rels', slideMasterRels],
  ['ppt/slideLayouts/slideLayout1.xml', slideLayout],
  ['ppt/slideLayouts/_rels/slideLayout1.xml.rels', slideLayoutRels],
];
SLIDES.forEach((xml, i) => {
  entries.push([`ppt/slides/slide${i + 1}.xml`, xml]);
  entries.push([`ppt/slides/_rels/slide${i + 1}.xml.rels`, slideRels]);
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
const zip = makeZip(entries);
writeFileSync(join(root, 'fixtures/sample-autofit.pptx'), zip);
console.log(`fixtures/sample-autofit.pptx 已生成（${SLIDES.length} 页，${(zip.length / 1024).toFixed(1)} KB）`);
