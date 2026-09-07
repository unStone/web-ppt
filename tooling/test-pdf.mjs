import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { resolve, join } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { recordCount } from './lib/measured.mjs';
const root=resolve('.'),out=join(root,'out/pdf');mkdirSync(out,{recursive:true});
const entry=join(out,'entry.mjs');writeFileSync(entry,`export * from '${root}/packages/core/src/pdf.ts'; export { pdfImage } from '${root}/packages/core/src/pdf/png.ts';`);
const bundled=await bundleBrowser({root,entry,output:join(out,'contract.mjs'),aliases:[['@web-ppt/core',join(root,'packages/core/src/index.ts')]]});
const {PdfDocument,presentationToPdf}=process.argv.includes('--dist') ? await import('@web-ppt/core/pdf') : bundled;
const {pdfImage}=bundled;
let count=0; const check=(value,label)=>{assert(value,label);count++;}; const rejects=(fn,pattern)=>{assert.throws(fn,pattern);count++;};
const crc=bytes=>{let v=0xffffffff;for(const b of bytes){v^=b;for(let i=0;i<8;i++)v=v>>>1^((v&1)?0xedb88320:0);}return(v^0xffffffff)>>>0;};
const chunk=(type,data)=>{const b=Buffer.alloc(data.length+12);b.writeUInt32BE(data.length);b.write(type,4);b.set(data,8);b.writeUInt32BE(crc(b.subarray(4,-4)),b.length-4);return b;};
const png=(color,raw,filter=0)=>{
 const channels={0:1,2:3,4:2,6:4}[color],header=Buffer.alloc(13);header.writeUInt32BE(raw.length/channels);header.writeUInt32BE(1,4);header[8]=8;header[9]=color;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.from([filter,...raw]))),chunk('IEND',Buffer.alloc(0))]);
};
const pixels=png(6,[255,0,0,255,0,0,255,128]);
check([...inflateSync(pdfImage(pixels).compressed)].join()==='255,0,0,127,127,255','PNG alpha composited on white');
check([...inflateSync(pdfImage(png(0,[50,75])).compressed)].join()==='50,50,50,75,75,75','Grayscale');
check([...inflateSync(pdfImage(png(4,[40,0])).compressed)].join()==='255,255,255','Grayscale alpha');
for(let filter=0;filter<=4;filter++){
 const bytes=filter===1||filter===4?[20,30,40,30,40,50]:filter===3?[20,30,40,40,55,70]:[20,30,40,50,70,90];
 check([...inflateSync(pdfImage(png(2,bytes,filter)).compressed)].join()==='20,30,40,50,70,90',`PNG filter ${filter}`);
}
rejects(()=>pdfImage(pixels.subarray(0,-1)),/PNG/);rejects(()=>pdfImage(png(2,[1,2,3],5)),/滤波器/);
rejects(()=>new PdfDocument(NaN,10),/尺寸/);rejects(()=>new PdfDocument(1,1).finish(),/没有/);
const comments=[{id:'a',author:'作者 A',text:'中文批注 ( ) \\ endobj',x:10,y:20},{id:'b',parentId:'a',author:'B',text:'回复',x:10,y:20}];
function create(){const d=new PdfDocument(960,540,'PDF 固件');d.addPage(pixels,comments);d.addPage(pixels);return d.finish();}
const file=create();writeFileSync(join(out,'writer.pdf'),file);check(Buffer.from(file).equals(create()),'Deterministic bytes');
const source=Buffer.from(file).toString('latin1'),xref=Number(/startxref\n(\d+)/.exec(source)[1]);check(source.slice(xref,xref+4)==='xref','Byte xref start');
const offsets=[...source.slice(xref).matchAll(/(\d{10}) 00000 n/g)].map(m=>Number(m[1]));check(offsets.every((offset,i)=>source.startsWith(`${i+1} 0 obj\n`,offset)),'Every indirect object offset');
check(/\/Count 2\b/.test(source)&&/\/MediaBox \[0 0 960 540\]/.test(source),'Page count and point size');
check(/\/IRT \d+ 0 R \/RT \/R/.test(source),'Native comment reply');check(!source.includes(comments[0].text),'UTF16 PDF strings escape syntax');
const d=new PdfDocument(10,10);rejects(()=>d.addPage(pixels,[{...comments[0],x:NaN}]),/坐标/);d.addPage(pixels);d.finish();rejects(()=>d.addPage(pixels),/结束/);rejects(()=>d.finish(),/结束/);
await assert.rejects(()=>presentationToPdf({width:10,height:10,slides:[{elements:[]}]},{signal:AbortSignal.abort()}),e=>e.name==='AbortError');count++;
await assert.rejects(()=>presentationToPdf({width:10000,height:10000,slides:[]}),/像素/);count++;
recordCount('pdf',count);console.log(`PDF ${count} 项通过`);
