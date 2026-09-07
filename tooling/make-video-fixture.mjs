import { writeFileSync } from 'node:fs';
import { deck, slideXml, sp, solid } from './lib/ooxml.mjs';
const shape=(name,color)=>sp({x:100,y:80,w:180,h:90,name,fill:solid(color),text:`<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${name}</a:t></a:r></a:p>`,bodyPr:'<a:bodyPr anchor="ctr"/>'});
const first=shape('动画视频','2255CC'),id=/p:cNvPr id="(\d+)"/.exec(first)[1];
const timing=`<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>
<p:par><p:cTn id="10" presetID="10" presetClass="entr" fill="hold" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="11" dur="400" fill="hold"/><p:tgtEl><p:spTgt spid="${id}"/></p:tgtEl></p:cBhvr></p:animEffect></p:childTnLst></p:cTn></p:par>
<p:par><p:cTn id="20" presetClass="path" fill="hold" nodeType="afterEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:animMotion origin="layout" path="M 0 0 L 0.2 0 E"><p:cBhvr><p:cTn id="21" dur="500" fill="hold"/><p:tgtEl><p:spTgt spid="${id}"/></p:tgtEl></p:cBhvr></p:animMotion></p:childTnLst></p:cTn></p:par>
</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
const slides=[slideXml(first).replace('</p:sld>',timing+'</p:sld>'),slideXml(shape('第二页','16834F')).replace('</p:sld>','<p:transition spd="fast"><p:fade/></p:transition></p:sld>'),slideXml(shape('隐藏页','DD4422')).replace('<p:sld ','<p:sld show="0" ')];
writeFileSync(new URL('../fixtures/sample-video-export.pptx',import.meta.url),deck({slides,width:480,height:270,name:'Fixed-frame video export'}));
console.log('视频固件：淡入、运动路径、页面切换与隐藏页');
