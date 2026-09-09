import type {Presentation,Slide,SlideElement} from '../types';
import {renderElementToSvg,renderSlideToSvg} from '@web-ppt/core';
import type {VectorFonts} from './vector-fonts';
import {locateVectorError} from './vector-error';

export async function vectorSlideMarkup(pres:Presentation,slide:Slide,slideNumber:number,fonts:VectorFonts,anonymous:ReadonlyMap<number,number[]>):Promise<string> {
  // 原生同步测量回调没有对象身份；逐对象补齐真实测量，失败能定位到组内叶节点。
  // 仍使用同一原生排版器，整页渲染复用本次导出的测量缓存；不接管宿主字体生命周期。
  const prepare = async (el:SlideElement):Promise<void> => {
    if (el.kind === 'group') {for (const child of el.children) await prepare(child); return;}
    try {await fonts.render(measureText => renderElementToSvg(el,{textMode:'svg',idPrefix:'pdf-measure',measureText}).markup);}
    catch (error) {locateVectorError(error,slideNumber,el.id,anonymous);}
  };
  for (const el of slide.elements) await prepare(el);
  try {return await fonts.render(measureText => renderSlideToSvg({...pres,embeddedFonts:[]},slide,{textMode:'svg',idPrefix:'pdf',measureText}));}
  catch (error) {locateVectorError(error,slideNumber,undefined,anonymous);}
}
