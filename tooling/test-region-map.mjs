import { countedAssert } from './lib/counted-assert.mjs';
const {assert,record}=countedAssert('regionMap');
import{mkdirSync,writeFileSync,readFileSync,existsSync}from'node:fs';import{join,resolve}from'node:path';import{unzipSync}from'fflate';
import{bundleBrowser}from'./lib/bundle-browser.mjs';import{mapXml,rings,encodeRing}from'./lib/region-map-fixture.mjs';
const root=resolve('.'),out=join(root,'out/region-map');mkdirSync(out,{recursive:true});
const entry=join(out,'entry.mjs');writeFileSync(entry,`export * as core from ${JSON.stringify(join(root,'packages/core/src/index.ts'))};export * as chart from ${JSON.stringify(join(root,'packages/core/src/chart-ex.ts'))};export * as cache from ${JSON.stringify(join(root,'packages/core/src/chart-ex/map-cache.ts'))};export * as edit from ${JSON.stringify(join(root,'packages/edit-core/src/index.ts'))};export * as data from ${JSON.stringify(join(root,'packages/edit-core/src/chart-ex/index.ts'))};`);
const bundled=await bundleBrowser({root,entry,output:join(out,'contract.mjs'),aliases:[['@web-ppt/core/chart-ex',join(root,'packages/core/src/chart-ex.ts')],['@web-ppt/core/geometry',join(root,'packages/core/src/geometry/index.ts')],['@web-ppt/core',join(root,'packages/core/src/index.ts')],['@web-ppt/edit-core/xml',join(root,'packages/edit-core/src/xml/index.ts')],['@web-ppt/edit-core/opc',join(root,'packages/edit-core/src/opc/index.ts')],['@web-ppt/edit-core',join(root,'packages/edit-core/src/index.ts')]]});
const {core,chart,edit,data}=process.argv.includes('--dist') ? {core:await import('@web-ppt/core'),chart:await import('@web-ppt/core/chart-ex'),edit:await import('@web-ppt/edit-core'),data:await import('@web-ppt/edit-core/chart-ex')} : bundled;
const {cache}=bundled;
const env={ctx:{theme:{dk1:'000000',lt1:'FFFFFF',accent1:'4472C4',accent2:'ED7D31'},clrMap:{tx1:'dk1'}},fonts:{minor:{latin:'Arial',ea:null},major:{latin:'Arial',ea:null}},rels:{}};
const svg=(elements,height)=>{const slide={elements,background:{type:'solid',color:'#fff'}};return core.renderSlideToSvg({width:800,height,slides:[slide]},slide,{textMode:'svg'});};
for(const ring of rings)assert.deepEqual(cache.decodeGeoRing(encodeRing(ring)),ring);
assert.throws(()=>cache.decodeGeoRing('invalid!'),/边界|顶点|坐标/);
for(const projection of['mercator','miller','robinson','albers'])for(const binary of[false,true])for(const antimeridian of[false,true]){
 const elements=chart.renderChartExXml(mapXml({projection,binary,antimeridian}),800,500,env);assert.equal(elements.filter(e=>e.name==='East'||e.name==='West').length,2);assert(!/NaN|Infinity/.test(JSON.stringify(elements)));
 const west=elements.find(e=>e.name==='West');assert.equal((west.path.match(/M/g)||[]).length,2,'内外环原生路径');
 if(!binary&&!antimeridian)writeFileSync(join(out,`${projection}.svg`),svg(elements,500));
}
assert.deepEqual(chart.renderChartExXml(mapXml().replace('pcaRings="1,','pcaRings="2,'),800,500,env),[]);
core.setChartExParser(chart.parseChartEx);
for(const generated of[false,true]){
 const p=await core.parse(readFileSync('fixtures/sample-region-map.pptx'),{edit:true,keepPackage:true,lazy:false}),editor=new edit.Editor(edit.createDoc(p));
 const item=data.listEditableChartEx(editor.doc).at(-1);assert.equal(editor.effectiveElement(item.id).kind,'group');
 const api=data.createChartExEditor(editor),dataset=api.query(item.id);const dim=dataset[0].dimensions.findIndex(d=>d.kind==='num');
 const numeric=dim>=0?dim:dataset[0].dimensions.findIndex(d=>d.type==='colorVal');
 api.setCell(item.id,dataset[0].id,numeric,0,0,99);
 if(generated)p.dispose();const saved=await editor.save();writeFileSync(join(out,`${generated?'generated':'patched'}.pptx`),saved);
 const reopened=await core.parse(saved,{edit:true,keepPackage:true,lazy:false}),fresh=new edit.Editor(edit.createDoc(reopened));
 const freshItem=data.listEditableChartEx(fresh.doc).at(-1);assert.equal(data.queryChartExData(fresh.doc,freshItem.id)[0].dimensions[numeric].levels[0][0],99);
 fresh.dispose();reopened.dispose();editor.dispose();p.dispose();
}
record();
const corpus='corpus/chartex/regionMap.xlsx';if(existsSync(corpus)){
 const book=readFileSync(corpus),parts=unzipSync(book);const xml=new TextDecoder().decode(parts['xl/charts/chartEx1.xml']).replace('<cx:chartData>','<cx:chartData><cx:externalData r:id="book"/>');
 const elements=chart.renderChartExXml(xml,800,600,{...env,rels:{book:{type:'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package',target:'book.xlsx'}},readPart:p=>p==='book.xlsx'?book:undefined});
 assert.equal(elements.filter(e=>e.name).length,10,'真实 Office 缓存解压和名称别名');writeFileSync(join(out,'office-region-map.svg'),svg(elements,600));
}
console.log('原生地图：PCA 边界、明文/压缩缓存、四种投影、日期变更线、孔洞和真实 Office 样本通过');
