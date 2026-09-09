import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,symlinkSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';

const root=resolve('.'),out=resolve(root,'out/font-glyphs/packages');
mkdirSync(out,{recursive:true});
// 在仓库外消费真实 tarball，避免源码 paths 或 workspace 链接替发布声明兜底。
const consumer=mkdtempSync(join(tmpdir(),'web-ppt-font-consumer-'));
const packages={};
for(const name of ['core','fonts']){
  const [packed]=JSON.parse(execFileSync('npm',['pack','--workspace',`@web-ppt/${name}`,
    '--ignore-scripts','--json','--pack-destination',out],{cwd:root,encoding:'utf8',
      env:{...process.env,npm_config_cache:join(out,'npm-cache')}}));
  const target=join(consumer,'node_modules/@web-ppt',name);
  mkdirSync(target,{recursive:true});
  execFileSync('tar',['-xzf',join(out,packed.filename),'-C',target,'--strip-components=1']);
  packages[name]={filename:packed.filename,size:packed.size,unpackedSize:packed.unpackedSize};
  if(name==='fonts'){
    if(packed.files.some(file=>/\.(?:wasm|ttf|otf|woff2?|eot)$|prototype|font-glyph-samples/.test(file.path)))
      throw new Error('字体发布包包含字体字节、WASM 或原型');
    const pkg=JSON.parse(readFileSync(join(target,'package.json'),'utf8'));
    for(const key of ['.','./glyphs','./glyphs/harfbuzz','./glyphs/worker','./glyphs/browser']){
      for(const field of ['types','import'])if(!existsSync(join(target,pkg.exports[key][field])))
        throw new Error(`${key} 缺少 ${field} 发布文件`);
    }
  }
}
symlinkSync(resolve(root,'node_modules/fflate'),join(consumer,'node_modules/fflate'));
writeFileSync(join(consumer,'package.json'),JSON.stringify({type:'module',private:true}));
writeFileSync(join(consumer,'consumer.ts'),`
import {substituteFor} from '@web-ppt/fonts';
import {createFontProvider,segmentFontText,withFontMeasurement,type FontGlyphProvider,type GlyphRun} from '@web-ppt/fonts/glyphs';
import {createHarfBuzzShaper} from '@web-ppt/fonts/glyphs/harfbuzz';
import {createWorkerFontShaper,serveFontWorker,type FontWorkerEndpoint} from '@web-ppt/fonts/glyphs/worker';
import {createFontFaceScope} from '@web-ppt/fonts/glyphs/browser';

substituteFor('Arial');
const shaper=createWorkerFontShaper(()=>new Worker(new URL('./worker.js',import.meta.url),{type:'module'}));
const provider:FontGlyphProvider=createFontProvider({loadShaper:async()=>shaper,decodeEot:shaper.decodeEot});
const loaded=await provider.register({id:'local',bytes:new Uint8Array(),origin:'explicit'},{purpose:'edit'});
if(loaded.ok){
  const result=await provider.shape(loaded.value.id,'office',{script:'Latn',direction:'ltr',language:'en',purpose:'edit'});
  if(result.ok){const run:GlyphRun=result.value;run.clusters.map(cluster=>cluster.text);}
  else result.reason satisfies string;
  await createFontFaceScope(provider).install(loaded.value.id,{purpose:'edit'});
  provider.release(loaded.value.id) satisfies boolean;
}
await withFontMeasurement(provider,measure=>measure('A',{
  text:'A',fonts:['Arial'],size:12,color:'#000000',b:false,i:false,u:false,strike:false,
},1),{
  language:'en',purpose:'view-print',faceForRun:(style,script)=>style.b&&script==='Latn'?'bold':'local',
});
segmentFontText('中文 ABC',{direction:'ltr',language:'zh'});
declare const endpoint:FontWorkerEndpoint;
serveFontWorker(endpoint,{loadShaper:async()=>shaper});
// @ts-expect-error 首版不允许把复杂脚本悄悄作为已支持范围。
provider.shape('local','text',{script:'Arab',direction:'ltr',language:'ar',purpose:'edit'});
provider.dispose();shaper.dispose();
`);
const config={compilerOptions:{strict:true,noEmit:true,target:'ES2022',
  module:'ESNext',moduleResolution:'Bundler',lib:['ES2022','DOM'],types:[],skipLibCheck:false},files:['consumer.ts']};
const check=()=>{
  writeFileSync(join(consumer,'tsconfig.json'),JSON.stringify(config));
  execFileSync(process.execPath,[resolve(root,'node_modules/typescript/bin/tsc'),'-p',join(consumer,'tsconfig.json')],{stdio:'inherit'});
};
check();
symlinkSync(resolve(root,'node_modules/harfbuzzjs'),join(consumer,'node_modules/harfbuzzjs'));
mkdirSync(join(consumer,'node_modules/@types'),{recursive:true});
symlinkSync(resolve(root,'node_modules/@types/emscripten'),join(consumer,'node_modules/@types/emscripten'));
writeFileSync(join(consumer,'harfbuzz-consumer.ts'),`
import * as hb from 'harfbuzzjs';
import {createHarfBuzzShaper} from '@web-ppt/fonts/glyphs/harfbuzz';
import {createFontProvider} from '@web-ppt/fonts/glyphs';
const provider=createFontProvider({loadShaper:async()=>createHarfBuzzShaper(hb)});
provider.dispose();
`);
config.compilerOptions.types=['emscripten'];config.files.push('harfbuzz-consumer.ts');check();
writeFileSync(resolve(out,'consumer.json'),JSON.stringify({consumer,packages,standaloneTypes:'passed',harfbuzzTypes:'passed'},null,2)+'\n');
console.log('真实字体 tarball 的五个入口、HarfBuzz 注入与消费者类型检查通过');
