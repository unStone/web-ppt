import { writeFileSync } from 'node:fs';
import { deck, slideXml, sp, solid, px } from './lib/ooxml.mjs';
const cases = [
  ['Front', 'rect', 'orthographicFront', 0, 0, 0],
  ['XYZ rotation', 'rect', 'orthographicFront', 25, 40, 10],
  ['Perspective', 'rect', 'perspectiveFront', 30, 325, 0],
  ['Back face', 'rect', 'orthographicFront', 0, 160, 0],
  ['Curved bevel', 'ellipse', 'perspectiveFront', 25, 40, 0],
  ['Hole', 'rect', 'perspectiveFront', 25, 35, 0],
];
const shapes = cases.map(([name,prst,camera,x,y,z],i)=>{
  const scene=`<a:scene3d><a:camera prst="${camera}" fov="2700000" zoom="100000"><a:rot lat="${x*60000}" lon="${y*60000}" rev="${z*60000}"/></a:camera><a:lightRig rig="threePt" dir="tl"/></a:scene3d><a:sp3d extrusionH="${px(50)}" prstMaterial="metal">${i===4?`<a:bevelT w="${px(8)}" h="${px(6)}"/>`:''}<a:extrusionClr><a:srgbClr val="3478C4"/></a:extrusionClr></a:sp3d>`;
  let shape=sp({x:80+(i%3)*400,y:90+Math.floor(i/3)*330,w:240,h:150,name,prst,fill:i===2?'<a:solidFill><a:srgbClr val="4472C4"><a:alpha val="50000"/></a:srgbClr></a:solidFill>':solid('4472C4'),effect:scene,text:`<a:p><a:pPr algn="ctr"/><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:rPr><a:t>${name}</a:t></a:r></a:p>`,bodyPr:'<a:bodyPr anchor="ctr"/>'});
  if(i===5)shape=shape.replace(/<a:prstGeom[\s\S]*?<\/a:prstGeom>/,`<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="240" h="150"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="240" y="0"/></a:lnTo><a:lnTo><a:pt x="240" y="150"/></a:lnTo><a:lnTo><a:pt x="0" y="150"/></a:lnTo><a:close/><a:moveTo><a:pt x="70" y="35"/></a:moveTo><a:lnTo><a:pt x="70" y="115"/></a:lnTo><a:lnTo><a:pt x="170" y="115"/></a:lnTo><a:lnTo><a:pt x="170" y="35"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>`);
  return shape;
}).join('');
writeFileSync(new URL('../fixtures/sample-three-d.pptx',import.meta.url),deck({slides:[slideXml(shapes)],width:1280,height:720,name:'Three-dimensional mesh'}));
console.log('三维投影固件：正交、透视、XYZ 旋转、背面、曲线斜角及孔洞');
