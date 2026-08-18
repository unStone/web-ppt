/** 生成 fixtures/sample-effects.pptx —— 阴影 / 内阴影 / 发光 / 柔化 / 倒影 / 艺术字变形 / RTL 回归文件 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { label, makeZip, NS, nextShapeId, nvGrp, px, slideXml, solid, sp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280, H = 720;

const title = (t, sub = '') =>
  sp({
    x: 24, y: 10, w: 900, h: 40, prst: 'rect', fill: '<a:noFill/>',
    text: `<a:p><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>${t}</a:t></a:r>` +
      (sub ? `<a:r><a:rPr sz="1100"><a:solidFill><a:srgbClr val="808080"/></a:solidFill></a:rPr><a:t>   ${sub}</a:t></a:r>` : '') +
      '</a:p>',
  });

const caption = (x, y, w, t) =>
  sp({ x, y, w, h: 18, prst: 'rect', fill: '<a:noFill/>', text: label(t, 800, '555555') });

// ---------- 1. 阴影 / 内阴影 / 发光 / 柔化边缘 ----------

const shdw = (blur, dist, dir, alpha) =>
  `<a:outerShdw blurRad="${blur}" dist="${dist}" dir="${dir}"><a:srgbClr val="000000"><a:alpha val="${alpha}"/></a:srgbClr></a:outerShdw>`;
const inner = (blur, dist, dir, alpha, clr = '000000') =>
  `<a:innerShdw blurRad="${blur}" dist="${dist}" dir="${dir}"><a:srgbClr val="${clr}"><a:alpha val="${alpha}"/></a:srgbClr></a:innerShdw>`;

const EFFECTS = [
  ['外阴影', `<a:effectLst>${shdw(76200, 63500, 2700000, 45000)}</a:effectLst>`, solid('accent1'), 'roundRect'],
  ['内阴影（右下）', `<a:effectLst>${inner(63500, 50800, 2700000, 75000)}</a:effectLst>`, solid('accent2'), 'roundRect'],
  ['内阴影（左上）', `<a:effectLst>${inner(50800, 44450, 13500000, 75000)}</a:effectLst>`, solid('accent4'), 'roundRect'],
  ['内阴影（无位移）', `<a:effectLst>${inner(101600, 0, 0, 80000)}</a:effectLst>`, solid('accent6'), 'ellipse'],
  ['内阴影（彩色）', `<a:effectLst>${inner(76200, 38100, 5400000, 90000, '1F3864')}</a:effectLst>`, solid('accent3'), 'roundRect'],
  ['发光', '<a:effectLst><a:glow rad="152400"><a:schemeClr val="accent2"><a:alpha val="80000"/></a:schemeClr></a:glow></a:effectLst>', solid('accent2'), 'roundRect'],
  ['柔化边缘', '<a:effectLst><a:softEdge rad="114300"/></a:effectLst>', solid('accent6'), 'roundRect'],
  ['内阴影 + 发光', `<a:effectLst><a:glow rad="76200"><a:schemeClr val="accent4"/></a:glow>${inner(63500, 44450, 2700000, 80000)}</a:effectLst>`, solid('accent5'), 'roundRect'],
  ['内阴影（渐变填充）', `<a:effectLst>${inner(76200, 50800, 2700000, 85000)}</a:effectLst>`,
    '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs><a:gs pos="100000"><a:schemeClr val="accent5"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>', 'roundRect'],
  ['内阴影 + 文字', `<a:effectLst>${inner(63500, 50800, 2700000, 70000)}</a:effectLst>`, solid('accent4'), 'roundRect'],
];

const CW = 200, CH = 130;
const slide1 = slideXml(
  title('效果：外阴影 / 内阴影 / 发光 / 柔化边缘', '内阴影用 SVG filter 反转 alpha 实现') +
  EFFECTS.map(([name, effect, fill, prst], i) => {
    const x = 40 + (i % 5) * 240, y = 90 + Math.floor(i / 5) * 240;
    const text = name.endsWith('文字')
      ? '<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1600" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>Inner</a:t></a:r></a:p>'
      : '';
    return sp({ x, y, w: CW, h: CH, prst, fill, effect, text, name }) + caption(x, y + CH + 6, CW, name);
  }).join(''),
);

// ---------- 2. 倒影 ----------

const refl = (stA, endPos, dist = 0) =>
  `<a:effectLst><a:reflection blurRad="6350" stA="${stA}" stPos="0" endA="300" endPos="${endPos}" dist="${dist}" dir="5400000" sy="-100000" algn="bl" rotWithShape="0"/></a:effectLst>`;

const REFLECTIONS = [
  ['alpha 90% / size 60%', refl(90000, 60000), solid('accent1'), 'roundRect', ''],
  ['alpha 50% / size 35%', refl(50000, 35000), solid('accent2'), 'roundRect', ''],
  ['alpha 30% / size 100%', refl(30000, 100000), solid('accent6'), 'roundRect', ''],
  ['alpha 70% / 间距 12px', refl(70000, 50000, px(12)), solid('accent4'), 'ellipse', ''],
  ['倒影 + 文字', refl(65000, 55000), solid('accent5'), 'roundRect',
    '<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>REFLECT</a:t></a:r></a:p>'],
  ['倒影 + 外阴影', refl(60000, 45000).replace('</a:effectLst>', `${shdw(50800, 38100, 2700000, 40000)}</a:effectLst>`), solid('accent3'), 'star5', ''],
];

const slide2 = slideXml(
  title('倒影 a:reflection', 'stA → 起始不透明度，endPos → 可见比例，dist → 与本体间距') +
  REFLECTIONS.map(([name, effect, fill, prst, text], i) => {
    const x = 60 + (i % 3) * 400, y = 90 + Math.floor(i / 3) * 300;
    return sp({ x, y, w: 260, h: 120, prst, fill, effect, text, name }) + caption(x, y + 245, 260, name);
  }).join(''),
);

// ---------- 3. 艺术字变形 ----------

function wordArt({ x, y, w, h, prst, adj = '', text, color = 'accent1', size = 2000, effect = '', rtl = false }) {
  return `<p:sp>
<p:nvSpPr><p:cNvPr id="${nextShapeId()}" name="wa-${prst}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>${effect}</p:spPr>
<p:txBody>
<a:bodyPr wrap="none" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr">
<a:prstTxWarp prst="${prst}"><a:avLst>${adj}</a:avLst></a:prstTxWarp>
</a:bodyPr><a:lstStyle/>
<a:p><a:pPr algn="ctr"${rtl ? ' rtl="1"' : ''}/><a:r><a:rPr sz="${size}" b="1">${solid(color)}</a:rPr><a:t>${text}</a:t></a:r></a:p>
</p:txBody></p:sp>`;
}

const WARPS = [
  ['textArchUp', '<a:gd name="adj" fmla="val 10800000"/>'],
  ['textArchDown', '<a:gd name="adj" fmla="val 10800000"/>'],
  ['textArchUpPour', '<a:gd name="adj" fmla="val 12600000"/>'],
  ['textArchDownPour', '<a:gd name="adj" fmla="val 12600000"/>'],
  ['textCircle', ''],
  ['textWave1', '<a:gd name="adj1" fmla="val 12500"/>'],
  ['textWave2', '<a:gd name="adj1" fmla="val 12500"/>'],
  ['textCurveUp', ''],
  ['textCurveDown', ''],
  ['textCanUp', ''],
  ['textCanDown', ''],
  ['textTriangle', ''],
  ['textChevron', ''],
  ['textInflate', ''],
  ['textDeflate', ''],
];

const GW = 250, GH = 190;
const slide3 = slideXml(
  title('艺术字变形 a:prstTxWarp（15 个预设）', '文字排到 &lt;path&gt; 上，用 &lt;textPath&gt; 渲染') +
  WARPS.map(([prst, adj], i) => {
    const x = 15 + (i % 5) * GW, y = 66 + Math.floor(i / 5) * GH;
    return (
      wordArt({ x: x + 10, y: y + 6, w: GW - 20, h: GH - 40, prst, adj, text: 'Warp', color: `accent${(i % 6) + 1}`, size: 2200 }) +
      caption(x, y + GH - 30, GW, prst)
    );
  }).join(''),
);

// ---------- 4. 降级 / RTL / 组合 ----------

const rtlPara = (t, rtl, algn) =>
  `<a:p><a:pPr algn="${algn}"${rtl ? ' rtl="1"' : ''}/><a:r><a:rPr sz="1600"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:rPr><a:t>${t}</a:t></a:r></a:p>`;

const AR = 'مرحبا بالعالم 123 نص عربي';

const slide4 = slideXml(
  title('降级与 RTL', '未实现的变形预设按普通排版渲染，不报错') +
  // 未支持的预设 → 普通横排
  wordArt({ x: 40, y: 80, w: 260, h: 90, prst: 'textStop', text: 'textStop', color: 'accent3', size: 1800 }) +
  caption(40, 176, 260, 'textStop（未实现 → 普通排版）') +
  wordArt({ x: 330, y: 80, w: 260, h: 90, prst: 'textNoShape', text: 'textNoShape', color: 'accent3', size: 1800 }) +
  caption(330, 176, 260, 'textNoShape（无变形）') +
  // 变形 + 倒影 + 阴影组合
  wordArt({
    x: 640, y: 74, w: 300, h: 110, prst: 'textArchUp', adj: '<a:gd name="adj" fmla="val 10800000"/>',
    text: 'ARCH', color: 'accent1', size: 2400, effect: refl(70000, 55000),
  }) +
  caption(640, 200, 300, '变形 + 倒影') +
  wordArt({
    x: 970, y: 74, w: 280, h: 110, prst: 'textWave1', adj: '', text: 'WAVE',
    color: 'accent2', size: 2400, effect: `<a:effectLst>${shdw(50800, 38100, 2700000, 45000)}</a:effectLst>`,
  }) +
  caption(970, 200, 280, '变形 + 外阴影') +
  // RTL 与 LTR 对照
  sp({
    x: 40, y: 260, w: 560, h: 190, prst: 'rect',
    fill: '<a:solidFill><a:schemeClr val="lt2"/></a:solidFill>',
    ln: '<a:ln w="9525"><a:solidFill><a:srgbClr val="C0C8D8"/></a:solidFill></a:ln>',
    text: rtlPara(AR, true, 'l') + rtlPara(`${AR} — طويل جدا نص للاختبار يلتف على عدة أسطر هنا`, true, 'l') + rtlPara(AR, true, 'r'),
    name: 'rtl-box',
  }) +
  caption(40, 456, 560, 'RTL：direction=rtl，前两段物理左对齐、第三段右对齐') +
  sp({
    x: 640, y: 260, w: 560, h: 190, prst: 'rect',
    fill: '<a:solidFill><a:schemeClr val="lt2"/></a:solidFill>',
    ln: '<a:ln w="9525"><a:solidFill><a:srgbClr val="C0C8D8"/></a:solidFill></a:ln>',
    text: rtlPara('Hello world 123 LTR text', false, 'l') + rtlPara('Hello world 123 — a longer line of text that wraps here', false, 'l') + rtlPara('Hello world 123 LTR text', false, 'r'),
    name: 'ltr-box',
  }) +
  caption(640, 456, 560, 'LTR 对照'),
);

// ---------- 打包 ----------

const SLIDES = [slide1, slide2, slide3, slide4];

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

const theme = `${XML}<a:theme xmlns:a="${NS.a}" name="Effects">
<a:themeElements>
<a:clrScheme name="Effects">
<a:dk1><a:sysClr val="windowText" lastClr="1A1A1A"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="EEF3FB"/></a:lt2>
<a:accent1><a:srgbClr val="4472C4"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2>
<a:accent3><a:srgbClr val="7F7F7F"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Effects">
<a:majorFont><a:latin typeface="Trebuchet MS"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Helvetica"/><a:ea typeface="PingFang SC"/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Effects">
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
writeFileSync(join(root, 'fixtures/sample-effects.pptx'), zip);
console.log(`fixtures/sample-effects.pptx 已生成（${SLIDES.length} 页，${(zip.length / 1024).toFixed(1)} KB）`);
