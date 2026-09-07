/** 用确定的原生节点同时覆盖文字外观、公式原子、表格与关系资源。 */
import { writeFileSync } from 'node:fs';
import { deck, makePng, slideXml, solid, sp } from './lib/ooxml.mjs';

const m = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const r = text => `<m:r><m:rPr><m:sty m:val="i"/></m:rPr><m:t>${text}</m:t></m:r>`;
const e = text => `<m:e>${text}</m:e>`;
const nested = `<m:f><m:num><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/>${e(`<m:sSubSup>${e(r('x'))}<m:sub>${r('i')}</m:sub><m:sup>${r('2')}</m:sup></m:sSubSup>`)}</m:rad></m:num><m:den>${r('y')}</m:den></m:f>`;
const formula = `<a14:m xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main"><m:oMath xmlns:m="${m}">${nested}</m:oMath></a14:m>`;
const props = `<a:rPr sz="3200" u="dbl"><a:ln w="9525"><a:solidFill><a:srgbClr val="12539A"/></a:solidFill></a:ln><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="CC3355"/></a:gs><a:gs pos="35789"><a:srgbClr val="8822CC"><a:alpha val="80000"/></a:srgbClr></a:gs><a:gs pos="100000"><a:srgbClr val="2266CC"/></a:gs></a:gsLst><a:lin ang="2345678" scaled="0"/></a:gradFill><a:effectLst><a:outerShdw blurRad="19050" dist="38100" dir="2700000"><a:srgbClr val="777777"><a:alpha val="50000"/></a:srgbClr></a:outerShdw></a:effectLst><a:uFill><a:solidFill><a:srgbClr val="228844"/></a:solidFill></a:uFill><a:latin typeface="Arial"/><a:ea typeface="Arial"/></a:rPr>`;
const rich = sp({name:'渐变描边阴影与独立下划线',x:70,y:60,w:1100,h:110,fill:solid('FFFFFF'),text:`<a:p><a:pPr><a:buBlip><a:blip r:embed="rIdBullet"/></a:buBlip></a:pPr><a:r>${props}<a:t>Portable 高级文本</a:t></a:r></a:p>`});
const warp = sp({name:'艺术字调整值',x:70,y:195,w:700,h:130,fill:solid('FFFFFF'),bodyPr:'<a:bodyPr><a:prstTxWarp prst="textWave1"><a:avLst><a:gd name="adj1" fmla="val 16000"/><a:gd name="adj2" fmla="val 2200"/></a:avLst></a:prstTxWarp></a:bodyPr>',text:'<a:p><a:r><a:rPr sz="3200"/><a:t>Portable Wave</a:t></a:r></a:p>'});
const math = sp({name:'嵌套公式混排',x:70,y:390,w:1100,h:180,fill:solid('FFFFFF'),text:`<a:p><a:pPr><a:defRPr sz="2400"/></a:pPr><a:r><a:rPr sz="2400"/><a:t>before </a:t></a:r>${formula}<a:r><a:rPr sz="2400"/><a:t> after</a:t></a:r></a:p>`});
const table = `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="910" name="表格公式"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="952500" y="1905000"/><a:ext cx="9525000" cy="2857500"/></p:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="4762500"/><a:gridCol w="4762500"/></a:tblGrid><a:tr h="2857500"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr sz="2400"/></a:pPr>${formula}</a:p></a:txBody><a:tcPr/></a:tc><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r>${props}<a:t>cell</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
const standalone = sp({name:'独立公式',x:150,y:150,w:800,h:350,fill:solid('FFFFFF'),text:`<a:p>${formula.replace('<m:oMath ', '<m:oMathPara ').replace('>'+nested+'</m:oMath>', '><m:oMath>'+nested+'</m:oMath></m:oMathPara>')}</a:p>`});
const bytes = deck({name:'Portable Rich Text',width:1280,height:720,slides:[slideXml(rich+warp+math),slideXml(table),slideXml(standalone)],
  slideRelationships:['<Relationship Id="rIdBullet" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/bullet.png"/>'],
  extraTypes:'<Override PartName="/ppt/media/bullet.png" ContentType="image/png"/>',
  extraEntries:[['ppt/media/bullet.png',makePng(12,12,(x,y)=>x===y?[30,140,80]:[255,255,255])]]});
writeFileSync('fixtures/sample-portable-rich-text.pptx',bytes);
console.log('fixtures/sample-portable-rich-text.pptx 已生成');
