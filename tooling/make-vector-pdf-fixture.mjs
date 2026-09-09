import {writeFileSync} from 'node:fs';
import {deck,slideXml,sp,makePng,nextShapeId,px} from './lib/ooxml.mjs';
import {vectorPdfNormalizationSamples} from './lib/vector-pdf-normalization-samples.mjs';

const content=sp({x:40,y:40,w:320,h:100,fill:'<a:solidFill><a:srgbClr val="E53935"/></a:solidFill>',
  text:'<a:p><a:r><a:rPr sz="2400"><a:latin typeface="WebPPT Glyph Latin"/></a:rPr><a:t>AV office ffi ﬃ</a:t></a:r></a:p>'});
writeFileSync(new URL('../fixtures/sample-vector-pdf.pptx',import.meta.url),deck({
  name:'VectorPdf',width:640,height:360,slides:[slideXml(content)],
}));
console.log('fixtures/sample-vector-pdf.pptx：字体连字和普通矢量形状');

const run=(text,family='WebPPT Glyph Latin')=>`<a:r><a:rPr sz="2400"><a:latin typeface="${family}"/><a:ea typeface="WebPPT Glyph Chinese"/></a:rPr><a:t>${text}</a:t></a:r>`;
const paragraphs=sp({x:40,y:40,w:400,h:220,fill:'<a:noFill/>',text:
  `<a:p>${run('á q̇ café')}</a:p><a:p><a:pPr algn="ctr"/>${run('中文测试。','WebPPT Glyph Chinese')}</a:p>`+
  `<a:p><a:pPr algn="r"/>${run('ABC 中文 ffi')}</a:p>`});
writeFileSync(new URL('../fixtures/sample-vector-pdf-text.pptx',import.meta.url),deck({
  name:'VectorPdfText',width:640,height:360,slides:[slideXml(paragraphs)],
}));
console.log('fixtures/sample-vector-pdf-text.pptx：组合字符、中文、多段落与对齐');

