import { groupSteps, type AnimStep, type Presentation, type Slide } from '@web-ppt/core';
export interface VideoOptions {
  scale?: number;
  fps?: number;
  bitrate?: number;
  skipHidden?: boolean;
  showComments?: boolean;
  animations?: boolean;
  transitions?: boolean;
  /** 没有自动换片时使用的停留时长，默认 3000 ms。 */
  slideDurationMs?: number;
  /** 自动触发每个点击批次前的停留，默认 700 ms。 */
  clickDelayMs?: number;
  /** 视频无音轨；显式允许把内嵌音视频作为静态封面输出。 */
  mediaPosters?: boolean;
  signal?: AbortSignal;
  onProgress?: (value: { completed: number; total: number; slideNumber: number }) => void;
}
export function groupDuration(steps: AnimStep[]): number {
  let start = 0, end = 0, duration = 0;
  for (const step of steps) {
    if (![step.delayMs,step.durationMs].every(n=>Number.isFinite(n)&&n>=0&&n<=3600000)) throw new Error('视频动画时长无效');
    start = (step.trigger==='afterPrev'?end:step.trigger==='withPrev'?start:0)+step.delayMs;
    end = start+step.durationMs; duration = Math.max(duration,end);
  }
  return duration;
}
export function videoPlan(pres: Presentation, options: VideoOptions) {
  const fps = options.fps ?? 24, scale = options.scale ?? 1, hold = options.slideDurationMs ?? 3000, click = options.clickDelayMs ?? 700;
  if (!Number.isInteger(fps)||fps<1||fps>60||!Number.isFinite(scale)||scale<=0||![hold,click].every(n=>Number.isFinite(n)&&n>=0&&n<=3600000)) throw new Error('视频帧率、倍率或停留时长无效');
  const width = Math.round(pres.width*scale), height = Math.round(pres.height*scale);
  if (![width,height].every(n=>Number.isFinite(n)&&n>0&&n<=4096)||width*height>8388608) throw new Error('视频尺寸需要在 4096 边长、800 万像素以内');
  const bitrate = options.bitrate ?? Math.max(1000000,width*height*fps*0.15);
  if (!Number.isFinite(bitrate)||bitrate<10000||bitrate>100000000) throw new Error('视频码率无效');
  const frames = (duration: number) => Math.max(1,Math.ceil(duration*fps/1000));
  const pages = pres.slides.flatMap((slide: Slide,index: number)=>{
    if (options.skipHidden && slide.hidden) return [];
    const groups = options.animations===false ? [] : groupSteps(slide.animations);
    const transition = options.transitions!==false && slide.transition?.type!=='none' ? (slide.transition?.durationMs ?? 0):0;
    const duration = slide.transition?.advanceAfterMs ?? hold;
    if (![duration,transition].every(n=>Number.isFinite(n)&&n>=0&&n<=3600000)) throw new Error('视频页面时长无效');
    return [{slide,slideNumber:index+1,groups,transition,hold:duration,click}];
  });
  const total = pages.reduce((sum,p,i)=>sum+(i&&p.transition?frames(p.transition):0)+frames(p.hold)+p.groups.reduce((n,g)=>n+(click?frames(click):0)+frames(groupDuration(g)),0),0);
  if (!pages.length) throw new Error('没有可导出的视频页面');
  if (total/fps>3600||total>108000) throw new Error('视频不能超过一小时或 108000 帧');
  return {width,height,fps,bitrate:Math.round(bitrate),pages,total,frames};
}
