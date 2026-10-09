import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync,readFileSync } from 'node:fs';
import { resolve,join } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
import { recordCount } from './lib/measured.mjs';
const root=resolve('.'),out=join(root,'out/video');mkdirSync(out,{recursive:true});
const entry=join(out,'entry.mjs');writeFileSync(entry,`export * from '${root}/packages/viewer-core/src/video.ts';export { groupDuration } from '${root}/packages/viewer-core/src/video/timing.ts';export { WebmWriter } from '${root}/packages/viewer-core/src/video/webm.ts';export { mixAudioClips } from '${root}/packages/viewer-core/src/video/mix.ts';export { parse } from '${root}/packages/core/src/index.ts';`);
const bundled=await bundleBrowser({root,entry,output:join(out,'contract.mjs'),aliases:[['@web-ppt/core',join(root,'packages/core/src/index.ts')]]});
const {videoPlan,presentationToVideo}=process.argv.includes('--dist') ? await import('@web-ppt/viewer-core/video') : bundled;
const {parse}=process.argv.includes('--dist') ? await import('@web-ppt/core') : bundled;
const {groupDuration,WebmWriter,mixAudioClips}=bundled;
let count=0;const check=(c,label)=>{assert(c,label);count++;};const bad=(fn,re)=>{assert.throws(fn,re);count++;};
const p=await parse(readFileSync('fixtures/sample-video-export.pptx'),{lazy:false});
const plan=videoPlan(p,{fps:12,slideDurationMs:300,clickDelayMs:100,skipHidden:true});
check(plan.pages.length===2,'Hidden slides omitted');check(plan.pages[0].groups[0].length===2,'Native entrance and motion in one click group');
check(groupDuration(plan.pages[0].groups[0])===900,'afterPrev sequencing');check(plan.total>20&&plan.total<40,'Bounded integer frame plan');
check(groupDuration([{delayMs:20,durationMs:40,trigger:'click'},{delayMs:10,durationMs:80,trigger:'withPrev'},{delayMs:5,durationMs:100,trigger:'afterPrev'}])===215,'withPrev and afterPrev relative times');
for(const options of[{fps:0},{fps:61},{fps:NaN},{scale:NaN},{slideDurationMs:-1},{bitrate:Infinity}])bad(()=>videoPlan(p,options),/视频/);
bad(()=>videoPlan({...p,slides:[]},{}),/没有/);bad(()=>videoPlan(p,{slideDurationMs:3600000}),/一小时/);
const writer=new WebmWriter(480,270,12,'VP8');bad(()=>writer.addFrame(new Uint8Array([1]),0,1000,false),/关键帧/);
writer.addFrame(new Uint8Array([1,2,3]),0,83333,true);writer.addFrame(new Uint8Array([4,5]),83333,83334,false);
bad(()=>writer.addFrame(new Uint8Array([6]),83333,83333,false),/递增/);
const webm=writer.finish(),bytes=new Uint8Array(await webm.arrayBuffer());check(webm.type==='video/webm'&&Buffer.from(bytes.subarray(0,4)).toString('hex')==='1a45dfa3','Real EBML signature');
check(Buffer.from(bytes).includes('V_VP8')&&Buffer.from(bytes).includes('webm'),'Native WebM track codec');
bad(()=>writer.finish(),/结束/);bad(()=>new WebmWriter(10,10,24,'VP9').finish(),/没有/);
await assert.rejects(()=>presentationToVideo(p,{signal:AbortSignal.abort()}),e=>e.name==='AbortError');count++;
await assert.rejects(()=>presentationToVideo(p),/WebCodecs/);count++;

// 确定性 PCM 混音核：纯函数语义按票据 006（两路混音/静音/延迟开始/结束裁切/循环/跨页/重采样/限幅）
const mono=(...values)=>({samples:Float32Array.from(values),sampleRate:1000,channels:1,startMs:0});
{
  // 48 帧/48ms；两路在 [10,20)ms 重叠应求和，其余各自独立
  const a={...mono(...Array(20).fill(0.25)),startMs:10};
  const b={...mono(...Array(10).fill(0.5)),startMs:15};
  const mixed=mixAudioClips([a,b],48,{sampleRate:1000});
  check(mixed.length===48*2,'混音输出长度按总时长与双声道');
  check(mixed[8*2]===0&&mixed[9*2]===0,'延迟开始：起点前无信号');
  check(Math.abs(mixed[16*2]-(0.25+0.5))<1e-6,'两路重叠求和');
  check(mixed[25*2]===0.25,'非重叠段只含本路');
  check(mixed[30*2]===0,'结束裁切：a 自然结束后无残留');
}
{
  const loud={...mono(...Array(10).fill(0.9)),volume:0.5};
  check(Math.abs(mixAudioClips([loud],10,{sampleRate:1000})[0]-0.45)<1e-6,'音量缩放');
  const muted={...mono(...Array(10).fill(0.9)),volume:0};
  check(mixAudioClips([muted],10,{sampleRate:1000}).every(v=>v===0),'静音输出全零');
  check(mixAudioClips([],5,{sampleRate:1000}).every(v=>v===0),'空片段列表输出全零');
}
{
  // 循环：4ms 样本 [1,-1,0.5,-0.5] 循环填充 10ms
  const loop={...mono(1,-1,0.5,-0.5),loop:true};
  const mixed=mixAudioClips([loop],10,{sampleRate:1000});
  check(mixed[0]===1&&mixed[4*2]===1&&mixed[9*2]===-1,'循环取模回绕');
  const clipped={...mono(...Array(10).fill(1)),loop:true,endMs:6};
  check(mixAudioClips([clipped],10,{sampleRate:1000}).slice(6*2).every(v=>v===0)&&mixAudioClips([clipped],10,{sampleRate:1000})[5*2]===1,'循环按 endMs 截止');
}
{
  // 重采样：源 500Hz 输出 1000Hz，时长与插值中点
  const tone={samples:Float32Array.from([0,1,0,-1]),sampleRate:500,channels:1,startMs:0};
  const mixed=mixAudioClips([tone],8,{sampleRate:1000});
  check(mixed.length===8*2,'重采样输出帧数按输出采样率');
  check(mixed[1*2]===0.5&&mixed[5*2]===-0.5,'线性插值中点取值');
}
{
  const clipped=mixAudioClips([{...mono(...Array(10).fill(1)),volume:1},{...mono(...Array(10).fill(1)),startMs:2}],10,{sampleRate:1000});
  check(clipped[3*2]===1,'混音限幅到 [-1,1]');
  const stereo={samples:Float32Array.from([0.25,-0.25]),sampleRate:1000,channels:2,startMs:0};
  const dual=mixAudioClips([stereo],1,{sampleRate:1000});
  check(dual[0]===0.25&&dual[1]===-0.25,'立体声保留声道');
  check(mixAudioClips([{...mono(1)}],1,{sampleRate:1000})[0]===1&&mixAudioClips([{...mono(1)}],1,{sampleRate:1000})[1]===1,'单声道复制到双声道');
}
for(const [label,clip,total] of [['负起始',{...mono(1),startMs:-1},1],['截止早于起始',{...mono(1),endMs:-1},1],['坏采样率',{...mono(1),sampleRate:0},1],['坏声道',{...mono(1),channels:3},1],['奇数样本',{...mono(1),channels:2},1]].map(x=>x)) bad(()=>mixAudioClips([clip],total),/混音|片段/);
bad(()=>mixAudioClips([mono(1)],-1),/混音总时长/);
p.dispose();recordCount('video',count);console.log(`视频导出 ${count} 项通过`);