const label=(text,x)=>sp({x,y:40,w:100,h:100,fill:'<a:noFill/>',text:`<a:p>${run(text)}</a:p>`});
const exiting=label('A',40),keeper=label('B',200),exitId=/<p:cNvPr id="(\d+)"/.exec(exiting)[1];
const timing=`<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" nodeType="tmRoot"><p:childTnLst>
<p:seq><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst><p:par><p:cTn id="3" presetID="10" presetClass="exit" nodeType="clickEffect">
<p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:set><p:cBhvr><p:cTn id="4" dur="1" fill="hold"/><p:tgtEl><p:spTgt spid="${exitId}"/></p:tgtEl>
<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="hidden"/></p:to></p:set>
</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
writeFileSync(new URL('../fixtures/sample-vector-pdf-jobs.pptx',import.meta.url),deck({
  name:'VectorPdfJobs',width:640,height:360,slides:[slideXml(exiting+keeper).replace('</p:sld>',timing+'</p:sld>'),
    slideXml(label('A',40),'','show="0"'),slideXml(label('C',40))],
}));
console.log('fixtures/sample-vector-pdf-jobs.pptx：原始页码、隐藏页和动画批次');

const ellipse=sp({x:40,y:40,w:120,h:80,prst:'ellipse',rot:30*60000,fill:'<a:noFill/>',
  ln:'<a:ln w="38100" cap="rnd"><a:solidFill><a:srgbClr val="1565C0"/></a:solidFill><a:prstDash val="dash"/><a:round/></a:ln>'});
writeFileSync(new URL('../fixtures/sample-vector-pdf-geometry.pptx',import.meta.url),deck({
  name:'VectorPdfGeometry',width:640,height:360,slides:[slideXml(ellipse),slideXml(sp({x:40,y:40,w:120,h:80,prst:'curvedConnector2',fill:'<a:noFill/>',
    ln:'<a:ln w="38100"><a:solidFill><a:srgbClr val="43A047"/></a:solidFill></a:ln>'}))],
}));
console.log('fixtures/sample-vector-pdf-geometry.pptx：椭圆弧、旋转和虚线描边');

const rgba=makePng(8,8,(x,y)=>y<4?(x<4?[255,0,0,128]:[0,0,255,255]):(x<4?[0,255,0,255]:[255,255,255,0]),undefined,true);
const picture=`<p:pic><p:nvPicPr><p:cNvPr id="${nextShapeId()}" name="裁剪透明图片"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rIdImage"/><a:srcRect l="25000" r="25000" t="12500" b="12500"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(40)}" y="${px(40)}"/><a:ext cx="${px(160)}" cy="${px(160)}"/></a:xfrm>
<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></p:spPr></p:pic>`;
// 与 image-content 固件共用的有效 1×1 渐进 JPEG；不在运行时用有版本差异的编码器生成。
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABD/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/EH//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAECAQE/EH//xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAE/EH//2Q==','base64');
const jpegPicture=picture.replace('rIdImage','rIdJpeg').replace(/id="\d+"/,`id="${nextShapeId()}"`)
  .replace(`<a:off x="${px(40)}"`,`<a:off x="${px(240)}"`).replace('prst="ellipse"','prst="rect"')
  .replace('<a:ln><a:noFill/></a:ln>','<a:ln w="28575"><a:solidFill><a:srgbClr val="808080"/></a:solidFill></a:ln>');
const imageRel='<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/alpha.png"/>';
writeFileSync(new URL('../fixtures/sample-vector-pdf-images.pptx',import.meta.url),deck({
  name:'VectorPdfImages',width:640,height:360,slides:[slideXml(picture+label('ABC',280),
    '<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFD54F"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>'),
    slideXml(picture+jpegPicture),slideXml(label('ABC',40))],
  slideRelationships:[imageRel,imageRel+'<Relationship Id="rIdJpeg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/source.jpg"/>'],
  extraTypes:'<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/>',
  extraEntries:[['ppt/media/alpha.png',rgba],['ppt/media/source.jpg',jpeg]],
}));
console.log('fixtures/sample-vector-pdf-images.pptx：RGBA 图片、裁剪、背景叠加与独立文字');

const shadow=sp({x:40,y:40,w:160,h:100,fill:'<a:solidFill><a:srgbClr val="E53935"/></a:solidFill>'})
  .replace('</p:spPr>','<a:effectLst><a:outerShdw blurRad="114300" dist="152400" dir="2700000"><a:srgbClr val="000000"><a:alpha val="60000"/></a:srgbClr></a:outerShdw></a:effectLst></p:spPr>');
const shadowText=shadow.replace(/id="\d+"/,`id="${nextShapeId()}"`).replace('<a:p><a:endParaRPr/></a:p>',`<a:p>${run('AV office')}</a:p>`);
const effectGroup=`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${nextShapeId()}" name="旋转缩放组"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="1800000"><a:off x="${px(200)}" y="${px(50)}"/><a:ext cx="${px(300)}" cy="${px(240)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(250)}" cy="${px(200)}"/></a:xfrm></p:grpSpPr>${shadowText}</p:grpSp>`;
const shadowPicture=picture.replace(/id="\d+"/,`id="${nextShapeId()}"`)
  .replace('</p:spPr>',/<a:effectLst>[\s\S]*?<\/a:effectLst>/.exec(shadow)[0]+'</p:spPr>');
const cssPicture=picture.replace(/id="\d+"/,`id="${nextShapeId()}"`)
  .replace('<a:blip r:embed="rIdImage"/>','<a:blip r:embed="rIdImage"><a:grayscl/></a:blip>');
writeFileSync(new URL('../fixtures/sample-vector-pdf-effects.pptx',import.meta.url),deck({
  name:'VectorPdfEffects',width:640,height:360,slides:[slideXml(shadow+label('ABC',280)),slideXml(effectGroup+label('ABC',40)),
    slideXml(shadowPicture+label('ABC',280)),slideXml(cssPicture+label('ABC',280))],slideRelationships:['','',imageRel,imageRel],
  extraTypes:'<Default Extension="png" ContentType="image/png"/>',extraEntries:[['ppt/media/alpha.png',rgba]],
}));
console.log('fixtures/sample-vector-pdf-effects.pptx：局部阴影与相邻可搜索文字');

