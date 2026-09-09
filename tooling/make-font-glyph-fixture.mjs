import {writeFileSync} from 'node:fs';
import {deck,slideXml,sp} from './lib/ooxml.mjs';
import {fontSample} from './lib/font-glyph-samples.mjs';
import {makeTtf} from './lib/font.mjs';
import {eotV2} from './lib/font-eot-v2.mjs';

const preview=eotV2(fontSample('latin.ttf')).bytes;
new DataView(preview.buffer).setUint16(32,4,true);
const fonts=[
  {family:'WebPPT Glyph Latin',regular:fontSample('latin.ttf'),bold:fontSample('latin-bold.ttf')},
  {family:'WebPPT Glyph Chinese',regular:fontSample('chinese.ttf')},
  {family:'WebPPT Glyph Italic',italic:makeTtf({family:'WebPPT Glyph Italic',italic:true})},
  {family:'WebPPT Glyph Preview',regular:preview},
];
const parts=[],declarations=[];
for(const font of fonts){
  const faces=[];
  for(const style of ['regular','bold','italic']){
    if(!font[style])continue;
    const id=parts.length+100,name=`font${parts.length+1}.fntdata`;
    parts.push({id,name,bytes:font[style]});faces.push(`<p:${style} r:id="rId${id}"/>`);
  }
  declarations.push(`<p:embeddedFont><p:font typeface="${font.family}"/>${faces.join('')}</p:embeddedFont>`);
}
const row=(text,y,family,attributes='',bodyPr='',pPr='')=>sp({x:60,y,w:1120,h:70,fill:'<a:noFill/>',bodyPr,
  text:`<a:p>${pPr}<a:r><a:rPr sz="3200" ${attributes}><a:latin typeface="${family}"/><a:ea typeface="${family}"/></a:rPr><a:t>${text}</a:t></a:r></a:p>`});
const slide=slideXml(row('AV office ffi ﬃ',60,fonts[0].family)+row('á q̇',140,fonts[0].family)+
  row('AV office ffi ﬃ',220,fonts[0].family,'b="1"')+row('中文 ABC 你好，世界。',300,fonts[1].family)+
  row('中文😀',380,fonts[0].family)+row('AAAA',460,fonts[2].family,'i="1"')+row('AV office',540,fonts[3].family));
const unsupported=slideXml(row('ABC',60,fonts[0].family,'','', '<a:pPr rtl="1"/>')+
  row('中文',180,fonts[1].family,'','<a:bodyPr vert="vert"/>')+
  row('ABC',300,fonts[0].family,'','<a:bodyPr><a:prstTxWarp prst="textArchUp"/></a:bodyPr>')+
  row('مرحبا',420,fonts[0].family)+row('ABC',540,fonts[0].family,'cap="small"'));
const archive=deck({name:'FontGlyphs',width:1280,height:720,slides:[slide,unsupported],
  presExtra:`<p:embeddedFontLst>${declarations.join('')}</p:embeddedFontLst>`,
  presRels:parts.map(p=>`<Relationship Id="rId${p.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/font" Target="fonts/${p.name}"/>`).join(''),
  extraTypes:'<Default Extension="fntdata" ContentType="application/x-fontdata"/>',
  extraEntries:parts.map(p=>[`ppt/fonts/${p.name}`,p.bytes])});
writeFileSync(new URL('../fixtures/sample-font-glyphs.pptx',import.meta.url),archive);
console.log('fixtures/sample-font-glyphs.pptx：连字、组合音标、汉字、真实字重/斜体和 EOT 外层预览限制');
