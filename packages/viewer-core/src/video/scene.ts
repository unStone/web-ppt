import { slideToSvgFile, type Presentation, type Slide, type AnimStep } from '@web-ppt/core';
import { playGroup, transitionFrames, morphPairs } from '../playback';
const NS = 'http://www.w3.org/2000/svg';
const properties = ['transform','transform-origin','transform-box','opacity','clip-path','filter','visibility'] as const;

/** 暂停动画后读取实际计算样式，把浏览器补间结果固化到单帧 SVG。 */
export class VideoScene {
  readonly host = document.createElement('div');
  readonly svg = document.createElementNS(NS,'svg');
  private animations: Animation[] = [];
  constructor(private pres: Presentation, private showComments: boolean) {
    this.host.style.cssText = `position:fixed;left:-20000px;top:0;width:${pres.width}px;height:${pres.height}px;pointer-events:none;contain:layout style;`;
    this.host.setAttribute('aria-hidden','true');
    this.svg.setAttribute('xmlns',NS); this.svg.setAttribute('width',String(pres.width)); this.svg.setAttribute('height',String(pres.height));
    this.svg.setAttribute('viewBox',`0 0 ${pres.width} ${pres.height}`); this.host.append(this.svg); document.body.append(this.host);
  }
  async page(slide: Slide, hidden: readonly number[]): Promise<SVGGElement> {
    const source = await slideToSvgFile(this.pres,slide,hidden,{ showComments:this.showComments });
    // 独立图片上下文不会读取外链；留下外链意味着静默缺图，应拒绝这个导出。
    if (/<image\b[^>]*\bhref="(?:blob:|https?:)/.test(source) || /@font-face\{[^}]*src:url\((?:blob:|https?:)/.test(source)) throw new Error('视频资源内联失败');
    const parsed = new DOMParser().parseFromString(source,'image/svg+xml');
    if (parsed.querySelector('parsererror')) throw new Error('视频页面 SVG 无效');
    const group = document.createElementNS(NS,'g'); group.style.transformBox = 'fill-box'; group.style.transformOrigin = 'center';
    group.append(document.importNode(parsed.documentElement,true)); this.svg.append(group); return group;
  }
  private pause(animations: readonly Animation[]): Animation[] {
    for (const animation of animations) { animation.pause(); animation.currentTime = 0; }
    this.animations.push(...animations); return [...animations];
  }
  group(page: SVGGElement, steps: AnimStep[]): Animation[] { return this.pause(playGroup(page,steps).animations); }
  transition(outgoing: SVGGElement, incoming: SVGGElement, slide: Slide): Animation[] {
    const t = slide.transition; if (!t || t.type === 'none') return [];
    const animations: Animation[] = [];
    const animate = (node: Element, frames: Keyframe[]) => {
      const a = node.animate(frames,{duration:t.durationMs,easing:'ease-in-out',fill:'both'});
      void a.finished.catch(() => undefined); animations.push(a);
    };
    if (t.type === 'morph') {
      const pairs = morphPairs(outgoing,incoming), ids = new Set(pairs.map(p=>p.node.getAttribute('data-el')));
      for (const {node,from,to} of pairs) animate(node,[{transformOrigin:'left top',transform:`translate(${from.left-to.left}px,${from.top-to.top}px) scale(${to.width?from.width/to.width:1},${to.height?from.height/to.height:1})`},{transformOrigin:'left top',transform:'none'}]);
      for (const node of outgoing.querySelectorAll('[data-el]')) animate(node,ids.has(node.getAttribute('data-el'))?[{opacity:0},{opacity:0}]:[{opacity:1},{opacity:0}]);
      for (const node of incoming.querySelectorAll('[data-el]')) if (!ids.has(node.getAttribute('data-el'))) animate(node,[{opacity:0},{opacity:1}]);
    } else { animate(outgoing,transitionFrames(t,false)); animate(incoming,transitionFrames(t,true)); }
    return this.pause(animations);
  }
  settle(animations: Animation[]): void {
    for (const animation of animations) {
      const effect = animation.effect as KeyframeEffect | null, target = effect?.target as SVGElement | null;
      if (effect && target) {
        animation.currentTime = Number(effect.getComputedTiming().endTime);
        const style = getComputedStyle(target);
        for (const property of properties) target.style.setProperty(property,style.getPropertyValue(property));
      }
      animation.cancel(); this.animations.splice(this.animations.indexOf(animation),1);
    }
  }
  async draw(context: CanvasRenderingContext2D, width: number, height: number): Promise<void> {
    const copy = this.svg.cloneNode(true) as SVGSVGElement;
    const sourceNodes = [this.svg,...this.svg.querySelectorAll('*')], copyNodes = [copy,...copy.querySelectorAll('*')];
    const targets = new Set(this.animations.map(a=>(a.effect as KeyframeEffect | null)?.target));
    for (let i = 0; i < sourceNodes.length; i++) if (targets.has(sourceNodes[i])) {
      const style = getComputedStyle(sourceNodes[i]);
      for (const property of properties) (copyNodes[i] as SVGElement).style.setProperty(property,style.getPropertyValue(property));
    }
    const image = new Image(); image.decoding = 'sync';
    await new Promise<void>((resolve,reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error('视频帧 SVG 渲染失败'));
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
    });
    context.fillStyle = '#fff'; context.fillRect(0,0,width,height); context.drawImage(image,0,0,width,height);
  }
  dispose(): void { for (const a of this.animations) a.cancel(); this.animations.length = 0; this.host.remove(); }
}