const transparent=sp({x:40,y:40,w:160,h:100,
  fill:'<a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill>',
  ln:'<a:ln w="76200"><a:solidFill><a:srgbClr val="0000FF"><a:alpha val="25000"/></a:srgbClr></a:solidFill></a:ln>'});
const opaque=sp({x:280,y:40,w:100,h:100,fill:'<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>'});
const gradient=radial=>'<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>'
  +'<a:gs pos="50000"><a:srgbClr val="00FF00"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst>'
  +(radial?'<a:path path="circle"/>':'<a:lin ang="0" scaled="1"/>')+'</a:gradFill>';
const axial=sp({x:40,y:40,w:160,h:100,fill:gradient(false),ln:'<a:ln w="28575"><a:solidFill><a:srgbClr val="333333"/></a:solidFill></a:ln>'});
const radial=sp({x:280,y:40,w:200,h:100,prst:'ellipse',rot:30*60000,fill:gradient(true)});
const alphaGradient=gradient(false).replace('val="00FF00"/>','val="00FF00"><a:alpha val="50000"/></a:srgbClr>')
  .replace('val="0000FF"/>','val="0000FF"><a:alpha val="0"/></a:srgbClr>');
const hardGradient=gradient(false).replace('<a:gs pos="50000"><a:srgbClr val="00FF00"/></a:gs>',
  '<a:gs pos="50000"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="50000"><a:srgbClr val="0000FF"/></a:gs>');
const alphaPicture=picture.replace(/id="\d+"/,`id="${nextShapeId()}"`).replace('<a:blip r:embed="rIdImage"/>',
  '<a:blip r:embed="rIdImage"><a:alphaModFix amt="50000"/></a:blip>');
writeFileSync(new URL('../fixtures/sample-vector-pdf-paints.pptx',import.meta.url),deck({
  name:'VectorPdfPaints',width:640,height:360,slides:[slideXml(transparent+opaque+label('ABC',440)),slideXml(axial+radial),
    slideXml(sp({x:40,y:40,w:160,h:100,fill:alphaGradient})+sp({x:280,y:40,w:200,h:100,fill:hardGradient})),
    slideXml(alphaPicture+opaque)],slideRelationships:['','','',imageRel],
  extraTypes:'<Default Extension="png" ContentType="image/png"/>',extraEntries:[['ppt/media/alpha.png',rgba]],
}));
console.log('fixtures/sample-vector-pdf-paints.pptx：透明填充与独立透明描边');

const decorated=(x,y,attributes,extra='')=>sp({x,y,w:220,h:100,fill:'<a:noFill/>',text:`<a:p><a:r><a:rPr sz="2400" ${attributes}>
<a:latin typeface="WebPPT Glyph Latin"/>${extra}</a:rPr><a:t>ABC</a:t></a:r></a:p>`});
const underlineColor='<a:uFill><a:solidFill><a:srgbClr val="1565C0"/></a:solidFill></a:uFill>';
writeFileSync(new URL('../fixtures/sample-vector-pdf-decoration.pptx',import.meta.url),deck({
  name:'VectorPdfDecoration',width:640,height:360,slides:[slideXml(decorated(40,40,'u="sng"',underlineColor)
    +decorated(40,160,'strike="sngStrike"')+decorated(360,40,'')+decorated(360,160,'u="sng" strike="sngStrike"',underlineColor)),
    slideXml(decorated(40,40,'u="sng"',underlineColor).replace('<a:t>ABC</a:t>','<a:t>q̇</a:t>')
      +decorated(360,40,'').replace('<a:t>ABC</a:t>','<a:t>q̇</a:t>'))],
}));
console.log('fixtures/sample-vector-pdf-decoration.pptx：下划线、删除线与普通文字');

const missingLabel=sp({x:40,y:40,w:220,h:100,fill:'<a:noFill/>',text:`<a:p>${run('ABC','Unavailable PDF Font')}</a:p>`});
const missingGroup=effectGroup.replace(shadowText,missingLabel);
writeFileSync(new URL('../fixtures/sample-vector-pdf-font-errors.pptx',import.meta.url),deck({
  name:'VectorPdfFontErrors',width:640,height:360,slides:[slideXml(label('A',40),'','show="0"'),
    slideXml(label('ABC',40)+missingGroup)],
}));
console.log('fixtures/sample-vector-pdf-font-errors.pptx：隐藏页之后的组内缺失字体');

