import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {countedAssert} from './lib/counted-assert.mjs';
import {bundleBrowser} from './lib/bundle-browser.mjs';
import {fontSample as sample,fontTable,fontWithPermissions} from './lib/font-glyph-samples.mjs';
import {makeTtf} from './lib/font.mjs';
import {fontShapeContract} from './lib/font-shape-contract.mjs';
import {fontShapeBoundaryContract} from './lib/font-shape-boundaries.mjs';
import {fontRegistrationContract} from './lib/font-registration-contract.mjs';
import {fontEotContract} from './lib/font-eot-contract.mjs';
import {fontInputBudgetContract} from './lib/font-input-budget-contract.mjs';

const {assert,record}=countedAssert('fontGlyphs');
const root=resolve('.'),out=join(root,'out/font-glyphs');
mkdirSync(out,{recursive:true});
const entry=join(out,'entry.mjs');
writeFileSync(entry,"export * from '@web-ppt/fonts/glyphs'; export * from '@web-ppt/fonts/glyphs/harfbuzz';");
const api=process.argv.includes('--dist') ? {...await import('@web-ppt/fonts/glyphs'),...await import('@web-ppt/fonts/glyphs/harfbuzz')} :
  await bundleBrowser({root,entry,output:join(out,'contract.mjs'),aliases:[
    ['@web-ppt/fonts/glyphs/harfbuzz',join(root,'packages/fonts/src/glyphs/harfbuzz.ts')],
    ['@web-ppt/fonts/glyphs',join(root,'packages/fonts/src/glyphs/index.ts')],
  ]});

const provider=api.createFontProvider();
const missing=await provider.register({id:'system-arial',family:'Arial',origin:'explicit'}, {purpose:'edit'});
assert.equal(missing.ok,false,'只有家族名称不能注册可嵌入字体');
assert.equal(missing.reason,'font-bytes-unavailable');
const fontBytes=readFileSync('tooling/font-glyph-samples/latin.ttf');
const original=new Uint8Array(fontBytes);
const registered=await provider.register({id:'latin',bytes:fontBytes,origin:'explicit',embeddingEvidence:'OFL-1.1'}, {purpose:'edit'});
assert.equal(registered.ok,true,'显式 TTF 可注册为独立的文稿字体');
assert.equal(registered.value.family,'WebPPT Glyph Latin');
assert.equal(registered.value.weight,400);
assert.equal(registered.value.unitsPerEm,1000);
const resolved=await provider.resolve({family:'webppt glyph latin',weight:400,italic:false,purpose:'edit'});
assert.equal(resolved.value.id,'latin','字体匹配按家族和真实样式，不受家族大小写影响');
fontBytes.fill(0);
const embedded=await provider.embedding('latin',{purpose:'edit'});
assert.deepEqual(embedded.value.bytes,original,'输入 Buffer 后续修改不污染文稿字体');
embedded.value.bytes.fill(0);
assert.deepEqual((await provider.embedding('latin',{purpose:'edit'})).value.bytes,original,'交付副本不暴露内部字体存储');
const restricted=await provider.register({id:'restricted',bytes:sample('restricted.ttf'),origin:'explicit'},{purpose:'view-print'});
assert.equal(restricted.reason,'embedding-restricted','Restricted 也不能用于预览 PDF 嵌入');
const preview=await provider.register({id:'preview',bytes:sample('preview.ttf'),origin:'embedded'},{purpose:'view-print'});
assert.equal(preview.ok,true,'Preview & Print 可用于查看/打印');
assert.equal((await provider.embedding('preview',{purpose:'edit'})).reason,'preview-print-only','已按预览加载的字体不能转为编辑用途');
const editable=await provider.register({id:'editable',bytes:sample('editable.ttf'),origin:'embedded'},{purpose:'edit'});
assert.equal(editable.ok,true,'Editable 允许编辑嵌入');
const whole=await provider.register({id:'whole',bytes:sample('no-subset.ttf'),origin:'explicit'},{purpose:'edit'});
assert.equal(whole.value.embedding.subsetAllowed,false,'No Subsetting 必须随嵌入资源传给导出方');
assert.equal((await provider.embedding('whole',{purpose:'edit'})).value.bytes.length,21656,'保留全部源字体字节');
assert.equal((await provider.register({id:'bitmap',bytes:sample('bitmap.ttf'),origin:'explicit'},{purpose:'view-print'})).reason,'bitmap-only');
for(const [version,flags,ok] of [[0,0x200,true],[1,0x100,true],[2,12,true],[3,12,false],[4,1,false]]){
  const result=await provider.register({id:`legacy-${version}-${flags}`,bytes:fontWithPermissions(flags,version),origin:'explicit'},{purpose:'edit'});
  assert.equal(result.ok,ok,`OS/2 ${version} 版嵌入位 ${flags} 按对应版本解释`);
}
const invalid=sample('latin.ttf'),loca=fontTable(invalid,'loca');
new DataView(invalid.buffer).setUint16(loca.offset+loca.length-2,65535);
assert.equal((await provider.register({id:'bad-loca',bytes:invalid,origin:'explicit'},{purpose:'edit'})).reason,'invalid-font','越界字形地址不能到达整形器');
const recursive=makeTtf(),glyf=fontTable(recursive,'glyf');
const recursiveView=new DataView(recursive.buffer,recursive.byteOffset,recursive.byteLength);
recursiveView.setInt16(glyf.offset,-1);recursiveView.setUint16(glyf.offset+10,3);recursiveView.setUint16(glyf.offset+12,1);
assert.equal((await provider.register({id:'recursive',bytes:recursive,origin:'explicit'},{purpose:'edit'})).reason,'invalid-font','组合字形引用自身不能使轮廓读取陷入递归');
const invalidCmap=sample('latin.ttf'),cmap=fontTable(invalidCmap,'cmap');
new DataView(invalidCmap.buffer).setUint32(cmap.offset+8,cmap.length+2);
assert.equal((await provider.register({id:'bad-cmap',bytes:invalidCmap,origin:'explicit'},{purpose:'edit'})).reason,'invalid-font','字符映射子表必须留在 cmap 表内');
const invalidGlyph=makeTtf(),map=fontTable(invalidGlyph,'cmap');
const mapView=new DataView(invalidGlyph.buffer,invalidGlyph.byteOffset,invalidGlyph.byteLength);
const sub=map.offset+mapView.getUint32(map.offset+8),segments=mapView.getUint16(sub+6)/2;
mapView.setInt16(sub+16+segments*4,100);
assert.equal((await provider.register({id:'bad-cmap-gid',bytes:invalidGlyph,origin:'explicit'},{purpose:'edit'})).reason,'invalid-font','cmap 不能引用不存在的 GID');
provider.dispose();
const closed=await provider.register({id:'closed',origin:'explicit'}, {purpose:'edit'});
assert.equal(closed.reason,'provider-disposed','关闭后不得再次申请资源');
assert.equal(provider.state().retainedFontBytes,0);
await fontShapeContract(api,assert);
await fontShapeBoundaryContract(api,assert);
await fontRegistrationContract(api,assert);
await fontEotContract(api,assert);
await fontInputBudgetContract(api,assert);
record();
console.log('字体 Provider：显式字节与文稿关闭边界通过');
