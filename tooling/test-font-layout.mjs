import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import * as hb from 'harfbuzzjs';
import {bundleBrowser} from './lib/bundle-browser.mjs';
import {countedAssert} from './lib/counted-assert.mjs';
import {fontSample} from './lib/font-glyph-samples.mjs';

const {assert,record}=countedAssert('fontLayout'),root=resolve('.'),out=join(root,'out/font-glyphs');
mkdirSync(out,{recursive:true});
const entry=join(out,'layout-api.mjs');
writeFileSync(entry,"export {parse,layoutText,renderTextBodyToHtml,renderSlideToSvg} from '@web-ppt/core';export * from '@web-ppt/fonts/glyphs';export * from '@web-ppt/fonts/glyphs/harfbuzz';");
const api=process.argv.includes('--dist')?{...await import('@web-ppt/core'),...await import('@web-ppt/fonts/glyphs'),...await import('@web-ppt/fonts/glyphs/harfbuzz')}:
  await bundleBrowser({root,entry,output:join(out,'layout-contract.mjs'),aliases:[
    ['@web-ppt/core',join(root,'packages/core/src/index.ts')],['@web-ppt/fonts/glyphs',join(root,'packages/fonts/src/glyphs/index.ts')],
  ]});
const provider=api.createFontProvider({loadShaper:async()=>api.createHarfBuzzShaper(hb)});
await provider.register({id:'latin',origin:'explicit',bytes:fontSample('latin.ttf')},{purpose:'edit'});
const presentation=await api.parse(new Uint8Array(readFileSync('fixtures/sample-font-glyphs.pptx')));
const hostile=api.renderSlideToSvg({...presentation,embeddedFonts:[{family:"Font'</style><script>bad()</script>",
  src:"data:font/ttf;base64,AAAA');}</style><script>bad()</script>",bold:false,italic:false}]},presentation.slides[0]);
assert.doesNotMatch(hostile,/<script>/,'字体元数据和资源地址不能逃出 SVG 的 CSS 字符串');
assert.equal((hostile.match(/<\/style>/g)??[]).length,1);
const shape=presentation.slides[0].elements.find(e=>e.kind==='shape'&&e.text.paragraphs.some(p=>p.runs.some(r=>r.text==='AV office ffi ﬃ')));
const body={...shape.text,insets:[0,0,0,0],fontScale:1,autoFitCompute:true,
  paragraphs:shape.text.paragraphs.map(p=>({...p,runs:p.runs.map(r=>({...r,size:100}))}))};
const options={purpose:'edit',language:'en',faceForRun:()=> 'latin'};
const measured=await api.withFontMeasurement(provider,measure=>{
  const layout=api.layoutText(body,690,1000,{measureText:measure});
  const html=api.renderTextBodyToHtml(body,690,1000,{layout:'engine',measureText:measure});
  const slide={...presentation.slides[0],elements:[{...shape,w:350,h:100,text:body}]};
  return {layout,html,width:measure('AV office ffi ﬃ',body.paragraphs[0].runs[0],1),native:api.renderSlideToSvg(presentation,slide,{idPrefix:'font-native',textMode:'svg',measureText:measure}),
    browser:api.renderSlideToSvg(presentation,slide,{idPrefix:'font-html',textMode:'html',measureText:measure})};
},options);
assert.equal(measured.ok,true);
const result=measured.value.result;
assert.equal(result.layout.lines.length,1,'字体同源测量把 669px 连字行保持在 690px 行盒中');
assert.equal(result.layout.lines[0].width,669);
assert.match(result.html,/data-layout="engine"/);
assert.match(result.native,/<text/);assert.doesNotMatch(result.native,/<foreignObject/);
assert.match(result.browser,/<foreignObject/);
assert.equal(measured.value.measureText('AV office ffi ﬃ',body.paragraphs[0].runs[0],1),669);
const svgSize=Number(result.native.match(/font-size="([\d.]+)"/)[1]);
assert.ok(svgSize<100,'自动缩放使用注入字宽');
assert.ok(result.browser.includes(`font-size:${svgSize}px`),'浏览器与原生 SVG 自动缩放使用同一个测量依据');
assert.throws(()=>measured.value.measureText('new text',body.paragraphs[0].runs[0],1),/measurement-not-prepared/,'不可用临时估算冒充已准备的测量');
const missing=await api.withFontMeasurement(provider,measure=>measure('中文',body.paragraphs[0].runs[0],1),options);
assert.equal(missing.reason,'missing-glyphs');
const fakeBold=await api.withFontMeasurement(provider,measure=>measure('AV',{...body.paragraphs[0].runs[0],b:true},1),options);
assert.equal(fakeBold.reason,'face-style-mismatch','测量绑定不能把常规字体当作粗体，随后让浏览器静默合成字重');
provider.dispose();presentation.dispose();record();console.log('字体布局：既有行盒、HTML 和原生 SVG 同源测量通过');
