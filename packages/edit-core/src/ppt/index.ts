import { toSlide, type EditDoc } from '@web-ppt/edit-core';
import type { Slide, ShapeElement, TextBody } from '@web-ppt/core';
import { createCompoundFile } from '@web-ppt/edit-core/cfb';
import { atom,concat,container,u16,u32,utf16 } from './binary';
import { Drawings } from './drawing';
import { Pictures } from './pictures';
import { FontTable,defaultTextStyle } from './text';

export const PPT_MIME='application/vnd.ms-powerpoint';
export interface PptSaveIssue {readonly slide:number;readonly message:string}
export class PptSaveError extends Error {
  constructor(readonly issues:readonly PptSaveIssue[]){
    super(issues.map(i=>`${i.slide?`第 ${i.slide} 页：`:''}${i.message}`).join('\n'));this.name='PptSaveError';
  }
}
const scheme=()=>atom(0x07f0,concat([0xffffff,0,0x808080,0,0xffcccc,0xb2b2b2,0xcc3333,0x999900].map(u32)),0,1);
const persist=(id:number,slideId:number)=>atom(0x03f3,concat([u32(id),u32(4),u32(0),u32(slideId),u32(0)]));
function slideAtom(master:number,notes=0):Uint8Array {
  return atom(0x03ef,concat([u32(16),new Uint8Array(8),u32(master),u32(notes),u32(0)]),2);
}
function noteShape(text:string):ShapeElement {
  const body:TextBody={anchor:'top',insets:[4,4,4,4],wrap:true,fontScale:1,paragraphs:text.split(/\r?\n/).map(line=>({
    align:'left',lvl:0,marL:0,indent:0,bullet:null,lineHeight:null,spaceBefore:0,spaceAfter:0,
    runs:[{text:line,b:false,i:false,u:false,strike:false,size:20,color:'#000000',fonts:['Arial']}],
  }))};
  return {kind:'shape',x:48,y:300,w:624,h:500,rot:0,flipH:false,flipV:false,path:null,fill:null,stroke:null,text:body};
}
function showInfo(slide:Slide):Uint8Array {
  if(slide.transition)throw new Error('PPT 写入暂不支持页面切换，请保存为 PPTX');
  return atom(0x03f9,concat([u32(0),u32(0),u16(0),u16(slide.hidden?0x104:0x100),u32(2)]));
}
function build(doc:EditDoc):Uint8Array {
  if(doc.meta.readonly)throw new Error('只读文档不能保存 PPT');
  if(!doc.slideOrder.length||doc.slideOrder.length>1000)throw new Error('PPT 保存需要 1–1000 页');
  for(const n of [doc.meta.width,doc.meta.height])if(!Number.isFinite(n)||n<96||n>5376)throw new Error('PPT 页面尺寸必须在 96–5376 px 范围');
  if(doc.sections.order.length)throw new Error('PPT 写入暂不支持节，请保存为 PPTX');
  const fonts=new FontTable(),pictures=new Pictures(doc),drawings=new Drawings(fonts,pictures);
  const slides=doc.slideOrder.map(id=>toSlide(doc,id)),issues:PptSaveIssue[]=[],parts:Uint8Array[]=[];
  const masterId=0x80000000;
  const master=container(0x03f8,[slideAtom(0),drawings.drawing([], {type:'solid',color:'#ffffff'},1),scheme(),
    ...[0,1,2,4,5,6].map(defaultTextStyle)]);
  const slideIds:number[]=[],noteIds:number[]=[],noteParts:Uint8Array[]=[];
  let drawingId=2;
  slides.forEach((slide,index)=>{
    try {
      if(slide.animations?.length)throw new Error('PPT 写入暂不支持元素动画，请保存为 PPTX');
      if(slide.comments?.length)throw new Error('PPT 写入暂不支持批注，请保存为 PPTX');
      const id=256+index,notes=slide.notes?256+index:0;
      parts.push(container(0x03ee,[slideAtom(masterId,notes),showInfo(slide),drawings.drawing(slide.elements,slide.background,drawingId++),scheme()]));
      slideIds.push(id);
      if(notes){
        const drawing=drawings.drawing([noteShape(slide.notes!)],{type:'solid',color:'#ffffff'},drawingId++,12);
        noteParts.push(container(0x03f0,[atom(0x03f1,concat([u32(id),u32(7)])),drawing,scheme()]));noteIds.push(notes);
      }
    }catch(error){issues.push({slide:index+1,message:error instanceof Error?error.message:String(error)});}
  });
  if(issues.length)throw new PptSaveError(issues);
  const notesMaster=noteParts.length?container(0x03f0,[atom(0x03f1,new Uint8Array(8)),
    drawings.drawing([noteShape('')],{type:'solid',color:'#ffffff'},drawingId++,6),scheme()]):undefined;
  const docAtom=atom(0x03e9,concat([u32(Math.round(doc.meta.width*6)),u32(Math.round(doc.meta.height*6)),u32(4320),u32(5760),
    u32(1),u32(1),u32(notesMaster?3+slides.length+noteParts.length:0),u32(0),u16(1),u16(6),new Uint8Array(4)]),1);
  const document=container(0x03e8,[docAtom,
    container(0x03f2,[container(0x07d5,fonts.records()),atom(0x0fa9,u32(0)),defaultTextStyle(4)]),drawings.group(),
    container(0x0ff0,[persist(2,masterId)],1),container(0x0ff0,slideIds.map((id,i)=>persist(i+3,id))),
    ...(noteIds.length?[container(0x0ff0,noteIds.map((id,i)=>persist(slides.length+3+i,id)),2)]:[]),atom(0x03ea)]);
  const objects=[document,master,...parts,...noteParts,...(notesMaster?[notesMaster]:[])],offsets:number[]=[];let offset=0;
  for(const object of objects){offsets.push(offset);offset+=object.length;}
  const directory=atom(0x1772,concat([u32((offsets.length<<20)|1),...offsets.map(u32)]));
  const editOffset=offset+directory.length;
  const userEdit=atom(0x0ff5,concat([u32(256),u16(0),new Uint8Array([0,3]),u32(0),u32(offset),u32(1),u32(objects.length+1),u16(1),u16(0)]));
  const name='Web-PPT';
  const current=atom(0x0ff6,concat([u32(20),u32(0xe391c05f),u32(editOffset),u16(name.length),u16(0x03f4),new Uint8Array([3,0,0,0]),
    new TextEncoder().encode(name),u32(8),utf16(name)]));
  return createCompoundFile({'PowerPoint Document':concat([...objects,directory,userEdit]),'Current User':current,'Pictures':pictures.stream()});
}
/** 原生 PPT 生成保存。保持当前投影可编辑，不修改源包、历史或保存点。 */
export function savePpt(doc:EditDoc):Uint8Array {
  try{return build(doc);}catch(error){
    if(error instanceof PptSaveError)throw error;
    throw new PptSaveError([{slide:0,message:error instanceof Error?error.message:String(error)}]);
  }
}
