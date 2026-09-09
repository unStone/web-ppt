import {readFileSync} from 'node:fs';
import {zlibSync} from 'fflate';
import {crc32,makePng,makeBmp} from './ooxml.mjs';

const chunk=(type,data)=>{
  const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);result.write(type,4);result.set(data,8);
  result.writeUInt32BE(crc32(result.subarray(4,-4)),result.length-4);return result;
};
const extra=(png,type,data)=>Buffer.concat([png.subarray(0,33),chunk(type,data),png.subarray(33)]);
function indexed(){
  const header=Buffer.alloc(13);header.writeUInt32BE(16);header.writeUInt32BE(8,4);header[8]=2;header[9]=3;
  const raw=Buffer.alloc(8*5);
  for(let y=0;y<8;y++)for(let x=0;x<16;x++)raw[y*5+1+(x>>2)]|=((Math.floor(x/4)+Math.floor(y/4))%4)<<(6-(x%4)*2);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),
    chunk('PLTE',Buffer.from([229,57,53,21,101,192,67,160,71,255,213,79])),chunk('tRNS',Buffer.from([255,128,0,255])),
    chunk('IDAT',zlibSync(raw)),chunk('IEND',Buffer.alloc(0))]);
}
function interlaced(){
  const header=Buffer.alloc(13);header.writeUInt32BE(16);header.writeUInt32BE(8,4);header[8]=16;header[9]=6;header[12]=1;
  const raw=[];
  for(const [sx,sy,dx,dy] of [[0,0,8,8],[4,0,8,8],[0,4,4,8],[2,0,4,4],[0,2,2,4],[1,0,2,2],[0,1,1,2]]){
    for(let y=sy;y<8;y+=dy){raw.push(0);for(let x=sx;x<16;x+=dx)for(const value of [x*16,y*32,96,x<8?128:255])raw.push(value,value);}
  }
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlibSync(new Uint8Array(raw))),chunk('IEND',Buffer.alloc(0))]);
}
function gif(){
  // 每个像素前发 clear code，保持 3-bit 码宽；固件无需引入通用 GIF 编码器。
  const codes=[];for(let y=0;y<8;y++)for(let x=0;x<16;x++)codes.push(4,(Math.floor(x/8)+2*Math.floor(y/4))%4);codes.push(5);
  const data=Buffer.alloc(Math.ceil(codes.length*3/8));let bit=0;
  for(const code of codes)for(let k=0;k<3;k++,bit++)data[bit>>3]|=((code>>k)&1)<<(bit%8);
  return Buffer.concat([Buffer.from('47494638396110000800810000','hex'),Buffer.from([229,57,53,21,101,192,67,160,71,255,213,79]),
    Buffer.from('21f90401000002002c00000000100008000002','hex'),Buffer.from([data.length]),data,Buffer.from([0,0x3b])]);
}
function oriented(jpeg,orientation){
  const tiff=Buffer.from('49492a0008000000010012010300010000000000000000000000','hex');tiff.writeUInt16LE(orientation,18);
  const data=Buffer.concat([Buffer.from('Exif\0\0'),tiff]),segment=Buffer.alloc(data.length+4);segment[0]=0xff;segment[1]=0xe1;segment.writeUInt16BE(data.length+2,2);segment.set(data,4);
  return Buffer.concat([jpeg.subarray(0,2),segment,jpeg.subarray(2)]);
}
export function vectorPdfNormalizationSamples(){
  // 固定的小图字节含浏览器生成的 sRGB ICC；重生成固件不再调用有版本差异的 JPEG / WebP 编码器。
  const seeds=JSON.parse(readFileSync(new URL('./vector-pdf-codec-seeds.json',import.meta.url),'utf8'));
  const gamma=Buffer.alloc(4);gamma.writeUInt32BE(100000);
  const ordinary=makePng(16,8,(x,y)=>[x<8?64:128,y<4?128:192,64]);
  const transparent=makePng(16,8,x=>x<8?[10,20,30]:[160,80,40]);
  return [
    {name:'gamma',mime:'image/png',bytes:extra(ordinary,'gAMA',gamma),reason:'image-png-color'},
    {name:'palette',mime:'image/png',bytes:indexed(),reason:'image-png-layout'},
    {name:'transparent-key',mime:'image/png',bytes:extra(transparent,'tRNS',Buffer.from([0,10,0,20,0,30])),reason:'image-png-layout'},
    {name:'adam7-16',mime:'image/png',bytes:interlaced(),reason:'image-png-layout'},
    ...Array.from({length:8},(_,i)=>({name:`exif-${i+1}`,mime:'image/jpeg',bytes:oriented(Buffer.from(seeds.jpeg,'base64'),i+1),reason:'image-jpeg-metadata'})),
    {name:'bmp',mime:'image/bmp',bytes:makeBmp(16,8,(x,y)=>[x*16,y*32,96]),reason:'image-bmp-format'},
    {name:'gif',mime:'image/gif',bytes:gif(),reason:'image-gif-format'},
    {name:'webp',mime:'image/webp',bytes:Buffer.from(seeds.webp,'base64'),reason:'image-webp-format'},
  ];
}