const smallCaps=decorated(40,40,'cap="small"').replace('<a:t>ABC</a:t>','<a:t>abc</a:t>');
const warped=decorated(40,40,'').replace('<a:bodyPr anchor="ctr"/>','<a:bodyPr anchor="ctr"><a:prstTxWarp prst="textArchUp"><a:avLst/></a:prstTxWarp></a:bodyPr>');
const arrow=sp({x:40,y:40,w:180,h:100,prst:'line',fill:'<a:noFill/>',
  ln:'<a:ln w="38100"><a:solidFill><a:srgbClr val="1565C0"/></a:solidFill><a:tailEnd type="triangle" w="lg" len="lg"/></a:ln>'});
const border='<a:solidFill><a:srgbClr val="1565C0"/></a:solidFill>';
const table=`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="${nextShapeId()}" name="表格边线"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>
<p:xfrm><a:off x="${px(40)}" y="${px(40)}"/><a:ext cx="${px(180)}" cy="${px(100)}"/></p:xfrm>
<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl><a:tblPr/><a:tblGrid><a:gridCol w="${px(180)}"/></a:tblGrid>
<a:tr h="${px(100)}"><a:tc><a:txBody><a:bodyPr/><a:lstStyle/><a:p>${run('ABC')}</a:p></a:txBody><a:tcPr>
${['L','R','T','B'].map(side=>`<a:ln${side} w="38100">${border}</a:ln${side}>`).join('')}</a:tcPr></a:tc></a:tr>
</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`;
const video=`<p:pic><p:nvPicPr><p:cNvPr id="${nextShapeId()}" name="视频播放标识"/><p:cNvPicPr/>
<p:nvPr><a:videoFile r:link="rIdVideo"/></p:nvPr></p:nvPicPr><p:blipFill><a:blip/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(40)}" y="${px(40)}"/><a:ext cx="${px(180)}" cy="${px(100)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const zeroLine=table.replace('<a:lnB w="38100">','<a:lnB w="0">');
writeFileSync(new URL('../fixtures/sample-vector-pdf-coverage.pptx',import.meta.url),deck({
  name:'VectorPdfCoverage',width:640,height:360,slides:[slideXml(smallCaps+label('ABC',360)),
    slideXml(warped+label('ABC',360)),slideXml(arrow+label('ABC',360)),slideXml(table+label('ABC',360)),slideXml(video+label('ABC',360)),
    slideXml(zeroLine+label('ABC',360))],
  slideRelationships:['','','','','<Relationship Id="rIdVideo" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/video" Target="https://example.test/video.mp4" TargetMode="External"/>'],
}));
console.log('fixtures/sample-vector-pdf-coverage.pptx：小型大写、艺术字、线端箭头与原生表格');

const markerLine=(type,x,y,w,h,extra='',prst='line',dims='w="lg" len="lg"')=>sp({x,y,w,h,prst,fill:'<a:noFill/>',
  ln:`<a:ln w="38100" cap="rnd"><a:solidFill><a:srgbClr val="1565C0">${extra}</a:srgbClr></a:solidFill><a:prstDash val="dash"/>
  <a:headEnd type="${type}" ${dims}/><a:tailEnd type="${type}" ${dims}/></a:ln>`});
const curvePath=`<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst>
<a:path w="200" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo>
<a:cubicBezTo><a:pt x="0" y="0"/><a:pt x="0" y="80"/><a:pt x="100" y="80"/></a:cubicBezTo>
<a:cubicBezTo><a:pt x="180" y="80"/><a:pt x="200" y="0"/><a:pt x="200" y="0"/></a:cubicBezTo></a:path></a:pathLst></a:custGeom>`;
const cubicMarkers=markerLine('stealth',320,40,200,100).replace(/<a:prstGeom[\s\S]*?<\/a:prstGeom>/,curvePath);
const groupedMarker=markerLine('arrow',20,20,180,100,'','curvedConnector2','w="sm" len="lg"');
const markerGroup=`<p:grpSp><p:nvGrpSpPr><p:cNvPr id="${nextShapeId()}" name="箭头组变换"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm rot="1800000"><a:off x="${px(180)}" y="${px(50)}"/><a:ext cx="${px(300)}" cy="${px(180)}"/>
<a:chOff x="0" y="0"/><a:chExt cx="${px(250)}" cy="${px(200)}"/></a:xfrm></p:grpSpPr>${groupedMarker}</p:grpSp>`;
const markerLabel=sp({x:40,y:280,w:100,h:70,fill:'<a:noFill/>',text:`<a:p>${run('ABC')}</a:p>`});
writeFileSync(new URL('../fixtures/sample-vector-pdf-markers.pptx',import.meta.url),deck({
  name:'VectorPdfMarkers',width:640,height:360,slides:[slideXml(['triangle','stealth','diamond','oval','arrow'].map((type,i)=>
    markerLine(type,80,40+i*55,260,0,i===2?'<a:alpha val="50000"/>':'','line',i===4?'w="sm" len="lg"':'w="lg" len="lg"')).join('')+markerLabel),
    slideXml(markerLine('triangle',40,40,180,100,'','curvedConnector2')+cubicMarkers+markerLabel),
    slideXml(markerGroup+markerLabel),
    slideXml(markerLine('triangle',80,60,200,100)+markerLine('oval',330,60,200,100)+markerLine('arrow',420,230,100,60)+markerLabel),
    slideXml(markerLine('stealth',70,50,400,160)+markerLabel)],
}));
console.log('fixtures/sample-vector-pdf-markers.pptx：五种线端、曲线切线和组变换');

const patternFill=(preset,alpha='')=>`<a:pattFill prst="${preset}"><a:fgClr><a:srgbClr val="1565C0">${alpha}</a:srgbClr></a:fgClr>
<a:bgClr><a:srgbClr val="FFF4D6"/></a:bgClr></a:pattFill>`;
const patterned=sp({x:30,y:20,w:150,h:90,prst:'ellipse',fill:patternFill('diagCross')});
const patternGroup=markerGroup.replace(groupedMarker,patterned);
const presets=['pct5','pct10','pct20','pct25','pct30','pct40','pct50','pct60','pct70','pct75','pct80','pct90',
  'ltHorz','horz','dkHorz','ltVert','vert','dkVert','ltUpDiag','upDiag','ltDnDiag','dnDiag','smGrid','lgGrid','cross','diagCross','trellis','wave'];
writeFileSync(new URL('../fixtures/sample-vector-pdf-patterns.pptx',import.meta.url),deck({
  name:'VectorPdfPatterns',width:640,height:360,slides:[
    slideXml(sp({x:40,y:40,w:160,h:100,fill:patternFill('pct50')})
      +sp({x:300,y:40,w:160,h:100,fill:patternFill('upDiag'),rot:1800000})+markerLabel),
    slideXml(presets.map((preset,i)=>sp({x:30+(i%6)*100,y:15+Math.floor(i/6)*50,w:70,h:36,fill:patternFill(preset)})).join('')+markerLabel),
    slideXml(patternGroup+sp({x:40,y:180,w:120,h:70,fill:patternFill('pct50','<a:alpha val="50000"/>'),
      ln:'<a:ln w="38100"><a:solidFill><a:srgbClr val="E53935"/></a:solidFill><a:prstDash val="dash"/></a:ln>'})+markerLabel),
    slideXml(markerLabel.replace('WebPPT Glyph Latin','WebPPT Glyph Chinese').replace('<a:t>ABC</a:t>','<a:t>中文</a:t>'))],
}));
console.log('fixtures/sample-vector-pdf-patterns.pptx：图案单元、变换、透明度与独立文字');

const fillImage=makePng(128,96,(x,y)=>y<48?(x<64?[240,30,20,128]:[20,70,240,255]):(x<64?[40,180,60,255]:[220,180,40,0]),undefined,true);
const bitmapFill=(crop='',tile='',alpha='')=>`<a:blipFill><a:blip r:embed="rIdImage">${alpha}</a:blip>${crop}
${tile?`<a:tile ${tile}/>`:'<a:stretch><a:fillRect/></a:stretch>'}</a:blipFill>`;
const imageCrop='<a:srcRect l="12500" r="25000" t="12500" b="12500"/>';
const tiledShape=sp({x:30,y:20,w:150,h:90,prst:'ellipse',fill:bitmapFill(imageCrop,`sx="75000" sy="50000" tx="${px(13)}" ty="${px(-5)}" algn="ctr" flip="xy"`)});
const tiledGroup=markerGroup.replace(groupedMarker,tiledShape);
const fillBackground='<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFD54F"/></a:solidFill><a:effectLst/></p:bgPr></p:bg>';
writeFileSync(new URL('../fixtures/sample-vector-pdf-image-patterns.pptx',import.meta.url),deck({
  name:'VectorPdfImagePatterns',width:640,height:360,slides:[
    slideXml(sp({x:40,y:40,w:180,h:120,fill:bitmapFill()})
      +sp({x:320,y:40,w:180,h:120,prst:'ellipse',fill:bitmapFill('<a:srcRect l="25000" r="0" t="12500" b="12500"/>')})+markerLabel,fillBackground),
    slideXml(['none','x','y','xy'].map((flip,i)=>sp({x:40+(i%2)*220,y:40+Math.floor(i/2)*135,w:150,h:90,
      fill:bitmapFill('',`sx="50000" sy="50000" tx="${px(10)}" ty="${px(-6)}" algn="tl" flip="${flip}"`)})).join('')+markerLabel,fillBackground),
    slideXml(tiledGroup+sp({x:40,y:180,w:120,h:70,fill:bitmapFill('','','<a:alphaModFix amt="50000"/>')})+markerLabel,fillBackground),
    slideXml(markerLabel,`<p:bg><p:bgPr>${bitmapFill('','sx="100000" sy="100000" tx="0" ty="0" algn="tl" flip="none"')}<a:effectLst/></p:bgPr></p:bg>`),
    slideXml(markerLabel)],
  slideRelationships:[imageRel,imageRel,imageRel,imageRel],extraTypes:'<Default Extension="png" ContentType="image/png"/>',
  extraEntries:[['ppt/media/alpha.png',fillImage]],
}));
console.log('fixtures/sample-vector-pdf-image-patterns.pptx：图片填充、裁剪、平铺偏移与交替翻转');

const normalizedSamples=vectorPdfNormalizationSamples();
const normalizationName=(sample,i)=>`normalized-${i}.${sample.mime.split('/')[1]}`;
const normalizationPicture=sample=>`<p:pic><p:nvPicPr><p:cNvPr id="${nextShapeId()}" name="${sample.name}"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>
<p:blipFill><a:blip r:embed="rIdImage"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>
<p:spPr><a:xfrm><a:off x="${px(40)}" y="${px(40)}"/><a:ext cx="${px(160)}" cy="${px(100)}"/></a:xfrm>
<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:ln><a:noFill/></a:ln></p:spPr></p:pic>`;
writeFileSync(new URL('../fixtures/sample-vector-pdf-normalization.pptx',import.meta.url),deck({
  name:'VectorPdfNormalization',width:640,height:360,
  slides:normalizedSamples.map(sample=>slideXml(normalizationPicture(sample)+markerLabel,fillBackground)),
  slideRelationships:normalizedSamples.map((sample,i)=>`<Relationship Id="rIdImage" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/${normalizationName(sample,i)}"/>`),
  extraTypes:normalizedSamples.map((sample,i)=>`<Override PartName="/ppt/media/${normalizationName(sample,i)}" ContentType="${sample.mime}"/>`).join(''),
  extraEntries:normalizedSamples.map((sample,i)=>[`ppt/media/${normalizationName(sample,i)}`,sample.bytes]),
}));
console.log('fixtures/sample-vector-pdf-normalization.pptx：PNG 色彩 / 布局、八种 EXIF 方向与浏览器图片格式');
