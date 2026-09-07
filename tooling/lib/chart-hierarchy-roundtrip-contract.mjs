import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';

export async function testHierarchyRoundTrips({core, edit, chart, generate, design, input, out, assert}) {
  const parse=bytes=>core.parse(bytes,{edit:true,keepPackage:true,lazy:false});
  const make=async(options)=>{
    const p=await parse(input),editor=new edit.Editor(edit.createDoc(p,{idPrefix:'hierarchy-'}),options);
    return {p,editor,api:chart.createChartDataEditor(editor),ids:chart.listEditableCharts(editor.doc).map(c=>c.id)};
  };
  const levels=[2,3,2],orientations=['rows','rows','columns'];
  for(const generated of [false,true]) {
    const {p,editor,api,ids}=await make(),frames=[];
    editor.subscribeRecovery(frame=>frames.push(frame));
    const original=ids.map(id=>chart.queryChartData(editor.doc,id));
    for(const [i,id] of ids.entries()) {
      const data=original[i],binding=data.series[0].bindings.categories;
      assert.equal(data.binding.mode,'workbook');
      assert.deepEqual(binding.hierarchy,{levels:levels[i],orientation:orientations[i]});
      api.setCategoryLevel(id,data.categories[0].id,0,'Renamed & < >');
      api.setCategoryLabel(id,data.categories[1].id,'Repeated A');
      api.setValue(id,data.series[0].id,data.categories[1].id,987.5);
      const path=Array(levels[i]).fill(null);path[0]='New group';path[levels[i]-1]='0';
      api.addCategory(id,path);api.addSeries(id,'New series');
      design.createChartDesignEditor(editor).set(id,{type:'line',title:`Hierarchy ${i+1}`});
    }
    const expected=ids.map(id=>chart.queryChartData(editor.doc,id));
    const restored=await make({recoveryFrames:JSON.parse(JSON.stringify(frames))});
    assert.deepEqual(restored.ids.map(id=>chart.queryChartData(restored.editor.doc,id)),expected,'冷恢复保留完整层级路径和稀疏语义');
    restored.editor.dispose();restored.p.dispose();
    if(generated)p.dispose();
    const saved=await editor.save();writeFileSync(join(out,generated?'generated.pptx':'patched.pptx'),saved);
    assert.deepEqual(await editor.save(),saved,'连续保存稳定');
    const read=await parse(saved),doc=edit.createDoc(read),reopened=chart.listEditableCharts(doc);
    const parts=unzipSync(saved),source=unzipSync(input);
    for(const [i,item] of reopened.entries()) {
      const actual=chart.queryChartData(doc,item.id);
      assert.equal(actual.binding.mode,'workbook');
      assert.deepEqual(actual.categories.map(({order,...c})=>c),expected[i].categories.map(({order,...c})=>c),'补丁与生成保存均保留类别身份、空槽和重复标签');
      assert.equal(actual.series[0].points[1].value,987.5);
      assert.equal(actual.series.length,3);
      const book=unzipSync(parts[actual.binding.workbookPart]),before=unzipSync(source[`ppt/embeddings/hierarchy${i+1}.xlsx`]);
      for(const part of Object.keys(before).filter(n=>!['xl/worksheets/sheet1.xml','xl/sharedStrings.xml'].includes(n)))assert.deepEqual(book[part],before[part],`未改工作簿部件 ${part}`);
      const window=new JSDOM(strFromU8(book['xl/worksheets/sheet1.xml']),{contentType:'text/xml'}).window;
      assert.equal(window.document.querySelector('[r="Z20"]').textContent,'KEEP');window.close();
      const xml=strFromU8(parts[actual.binding.chartPart]);
      assert.equal((xml.match(/<c:multiLvlStrRef>/g)??[]).length,3,'每个系列继续使用原生层级类别引用');
      assert.equal((xml.match(/<c:lvl>/g)??[]).length,levels[i]*3);
    }
    edit.disposeDoc(doc);read.dispose();
    for(let count=0;count<18;count++)editor.undo();
    assert.deepEqual(ids.map(id=>chart.queryChartData(editor.doc,id)),original,'全部撤销恢复层级、数值和身份');
    editor.dispose();p.dispose();
  }
  const unedited=await make();unedited.p.dispose();
  writeFileSync(join(out,'unchanged-generated.pptx'),await unedited.editor.save());unedited.editor.dispose();
  for(const index of [0,1,2]){
    const current=await make(),id=current.ids[index],initial=chart.queryChartData(current.editor.doc,id);
    initial.series.forEach(series=>current.api.removeSeries(id,series.id));
    const emptyBytes=await current.editor.save();current.editor.dispose();current.p.dispose();
    const p=await parse(emptyBytes),editor=new edit.Editor(edit.createDoc(p));
    const freshId=chart.listEditableCharts(editor.doc)[index].id,empty=chart.queryChartData(editor.doc,freshId);
    assert.equal(empty.binding.mode,'workbook','删光系列后保存重开仍可重建');
    assert.deepEqual(empty.categories.map(c=>c.levels),initial.categories.map(c=>c.levels));
    chart.createChartDataEditor(editor).addSeries(freshId,'Restored');
    const saved=await editor.save(),reopened=await parse(saved),doc=edit.createDoc(reopened);
    const restored=chart.queryChartData(doc,chart.listEditableCharts(doc)[index].id);
    assert.equal(restored.binding.mode,'workbook');assert.equal(restored.series.length,1);
    edit.disposeDoc(doc);reopened.dispose();editor.dispose();p.dispose();
  }
  const copying=await make(),id=copying.ids[1];
  copying.api.setCategoryLevel(id,chart.queryChartData(copying.editor.doc,id).categories[0].id,0,'Copied group');
  copying.p.dispose();
  const payload=generate.copyPortableElements(copying.editor.doc,[id]);
  copying.editor.dispose();
  const target=await core.parse(generate.createBlankPptx(),{edit:true,keepPackage:true,lazy:false});
  const destination=new edit.Editor(edit.createDoc(target));
  assert.throws(()=>destination.exec({type:'PasteElements',payload:JSON.parse(JSON.stringify(payload)),at:{parentId:destination.doc.slideOrder[0],x:100,y:100}}),/相同 OPC 闭包/,'经典图表沿用跨文稿资源闭包边界');
  assert.equal(destination.isDirty(),false,'不支持的跨文稿复制原子拒绝');
  assert.equal(destination.doc.slides[destination.doc.slideOrder[0]].children.length,0);
  destination.dispose();target.dispose();
}
