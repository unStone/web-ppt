import {writeFileSync} from 'node:fs';
import {deck,sp,slideXml,makePng,nextShapeId,NS,px} from './lib/ooxml.mjs';
const run=(text='AV AV',color='000000',font='WebPPT Glyph Latin',size=1200)=>`<a:p><a:r><a:rPr sz="${size}"><a:solidFill><a:srgbClr val="${color}"/></a:solidFill><a:latin typeface="${font}"/><a:ea typeface="${font}"/><a:cs typeface="${font}"/></a:rPr><a:t>${text}</a:t></a:r></a:p>`;
const shape=(name,x=40,y=40,w=200,h=80,text=run())=>sp({name,x,y,w,h,fill:'<a:noFill/>',text,bodyPr:'<a:bodyPr lIns="0" rIns="0" tIns="0" bIns="0"/>'});
const ph=()=>shape('prompt').replace('<p:nvPr/>','<p:nvPr><p:ph type="body" idx="1"/></p:nvPr>');
const pic=(w,h,crop='')=>`<p:pic><p:nvPicPr><p:cNvPr id="${nextShapeId()}" name="image"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="img"/>${crop}<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="${px(40)}" y="${px(40)}"/><a:ext cx="${px(w)}" cy="${px(h)}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
const slides=[
 shape('overflow',40,40,80,10,run('AV AV AV AV AV AV AV AV')),shape('fit'),
 shape('a',40,40,150,100)+shape('b',80,70,150,100),shape('a',40,40,150,100)+shape('b',300,40,150,100),
 shape('outside',620),shape('inside',400),
 shape('low',40,40,200,80,run('AV AV','767776')),shape('high'),
 shape('missing',40,40,200,80,run('AV AV','000000','Absent Typeface')),shape('available'),
 ph(),ph().replace('<a:t>AV AV</a:t>','<a:t>AV</a:t>'),
 pic(100,100),pic(200,100),pic(100,100,'<a:srcRect l="25000" r="25000"/>'),
];
writeFileSync(new URL('../fixtures/sample-agent-lint.pptx',import.meta.url),deck({name:'Agent lint',width:640,height:360,
 slides:slides.map(s=>slideXml(s)),layoutShapes:ph().replace('<a:t>AV AV</a:t>','<a:t>AV</a:t>').replace('</a:r>',`</a:r>\n  ${run(' AV').replace('<a:p>','').replace('</a:p>','')}\n`),
 slideRelationships:slides.map(()=>`<Relationship Id="img" Type="${NS.r}/image" Target="../media/image.png"/>`),
 extraTypes:'<Default Extension="png" ContentType="image/png"/>',extraEntries:[['ppt/media/image.png',makePng(80,40,()=>[32,64,128])]],
}));
