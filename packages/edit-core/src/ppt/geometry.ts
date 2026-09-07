import type { ShapeElement } from '@web-ppt/core';
import { customGeometryMarkup } from '../generate/custom-geometry';
import { parseXmlTree } from '../xml/tree';
import { findXmlAttribute,findXmlDescendant,xmlElementChildren } from '../xml/query';
import type { XmlElement } from '../xml/types';
import { concat,u16,u32,signed,type Property } from './binary';
type Point=[number,number];
const attr=(node:XmlElement,name:string)=>Number(findXmlAttribute(node,{localName:name})?.value??0);
const point=(node:XmlElement):Point=>[attr(node,'x')/9525,attr(node,'y')/9525];

/** 所有预设都已有格式无关轮廓；保持贝塞尔曲线，避免把未知预设猜成矩形。 */
export function geometry(shape:ShapeElement):Property[] {
  if(shape.path===null)return [];
  const tree=parseXmlTree(customGeometryMarkup(shape.path,shape.w,shape.h,!!shape.openGeom));
  const path=findXmlDescendant(tree.root,{localName:'path'});if(!path)throw new Error('PPT 几何没有路径');
  const points:Point[]=[],segments:number[]=[];let current:Point=[0,0],start:Point=[0,0];
  const curve=(a:Point,b:Point,c:Point)=>{segments.push(0x2001);points.push(a,b,c);current=c;};
  for(const node of xmlElementChildren(path)){
    const values=xmlElementChildren(node).map(point);
    if(node.localName==='moveTo'){segments.push(0x4000);points.push(values[0]);current=values[0];start=current;}
    else if(node.localName==='lnTo'){segments.push(1);points.push(values[0]);current=values[0];}
    else if(node.localName==='cubicBezTo')curve(values[0],values[1],values[2]);
    else if(node.localName==='quadBezTo'){
      const [control,end]=values;
      curve([current[0]+2*(control[0]-current[0])/3,current[1]+2*(control[1]-current[1])/3],[end[0]+2*(control[0]-end[0])/3,end[1]+2*(control[1]-end[1])/3],end);
    }else if(node.localName==='close'){segments.push(0x6001);current=start;}
    else if(node.localName==='arcTo'){
      const rx=attr(node,'wR')/9525,ry=attr(node,'hR')/9525,angle=attr(node,'stAng')/60000*Math.PI/180,sweep=attr(node,'swAng')/60000*Math.PI/180;
      const cx=current[0]-rx*Math.cos(angle),cy=current[1]-ry*Math.sin(angle),count=Math.max(1,Math.ceil(Math.abs(sweep)/(Math.PI/2)));
      if(count>64)throw new Error('PPT 圆弧圈数超限');
      for(let i=0;i<count;i++){
        const a=angle+sweep*i/count,b=angle+sweep*(i+1)/count,k=4/3*Math.tan((b-a)/4);
        curve([cx+rx*(Math.cos(a)-k*Math.sin(a)),cy+ry*(Math.sin(a)+k*Math.cos(a))],[cx+rx*(Math.cos(b)+k*Math.sin(b)),cy+ry*(Math.sin(b)-k*Math.cos(b))],[cx+rx*Math.cos(b),cy+ry*Math.sin(b)]);
      }
    }else throw new Error(`PPT 几何不能表示 ${node.localName}`);
    if(points.length>60000||segments.length>60000)throw new Error('PPT 几何点数超限');
  }
  segments.push(0x8000);
  const vertices=concat([u16(points.length),u16(points.length),u16(8),...points.flatMap(([x,y])=>[u32(signed(x*21600/shape.w,'几何 X')),u32(signed(y*21600/shape.h,'几何 Y'))])]);
  const info=concat([u16(segments.length),u16(segments.length),u16(2),...segments.map(u16)]);
  return [{id:320,value:0},{id:321,value:0},{id:322,value:21600},{id:323,value:21600},{id:324,value:4},{id:325,value:vertices},{id:326,value:info}];
}
