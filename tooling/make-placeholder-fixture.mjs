/**
 * 生成 fixtures/sample-placeholder.pptx —— 占位符几何继承回归文件。
 *
 * 内容占位符里放图片时，PowerPoint 常写成空的 <p:spPr/>，位置尺寸全靠
 * 版式继承。此前 parsePic 在拿不到 xfrm 时直接返回 null，整张图会被丢掉
 * ——真实文件里这种写法很常见（adrianco/slides 的 CloudNative.pptx 第 44 页
 * 就因此整页只剩标题）。
 *
 * 三种情形各一页：
 *   1 图片占位符 + 空 spPr    → 几何从版式继承
 *   2 图片自带 xfrm           → 用自己的，不受版式影响
 *   3 形状占位符 + 空 spPr    → 形状侧的继承（原本就支持，防回归）
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { label, makePng, makeZip, NS, nextShapeId, nvGrp, px, slideXml, solid, sp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1280, H = 720;

// 版式里的占位符：idx=1 给图片，idx=2 给形状
const PH_PIC = { x: 80, y: 140, w: 420, h: 300 };
const PH_SHP = { x: 560, y: 140, w: 340, h: 300 };

const pic = ({ ph, xfrm }) => `<p:pic>
<p:nvPicPr><p:cNvPr id="${nextShapeId()}" name="ph-pic"/><p:cNvPicPr/><p:nvPr>${ph}</p:nvPr></p:nvPicPr>
<p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr>${xfrm}</p:spPr>
</p:pic>`;

const phShape = () => `<p:sp>
<p:nvSpPr><p:cNvPr id="${nextShapeId()}" name="ph-shape"/><p:cNvSpPr/><p:nvPr><p:ph idx="2"/></p:nvPr></p:nvSpPr>
<p:spPr/>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>${label('占位符形状（几何来自版式）', 1200, 'FFFFFF')}</p:txBody>
</p:sp>`;

const title = (t) => sp({
  x: 40, y: 40, w: W - 80, h: 60, prst: 'rect', fill: '<a:noFill/>',
  text: `<a:p><a:r><a:rPr sz="2200" b="1"><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></a:rPr><a:t>${t}</a:t></a:r></a:p>`,
});

const xf = (b) => `<a:xfrm><a:off x="${px(b.x)}" y="${px(b.y)}"/><a:ext cx="${px(b.w)}" cy="${px(b.h)}"/></a:xfrm>`;

const SLIDES = [
  slideXml(title('图片占位符 + 空 spPr → 几何继承自版式') + pic({ ph: '<p:ph idx="1"/>', xfrm: '' })),
  slideXml(title('图片自带 xfrm → 不受版式影响')
    + pic({ ph: '<p:ph idx="1"/>', xfrm: xf({ x: 620, y: 200, w: 240, h: 180 }) })),
  slideXml(title('形状占位符 + 空 spPr → 形状侧继承') + phShape()),
];

const contentTypes = `${XML}<Types xmlns="${NS.ct}">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>\n<Default Extension="png" ContentType="image/png"/>
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

const theme = `${XML}<a:theme xmlns:a="${NS.a}" name="Placeholder">
<a:themeElements>
<a:clrScheme name="Placeholder">
<a:dk1><a:sysClr val="windowText" lastClr="1A1A1A"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
<a:dk2><a:srgbClr val="1F3864"/></a:dk2><a:lt2><a:srgbClr val="F2F2F2"/></a:lt2>
<a:accent1><a:srgbClr val="2E75B6"/></a:accent1><a:accent2><a:srgbClr val="A6A6A6"/></a:accent2>
<a:accent3><a:srgbClr val="70AD47"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4>
<a:accent5><a:srgbClr val="ED7D31"/></a:accent5><a:accent6><a:srgbClr val="7030A0"/></a:accent6>
<a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink>
</a:clrScheme>
<a:fontScheme name="Placeholder">
<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="Placeholder">
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

// 版式里放两个占位符，几何就来自这里
const slideLayout = `${XML}<p:sldLayout xmlns:a="${NS.a}" xmlns:r="${NS.r}" xmlns:p="${NS.p}" type="obj">
<p:cSld name="Content"><p:spTree>${nvGrp}
<p:sp><p:nvSpPr><p:cNvPr id="90" name="ph1"/><p:cNvSpPr/><p:nvPr><p:ph idx="1"/></p:nvPr></p:nvSpPr>
<p:spPr>${xf(PH_PIC)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>
<p:sp><p:nvSpPr><p:cNvPr id="91" name="ph2"/><p:cNvSpPr/><p:nvPr><p:ph idx="2"/></p:nvPr></p:nvSpPr>
<p:spPr>${xf(PH_SHP)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>${solid('accent3')}</p:spPr>
<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>
</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;

const slideLayoutRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>
</Relationships>`;

const slideRels = `${XML}<Relationships xmlns="${NS.rel}">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/>
</Relationships>`;

const entries = [
  ['[Content_Types].xml', contentTypes],
  ['ppt/media/image1.png', makePng(96, 72, (x, y) => [(x * 4) & 255, (y * 6) & 255, 180])],
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
writeFileSync(join(root, 'fixtures/sample-placeholder.pptx'), zip);
console.log(`fixtures/sample-placeholder.pptx 已生成（${SLIDES.length} 页，${(zip.length / 1024).toFixed(1)} KB）`);
