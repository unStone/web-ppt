import {fontSample} from './font-glyph-samples.mjs';

export async function fontShapeContract(api,assert){
  const hb=await import('harfbuzzjs');
  let loads=0;
  const provider=api.createFontProvider({loadShaper:async()=>{loads++;return api.createHarfBuzzShaper(hb);}});
  assert.equal((await provider.register({id:'latin',origin:'explicit',bytes:fontSample('latin.ttf')},{purpose:'edit'})).ok,true);
  assert.equal(loads,0,'只注册或匹配字体不加载整形模块');
  const options={purpose:'edit',script:'Latn',direction:'ltr',language:'en'};
  const segments=api.segmentFontText('“ABC á” 中文。',{direction:'ltr',language:'zh'});
  assert.equal(segments.ok,true);
  assert.deepEqual(segments.value.map(s=>[s.start,s.end,s.text,s.script]),[[0,9,'“ABC á” ','Latn'],[9,12,'中文。','Hani']]);
  assert.deepEqual(api.segmentFontText('ABC مرحبا',{direction:'ltr',language:'en'}).range,{start:4,end:5},'不支持的文字定位到原文 UTF-16 区间');
  const ligatures=await provider.shape('latin','AV office ffi ﬃ',options);
  assert.equal(ligatures.ok,true);
  assert.equal(ligatures.value.glyphs.length,11,'HarfBuzz 连字不能退化为逐字符 cmap 映射');
  assert.equal(ligatures.value.xAdvance,6690,'字距调整与连字按字体设计单位输出');
  const ffi=ligatures.value.clusters.find(c=>c.text==='ffi'),unicode=ligatures.value.clusters.find(c=>c.text==='ﬃ');
  assert.equal(ligatures.value.glyphs[ffi.glyphStart].id,ligatures.value.glyphs[unicode.glyphStart].id);
  assert.notEqual(ffi.text,unicode.text,'同 GID 仍须保留不同原文，不能反查 cmap 取一个 Unicode');
  const combining=await provider.shape('latin','á q̇',options);
  assert.equal(combining.ok,true);
  assert.equal(combining.value.glyphs.length,5);
  assert.deepEqual(combining.value.clusters.map(c=>[c.start,c.end]),[[0,2],[2,3],[3,5]]);
  assert.ok(combining.value.glyphs.some(g=>g.xOffset===-307),'组合音标保留定位偏移');
  const outline=await provider.outline('latin',ligatures.value.glyphs[0].id,{purpose:'edit'});
  assert.equal(outline.ok,true);
  assert.match(outline.value,/^M/);
  assert.equal(loads,1,'多次排版复用同一文稿整形器');
  const missing=await provider.shape('latin','中文😀',{...options,script:'Hani',language:'zh'});
  assert.equal(missing.reason,'missing-glyphs');
  assert.deepEqual(missing.missing.map(c=>[c.start,c.end,c.text]),[[0,1,'中'],[1,2,'文'],[2,4,'😀']]);
  assert.equal((await provider.shape('latin','مرحبا',options)).reason,'unsupported-script','不能靠调用者错误标记 Latn 绕过复杂脚本边界');
  assert.equal((await provider.shape('latin','abc',{...options,direction:'rtl'})).reason,'unsupported-direction');
  assert.equal((await provider.shape('latin','abc中',options)).reason,'script-mismatch');
  provider.dispose();
  assert.equal((await provider.shape('latin','abc',options)).reason,'provider-disposed');
}
