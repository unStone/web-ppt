import type { ElementBase, Fill, SlideElement } from '@web-ppt/core';
import { atom,concat,container,properties,signed,u16,u32,utf16,type Property } from './binary';
import { fillProperties,strokeProperties } from './appearance';
import { geometry } from './geometry';
import { FontTable,textRecords } from './text';
import { Pictures } from './pictures';

const coords=(v:readonly number[])=>concat(v.map(n=>u32(signed(n*6,'组内坐标'))));
function anchor(el:ElementBase,child:boolean):Uint8Array {
  if(child)return atom(0xf00f,coords([el.x,el.y,el.x+el.w,el.y+el.h]));
  return atom(0xf010,concat([el.y,el.x,el.x+el.w,el.y+el.h].map(n=>{
    const v=Math.round(n*6);if(!Number.isFinite(v)||v<-32768||v>32767)throw new Error('PPT 顶层坐标超过 16 位范围');return u16(v);
  })));
}
export class Drawings {
  readonly clusters:{id:number;used:number}[]=[];
  private next=1024;
  private count=0;
  constructor(readonly fonts:FontTable,readonly pictures:Pictures){}
  private identity(drawing:number):number {
    let cluster=this.clusters[this.clusters.length-1];
    if(!cluster||cluster.id!==drawing||cluster.used===1024){
      this.next=(this.clusters.length+1)*1024;cluster={id:drawing,used:0};this.clusters.push(cluster);
    }
    cluster.used++;this.count++;return this.next++;
  }
  private element(el:SlideElement,drawing:number,child=false,depth=0,notePlaceholder=0):Uint8Array {
    if(depth>7)throw new Error('PPT 组合嵌套超过 8 层');
    if(![el.x,el.y,el.w,el.h,el.rot].every(Number.isFinite)||el.w<=0||el.h<=0)throw new Error('PPT 元素尺寸无效');
    if(el.link||el.editInfo?.readonlyLink)throw new Error('PPT 写入暂不支持超链接');
    if(el.effects&&Object.keys(el.effects).length||el.scene3d)throw new Error('PPT 写入暂不支持形状特效或三维');
    if(el.editInfo?.requiresOriginal||el.editInfo?.editable==='frame')throw new Error('此原生对象必须保留原格式，请保存为 PPTX');
    if(el.kind==='unsupported'||el.kind==='table')throw new Error('PPT 写入暂不支持表格或未知对象');
    const id=this.identity(drawing),flags=0xa00|(child?2:0)|(el.flipH?64:0)|(el.flipV?128:0);
    const props:Property[]=[{id:4,value:Math.round(((el.rot%360+360)%360)*65536)}];
    if(el.name)props.push({id:896,value:utf16(el.name,true)});
    if(el.editInfo?.altText?.descr)props.push({id:897,value:utf16(el.editInfo.altText.descr,true)});
    if(el.kind==='group'){
      if(!Number.isFinite(el.scaleX)||!Number.isFinite(el.scaleY)||el.scaleX<=0||el.scaleY<=0)throw new Error('PPT 组合缩放无效');
      return container(0xf003,[container(0xf004,[atom(0xf009,coords([el.childX,el.childY,el.childX+el.w/el.scaleX,el.childY+el.h/el.scaleY]),1),
        atom(0xf00a,concat([u32(id),u32(flags|1)]),2),properties(props),anchor(el,child)]),
        ...el.children.map(k=>this.element(k,drawing,true,depth+1,notePlaceholder))]);
    }
    let textbox:Uint8Array|undefined;
    if(el.kind==='image'){
      if(el.crop&&Object.values(el.crop).some(Boolean)||el.clipPath||el.filter||el.duotone||el.alpha!==undefined&&el.alpha!==1||el.media)throw new Error('PPT 写入暂不支持裁剪、图片效果或音视频');
      props.push({id:260,value:this.pictures.add(el.src),blip:true},...fillProperties(null),...strokeProperties(el.stroke));
    }else {
      props.push(...geometry(el),...fillProperties(el.openGeom?null:el.fill),...strokeProperties(el.stroke));
      if(el.text){
        const text=el.text;
        props.push({id:128,value:id<<16},{id:129,value:Math.round(text.insets[3]*9525)},
          {id:130,value:Math.round(text.insets[0]*9525)},{id:131,value:Math.round(text.insets[1]*9525)},
          {id:132,value:Math.round(text.insets[2]*9525)},{id:133,value:text.wrap?0:2},
          {id:135,value:{top:0,middle:1,bottom:2}[text.anchor]});
        textbox=atom(0xf00d,textRecords(text,this.fonts,notePlaceholder?2:4));
      }
    }
    return container(0xf004,[atom(0xf00a,concat([u32(id),u32(flags)]),2,el.kind==='image'?75:el.path===null?202:0),
      properties(props),anchor(el,child),...(textbox?[textbox]:[]),
      ...(notePlaceholder?[atom(0xf011,atom(0x0bc3,concat([u32(0),new Uint8Array([notePlaceholder,0,0,0])])) )]:[])]);
  }
  drawing(elements:readonly SlideElement[],background:Fill|null,drawing:number,notePlaceholder=0):Uint8Array {
    const before=this.count,root=this.identity(drawing);
    const children=elements.map(e=>this.element(e,drawing,false,0,notePlaceholder));
    const bg=this.identity(drawing);
    return container(0x040c,[container(0xf002,[atom(0xf008,concat([u32(this.count-before),u32(this.next-1)]),0,drawing),
      container(0xf003,[container(0xf004,[atom(0xf009,new Uint8Array(16),1),atom(0xf00a,concat([u32(root),u32(5)]),2)]),...children]),
      container(0xf004,[atom(0xf00a,concat([u32(bg),u32(0xc00)]),2,1),properties([...fillProperties(background),...strokeProperties(null)])])])]);
  }
  group():Uint8Array {
    const drawingCount=new Set(this.clusters.map(c=>c.id)).size;
    return container(0x040b,[container(0xf000,[atom(0xf006,concat([u32(this.next),u32(this.clusters.length+1),u32(this.count),u32(drawingCount),
      ...this.clusters.flatMap(c=>[u32(c.id),u32(c.used)])])),this.pictures.store(),
      atom(0xf11e,concat([u32(0x0800000d),u32(0x0800000c),u32(0x08000017),u32(0x100000f7)]))])]);
  }
}
