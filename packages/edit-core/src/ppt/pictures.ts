import { sourceAsset } from '@web-ppt/edit-core';
import type { EditDoc } from '../types';
import { atom,concat,u16,u32,view } from './binary';

/** 图片保持原 PNG/JPEG 字节；不把 SVG 或 OLE 的预览冒充原生对象。 */
export class Pictures {
  private readonly items: {record:Uint8Array;uid:Uint8Array;type:number;refs:number}[]=[];
  private readonly indexes=new Map<string,number>();
  constructor(private readonly doc:EditDoc){}
  add(url:string):number {
    const known=this.indexes.get(url);
    if(known){this.items[known-1].refs++;return known;}
    let bytes=sourceAsset(this.doc,url)?.bytes;
    if(!bytes){
      const match=/^data:image\/(?:png|jpe?g);base64,([a-zA-Z0-9+/=\r\n]+)$/.exec(url);
      if(!match)throw new Error('PPT 图片必须为可读取的内嵌 PNG/JPEG');
      bytes=Uint8Array.from(atob(match[1]),c=>c.charCodeAt(0));
    }
    const png=bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71;
    if(!png&&!(bytes[0]===255&&bytes[1]===216&&bytes[2]===255))throw new Error('PPT 图片仅支持 PNG/JPEG');
    // UID 只承担 BLIP 身份，按文档内稳定索引分配，不能带时钟或随机数。
    const uid=new Uint8Array(16);view(uid).setUint32(0,this.items.length+1,true);
    const record=atom(png?0xf01e:0xf01d,concat([uid,new Uint8Array([255]),bytes]),0,png?0x6e0:0x46a);
    this.items.push({record,uid,type:png?6:5,refs:1});this.indexes.set(url,this.items.length);return this.items.length;
  }
  stream():Uint8Array{return concat(this.items.map(i=>i.record));}
  store():Uint8Array {
    let offset=0;
    const children=this.items.map(item=>{
      const body=concat([new Uint8Array([item.type,item.type]),item.uid,u16(255),u32(item.record.length),u32(item.refs),u32(offset),new Uint8Array(4)]);
      offset+=item.record.length;return atom(0xf007,body,2,item.type);
    });
    return atom(0xf001,concat(children),15,children.length);
  }
}
