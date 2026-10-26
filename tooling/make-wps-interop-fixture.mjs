import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, nextShapeId, px, slideXml, solid, sp, XML } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

// PowerPoint 生成的 defaultTextStyle 几乎总写着 tx1；fontRef 的 lt1 必须压过它。
const defaultTextStyle = '<p:defaultTextStyle><a:lvl1pPr><a:defRPr sz="1800">'
  + '<a:solidFill><a:schemeClr val="tx1"/></a:solidFill></a:defRPr></a:lvl1pPr></p:defaultTextStyle>';

/** PowerPoint 新建形状的 p:style：填充 accent1、文字 lt1。 */
function styledShape({ x, y, w, h, name, text, lstStyle = '' }) {
  return `<p:sp><p:nvSpPr><p:cNvPr id="${nextShapeId()}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>
<p:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef>
<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>
<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle>${lstStyle}</a:lstStyle>${text}</p:txBody></p:sp>`;
}

const para = (value, rPr = '<a:rPr sz="2400"/>') => `<a:p><a:pPr algn="ctr"/><a:r>${rPr}<a:t>${value}</a:t></a:r></a:p>`;
const gd = (name, value) => `<a:gd name="${name}" fmla="val ${value}"/>`;

// WPS 插入的图标只写 extLst 里的 asvg:svgBlip，a:blip 上没有位图兼容副本。
const iconSvg = `${XML}<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">`
  + '<rect x="4" y="4" width="56" height="56" rx="12" fill="#AA418D"/>'
  + '<path d="M32 12 L38 26 L53 27 L41 37 L45 52 L32 44 L19 52 L23 37 L11 27 L26 26 Z" fill="#FFFFFF"/></svg>';
const svgOnlyPicture = `<p:pic><p:nvPicPr><p:cNvPr id="${nextShapeId()}" name="仅 SVG 图标"/>
<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip><a:extLst><a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">
<asvg:svgBlip xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main" r:embed="rId2"/>
</a:ext></a:extLst></a:blip><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(980)}" y="${px(60)}"/><a:ext cx="${px(120)}" cy="${px(120)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;

// 来自真实 WPS 文稿的归一化组合：chExt 只有几千 EMU，标注尾尖在左上方。
const normalizedCallout = `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${nextShapeId()}" name="归一化标注组合"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="872490" y="4163955"/><a:ext cx="5768975" cy="1579880"/>
<a:chOff x="674" y="3030"/><a:chExt cx="9085" cy="2488"/></a:xfrm></p:grpSpPr>
<p:sp><p:nvSpPr><p:cNvPr id="${nextShapeId()}" name="组合内标注"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="1822" y="3990"/><a:ext cx="2423" cy="589"/></a:xfrm>
<a:prstGeom prst="wedgeRoundRectCallout"><a:avLst>${gd('adj1', -33572)}${gd('adj2', -82088)}${gd('adj3', 16667)}</a:avLst></a:prstGeom>
${solid('3E70AE')}<a:ln><a:noFill/></a:ln></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>${para('Speaking', '<a:rPr sz="2400" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr>')}</p:txBody></p:sp>
</p:grpSp>`;

const slide = slideXml([
  styledShape({ x: 60, y: 60, w: 200, h: 120, name: 'fontRef 白字', text: para('A') }),
  styledShape({
    x: 300, y: 60, w: 200, h: 120, name: 'rPr 显式颜色',
    text: para('B', '<a:rPr sz="2400"><a:solidFill><a:srgbClr val="FFC000"/></a:solidFill></a:rPr>'),
  }),
  styledShape({
    x: 540, y: 60, w: 200, h: 120, name: 'lstStyle 颜色',
    lstStyle: '<a:lvl1pPr><a:defRPr><a:solidFill><a:srgbClr val="1F3864"/></a:solidFill></a:defRPr></a:lvl1pPr>',
    text: para('C'),
  }),
  svgOnlyPicture,
  // cs 只服务复杂文种：拉丁标题不能被 Arial Black 接管，阿拉伯文仍要用到它。
  sp({
    x: 780, y: 200, w: 420, h: 90, name: 'cs 字体', bodyPr: '<a:bodyPr wrap="square" anchor="t"/>',
    text: '<a:p><a:r><a:rPr sz="4800" b="1"><a:latin typeface="微软雅黑"/><a:ea typeface="微软雅黑"/>'
      + '<a:cs typeface="Arial Black"/></a:rPr><a:t>Vocabulary</a:t></a:r>'
      + '<a:r><a:rPr sz="2400"><a:latin typeface="微软雅黑"/><a:cs typeface="Arial Black"/></a:rPr><a:t> مرحبا</a:t></a:r></a:p>',
  }),
  sp({
    x: 80, y: 300, w: 240, h: 80, prst: 'wedgeRoundRectCallout', name: '尾尖朝上的圆角标注',
    avLst: gd('adj1', -33572) + gd('adj2', -82088) + gd('adj3', 16667), fill: solid('3E70AE'),
    text: para('上'),
  }),
  sp({
    x: 480, y: 280, w: 200, h: 100, prst: 'wedgeRectCallout', name: '尾尖朝右的矩形标注',
    avLst: gd('adj1', 75000) + gd('adj2', -10000), fill: solid('70AD47'),
    text: para('右'),
  }),
  normalizedCallout,
].join('\n'), '<p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg>');

// bgRef 的 1001 指 bgFillStyleLst 第 1 项；第 3 项放渐变，取错项时背景会变灰。
const solidPh = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
const bgFillStyleLst = solidPh + solidPh + '<a:gradFill rotWithShape="1"><a:gsLst>'
  + '<a:gs pos="0"><a:schemeClr val="phClr"/></a:gs>'
  + '<a:gs pos="100000"><a:schemeClr val="phClr"><a:shade val="63000"/></a:schemeClr></a:gs>'
  + '</a:gsLst><a:lin ang="5400000" scaled="0"/></a:gradFill>';

const bytes = deck({
  name: 'WPS Interop', width: 1280, height: 720,
  slides: [slide],
  presExtra: defaultTextStyle,
  bgFillStyleLst,
  extraTypes: '<Default Extension="svg" ContentType="image/svg+xml"/>',
  extraEntries: [['ppt/media/icon.svg', iconSvg]],
  slideRelationships: [`<Relationship Id="rId2" Type="${REL}/image" Target="../media/icon.svg"/>`],
});

mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-wps-interop.pptx'), bytes);
console.log(`fixtures/sample-wps-interop.pptx 已生成（${(bytes.length / 1024).toFixed(1)} KB）`);
