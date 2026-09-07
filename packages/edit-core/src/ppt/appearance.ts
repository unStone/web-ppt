import type { Fill, Stroke } from '@web-ppt/core';
import { rgba,type Property } from './binary';
export function fillProperties(fill:Fill|null):Property[] {
  if(!fill||fill.type==='none')return [{id:447,value:0x100000}];
  if(fill.type!=='solid')throw new Error('PPT 写入暂不支持渐变、图案或图片形状填充');
  const c=rgba(fill.color);
  return [{id:384,value:0},{id:385,value:c.rgb},{id:386,value:Math.round(c.alpha*65536)},{id:447,value:0x100010}];
}
export function strokeProperties(stroke:Stroke|null|undefined):Property[] {
  if(!stroke)return [{id:511,value:0x80000}];
  if(stroke.compound&&stroke.compound!=='sng')throw new Error('PPT 写入暂不支持复合线型');
  if(stroke.dash?.length)throw new Error('PPT 写入暂不支持自定义虚线');
  if(!Number.isFinite(stroke.width)||stroke.width<0)throw new Error('PPT 线宽无效');
  const c=rgba(stroke.color),p:Property[]=[{id:448,value:c.rgb},{id:449,value:Math.round(c.alpha*65536)},
    {id:459,value:Math.round(stroke.width*9525)},{id:511,value:0x80008}];
  if(stroke.cap)p.push({id:471,value:{round:0,square:1,butt:2}[stroke.cap]});
  if(stroke.join)p.push({id:470,value:{round:1,bevel:0,miter:2}[stroke.join]});
  for(const [end,id] of [[stroke.head,464],[stroke.tail,465]] as const)if(end&&end.type!=='none'){
    if(end.w!==3||end.h!==3)throw new Error('PPT 写入暂不支持自定义箭头尺寸');
    p.push({id,value:{triangle:1,stealth:2,diamond:3,oval:4,arrow:5}[end.type]});
  }
  return p;
}
