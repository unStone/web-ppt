/** 可编辑元素动画固件：来源时间线、无动画页、未知 timing 载荷与无关 MCE。 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deck, label, nextShapeId, nvGrp, px, slideXml } from './lib/ooxml.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MC = 'http://schemas.openxmlformats.org/markup-compatibility/2006';

function shape({ x, y, color, name, text }) {
  const id = nextShapeId();
  return {
    id,
    xml: `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>
<p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(420)}" cy="${px(150)}"/></a:xfrm>
<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${color}"/></a:solidFill></p:spPr>
<p:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/>${label(text, 2800, 'FFFFFF')}</p:txBody></p:sp>`,
  };
}

function behavior({ id, presetID, presetClass, nodeType, target, duration, delay, filter }) {
  const visibility = presetClass === 'entr' || presetClass === 'exit'
    ? `<p:set><p:cBhvr><p:cTn id="${id + 1}" dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl><p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="${presetClass === 'exit' ? 'hidden' : 'visible'}"/></p:to></p:set>`
    : '';
  return `<p:par><p:cTn id="${id}" presetID="${presetID}" presetClass="${presetClass}" fill="hold" nodeType="${nodeType}">
<p:stCondLst><p:cond delay="${delay}"/></p:stCondLst><p:childTnLst>${visibility}
<p:animEffect transition="${presetClass === 'exit' ? 'out' : 'in'}" filter="${filter}"><p:cBhvr><p:cTn id="${id + 2}" dur="${duration}" fill="hold"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl></p:cBhvr></p:animEffect>
</p:childTnLst></p:cTn></p:par>`;
}

function motion({ id, target }) {
  return `<p:par><p:cTn id="${id}" presetID="0" presetClass="path" fill="hold" nodeType="afterEffect">
<p:stCondLst><p:cond delay="80"/></p:stCondLst><p:childTnLst><p:animMotion origin="layout" path="M 0 0 L 0.18 -0.12 L 0.3 0.06 E" pathEditMode="relative">
<p:cBhvr><p:cTn id="${id + 1}" dur="1000" fill="hold"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl><p:attrNameLst><p:attrName>ppt_x</p:attrName><p:attrName>ppt_y</p:attrName></p:attrNameLst></p:cBhvr>
</p:animMotion></p:childTnLst></p:cTn></p:par>`;
}

function spin({ id, target }) {
  return `<p:par><p:cTn id="${id}" presetID="61" presetClass="emph" fill="hold" nodeType="withEffect">
<p:stCondLst><p:cond delay="120"/></p:stCondLst><p:childTnLst><p:animRot by="21600000"><p:cBhvr><p:cTn id="${id + 1}" dur="900" fill="hold"/><p:tgtEl><p:spTgt spid="${target}"/></p:tgtEl><p:attrNameLst><p:attrName>r</p:attrName></p:attrNameLst></p:cBhvr></p:animRot>
</p:childTnLst></p:cTn></p:par>`;
}

const firstA = shape({ x: 160, y: 190, color: '2E75B6', name: 'source-a', text: '来源动画 A' });
const firstB = shape({ x: 700, y: 390, color: '70AD47', name: 'source-b', text: '来源动画 B' });
const sourceTiming = `<p:timing xmlns:fixture="urn:web-ppt:animation-fixture" fixture:keep="timing"><p:tnLst>
<p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>
${behavior({ id: 10, presetID: 2, presetClass: 'entr', nodeType: 'clickEffect', target: firstA.id, duration: 600, delay: 0, filter: 'slide(fromLeft)' })}
${spin({ id: 20, target: firstB.id })}
${motion({ id: 30, target: firstA.id })}
<p:animClr clrSpc="rgb"><p:cBhvr><p:cTn id="40" dur="500" fill="hold"/><p:tgtEl><p:spTgt spid="${firstB.id}"/></p:tgtEl></p:cBhvr><p:to><a:srgbClr val="FF0000"/></p:to></p:animClr>
</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst>
<p:bldLst fixture:keepBuild="yes"><p:bldP spid="${firstA.id}" grpId="0" build="p"/></p:bldLst>
<p:extLst><p:ext uri="{ANIMATION-KEEP}"><fixture:payload value="keep"/></p:ext></p:extLst></p:timing>`;
// Choice 故意只有 parser 尚未支持的 p14 行为；预览必须按真实能力选择标准 Fallback。
const choiceTiming = `<p:timing><p:tnLst><p14:anim presetID="999"><p:cBhvr><p:cTn id="91" dur="700"/><p:tgtEl><p:spTgt spid="${firstB.id}"/></p:tgtEl></p:cBhvr></p14:anim></p:tnLst></p:timing>`;
const timingCarrier = `<mc:AlternateContent><mc:Choice Requires="p14">${choiceTiming}</mc:Choice><mc:Fallback>${sourceTiming}</mc:Fallback></mc:AlternateContent>`;
const unrelatedMce = `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice Requires="fixture"><fixture:keep/></mc:Choice><mc:Fallback><p:extLst/></mc:Fallback></mc:AlternateContent>`;
const slide1 = slideXml(`${firstA.xml}${firstB.xml}`, '',
  `xmlns:fixture="urn:web-ppt:animation-fixture" xmlns:mc="${MC}" xmlns:p14="http://schemas.microsoft.com/office/powerpoint/2010/main" mc:Ignorable="fixture p14" fixture:root="keep"`)
  .replace('</p:sld>', `${timingCarrier}${unrelatedMce}</p:sld>`);

const secondA = shape({ x: 170, y: 210, color: 'ED7D31', name: 'plain-a', text: '无动画 A' });
const secondB = shape({ x: 690, y: 390, color: '7030A0', name: 'plain-b', text: '无动画 B' });
const slide2 = slideXml(`${secondA.xml}${secondB.xml}`);

// 60 个元素让同一固件同时承担浏览器和 headless 的交互预算门禁。
const many = Array.from({ length: 60 }, (_, index) => {
  const id = nextShapeId();
  const x = 20 + (index % 10) * 124;
  const y = 20 + Math.floor(index / 10) * 112;
  return `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="perf-${index}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="${px(x)}" y="${px(y)}"/><a:ext cx="${px(100)}" cy="${px(84)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></p:spPr><p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr/></a:p></p:txBody></p:sp>`;
}).join('');
const slide3 = `${slideXml(many)}`;

const fourthA = shape({ x: 360, y: 260, color: 'C55A11', name: 'readonly-only', text: '仅含未支持来源行为' });
const unsupportedOnlyTiming = `<p:timing><p:tnLst><p:animClr clrSpc="rgb"><p:cBhvr><p:cTn id="1" dur="500" fill="hold"/><p:tgtEl><p:spTgt spid="${fourthA.id}"/></p:tgtEl></p:cBhvr><p:to><a:srgbClr val="00FF00"/></p:to></p:animClr></p:tnLst></p:timing>`;
const slide4 = slideXml(fourthA.xml).replace('</p:sld>', `${unsupportedOnlyTiming}</p:sld>`);

const fifthA = shape({ x: 360, y: 260, color: '4472C4', name: 'noncanonical-spin', text: '非规范可识别时间树' });
const noncanonicalSpin = spin({ id: 100, target: fifthA.id })
  .replace('presetClass="emph" fill="hold"', 'presetClass="emph" dur="900" fill="hold"')
  .replace('nodeType="withEffect"', 'nodeType="clickEffect"')
  .replace('<p:cond delay="120"/>', '<p:cond delay="120"/><p:cond delay="240"/>')
  .replace('by="21600000"', 'by="10800000"');
const noncanonicalTiming = `<p:timing><p:tnLst><p:par><p:cTn id="92" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="93" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="94" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst>${noncanonicalSpin}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
const slide5 = slideXml(fifthA.xml).replace('</p:sld>', `${noncanonicalTiming}</p:sld>`);

const bytes = deck({
  name: 'Editor Animations', width: 1280, height: 720,
  slides: [slide1, slide2, slide3, slide4, slide5],
});
mkdirSync(join(root, 'fixtures'), { recursive: true });
writeFileSync(join(root, 'fixtures/sample-editor-animations.pptx'), bytes);
console.log(`fixtures/sample-editor-animations.pptx 已生成（5 页，${(bytes.length / 1024).toFixed(1)} KB）`);
