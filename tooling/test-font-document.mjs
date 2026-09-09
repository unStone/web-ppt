import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {unzipSync} from 'fflate';
import {bundleBrowser} from './lib/bundle-browser.mjs';
import {countedAssert} from './lib/counted-assert.mjs';

const {assert,record}=countedAssert('fontDocument'),root=resolve('.'),out=join(root,'out/font-glyphs');
mkdirSync(out,{recursive:true});
const entry=join(out,'document-api.mjs');
writeFileSync(entry,"export {parse,setFontDecoder} from '@web-ppt/core';export {openEditor} from '@web-ppt/editor';export {createFontProvider} from '@web-ppt/fonts/glyphs';export {saveEditDoc} from '@web-ppt/edit-core/save';");
const api=process.argv.includes('--dist')?{...await import('@web-ppt/core'),...await import('@web-ppt/editor'),...await import('@web-ppt/fonts/glyphs'),...await import('@web-ppt/edit-core/save')}:
  await bundleBrowser({root,entry,output:join(out,'document-contract.mjs'),aliases:[
    ['@web-ppt/core',join(root,'packages/core/src/index.ts')],['@web-ppt/editor',join(root,'packages/editor/src/index.ts')],
    ['@web-ppt/edit-core',join(root,'packages/edit-core/src/index.ts')],['@web-ppt/viewer-core',join(root,'packages/viewer-core/src/index.ts')],
    ['@web-ppt/fonts/glyphs',join(root,'packages/fonts/src/glyphs/index.ts')],
  ]});
const bytes=new Uint8Array(readFileSync('fixtures/sample-embedfont.pptx')),parts=unzipSync(bytes);
api.setFontDecoder(null);
const session=await api.openEditor(bytes);
const presentation=session.toPresentation(),sources=session.embeddedFontSources??[];
assert.equal(sources.length,4,'未能解码的嵌入字体也保留原始资源，供按需 Provider 定位问题');
assert.equal(presentation.embeddedFonts.length,3,'现有预览字体列表仍只含已解码资源');
for(let i=0;i<sources.length;i++){
  assert.deepEqual(new Uint8Array(await (await fetch(sources[i].src)).arrayBuffer()),parts[`ppt/fonts/font${i+1}.fntdata`],'文稿原始字体仍带 EOT 外层权限');
}
session.dispose();
for(const source of sources)await assert.rejects(fetch(source.src),'文稿关闭后撤销原始字体资源地址');
const preview=await api.parse(bytes);
assert.equal(preview.embeddedFontSources,undefined,'常规查看不额外保留编辑用原始字体副本');
preview.dispose();
let decoderCalls=0;
api.setFontDecoder(()=>{decoderCalls++;return null;});
const sourceOnly=await api.openEditor(bytes,{embeddedFonts:'source'});
assert.equal(decoderCalls,0,'原始字体模式不得提前同步调用全局 EOT 解码器');
assert.equal(sourceOnly.toPresentation().embeddedFonts?.length??0,0,'原始模式不创建旧解码字体资源');
assert.equal(sourceOnly.embeddedFontSources.length,4,'原始模式仍为文稿 Worker 保留全部容器');
sourceOnly.setFontResources([{family:'Local runtime font',src:'blob:runtime-font',bold:false,italic:false}],{browserFontsReady:true});
assert.equal(sourceOnly.editor.history.undoCount,0,'运行时字体替换不进入可撤销文稿命令');
const unchanged=api.saveEditDoc(sourceOnly.editor.doc);
assert.deepEqual(unchanged.bytes,bytes,'本机字体资源不会进入 PPTX，零编辑保存仍保留原始字节');
assert.equal(unchanged.package,sourceOnly.editor.doc.package,'零编辑保存复用会话拥有的源包，由会话统一释放');
sourceOnly.dispose();api.setFontDecoder(null);
const glyphSession=await api.openEditor(new Uint8Array(readFileSync('fixtures/sample-font-glyphs.pptx')));
const provider=api.createFontProvider();
for(const [index,source] of glyphSession.embeddedFontSources.entries()){
  const loaded=await provider.register({id:String(index),origin:'embedded',family:source.family,
    bytes:new Uint8Array(await (await fetch(source.src)).arrayBuffer())},{purpose:'edit'});
  if(source.family==='WebPPT Glyph Preview')assert.equal(loaded.reason,'preview-print-only','编辑器到 Provider 的完整链路仍保留 EOT 外层预览限制');
  else{
    assert.equal(loaded.ok,true);
    assert.equal(loaded.value.weight,source.bold?700:400);
    assert.equal(loaded.value.italic,source.italic);
  }
}
provider.dispose();glyphSession.dispose();
record();console.log('字体文稿资源：原始容器与会话释放通过');
