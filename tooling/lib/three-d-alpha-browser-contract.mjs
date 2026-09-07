import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { bundleBrowser } from './bundle-browser.mjs';

/** 透明正面跨三角形共边时只能合成一次，缩放后也不能漏底。 */
export async function checkThreeDTransparency(evaluate) {
  const root=resolve('.');
  const {renderShape3D}=await bundleBrowser({root,entry:resolve('packages/core/src/three-d.ts'),output:resolve('out/three-d/alpha-renderer.mjs'),aliases:[['@web-ppt/core',resolve('packages/core/src/index.ts')]]});
  const el={kind:'shape',x:0,y:0,w:240,h:150,rot:0,flipH:false,flipV:false,path:'M0 0H240V150H0Z',fill:{type:'solid',color:'rgba(0,0,0,0.5)'},scene3d:{camera:'perspectiveFront',fieldOfView:50,rotX:20,rotY:20,rotZ:0,extrusion:0}};
  const defs=[];let id=0;
  const shape=renderShape3D(el,`<path d="${el.path}" fill="${el.fill.color}"/>`,{defs,nextId:p=>p+id++});
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="320" height="230" viewBox="-40 -40 320 230"><defs>${defs.join('')}</defs>${shape}</svg>`;
  const results=await evaluate(`(async()=>{
    const img=new Image();img.src='data:image/svg+xml,'+encodeURIComponent(${JSON.stringify(svg)});await img.decode();
    return [0.5,1,2,4].map(scale=>{
      const canvas=document.createElement('canvas');canvas.width=320*scale;canvas.height=230*scale;
      const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0,canvas.width,canvas.height);
      const data=ctx.getImageData(120*scale,90*scale,50*scale,40*scale).data;
      let min=255,max=0;for(let i=3;i<data.length;i+=4){min=Math.min(min,data[i]);max=Math.max(max,data[i]);}
      return {scale,min,max};
    });
  })()`,true);
  for(const {scale,min,max} of results)assert(min>=127&&max<=129,`${scale}× 透视网格透明度应为 128，实际 ${min}–${max}`);
}
