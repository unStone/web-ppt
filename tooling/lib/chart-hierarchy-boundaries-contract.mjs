import { unzipSync, strFromU8, strToU8, zipSync } from 'fflate';

export async function testHierarchyBoundaries({core, edit, chart, design, input, assert}) {
  const change=fn=>{const parts=unzipSync(input);parts['ppt/charts/chart1.xml']=strToU8(fn(strFromU8(parts['ppt/charts/chart1.xml'])));return zipSync(parts);};
  const cases=[
    ['系列数据超过类别范围',change(xml=>xml.replace(/(<c:val>[\s\S]*?<c:ptCount val=")5/,(_,prefix)=>prefix+'6')
      .replace('</c:numCache>','<c:pt idx="5"><c:v>999</c:v></c:pt></c:numCache>')),/类别.*点数/],
    ['缺少层级值',change(xml=>xml.replace('<c:pt idx="0"><c:v>North</c:v></c:pt>','<c:pt idx="0"/>')),/层级.*值/],
    ['公式无法映射',change(xml=>xml.replaceAll('Sheet1!$A$2:$B$6','DynamicCategoryName')),/公式/],
    ['重复层级索引',change(xml=>xml.replace('<c:v>North</c:v></c:pt>','<c:v>North</c:v></c:pt><c:pt idx="0"><c:v>Duplicate</c:v></c:pt>')),/索引/],
  ];
  for(const [name,bytes,reason] of cases){
    const p=await core.parse(bytes,{edit:true,keepPackage:true,lazy:false}),editor=new edit.Editor(edit.createDoc(p));
    const item=chart.listEditableCharts(editor.doc)[0];
    assert.equal(item.binding.mode,'readonly',name);assert.match(item.binding.reason,reason,name);
    assert.throws(()=>chart.createChartDataEditor(editor).setSeriesName(item.id,chart.queryChartData(editor.doc,item.id).series[0].id,'Rejected'));
    assert.throws(()=>design.createChartDesignEditor(editor).set(item.id,{title:'Rejected'}));
    assert.equal(editor.isDirty(),false,'数据和样式沿用同一个只读判断');
    assert.deepEqual(await editor.save(),bytes,'拒绝修改保留原包');
    editor.dispose();p.dispose();
  }
  {
    const p=await core.parse(input,{edit:true,keepPackage:true,lazy:false}),editor=new edit.Editor(edit.createDoc(p));
    const id=chart.listEditableCharts(editor.doc)[0].id,api=chart.createChartDataEditor(editor),added=api.addCategory(id,['Top','Leaf']);
    const path=['elements',id,'ovr','extensions','chart-data','categories',added,'levels','1'];
    edit.applyPatches(editor.doc,[{op:'del',path,origin:'remote'}]);
    assert.equal(chart.queryChartData(editor.doc,id).categories.some(c=>c.id===added),false,'不完整新增路径等待余下字段');
    edit.applyPatches(editor.doc,[{op:'set',path,value:'Arrived',origin:'remote'}]);
    assert.deepEqual(chart.queryChartData(editor.doc,id).categories.at(-1).levels,['Top','Arrived']);
    editor.dispose();p.dispose();
  }
  {
    const depth=64,count=1562;
    const cat=`<c:cat><c:multiLvlStrRef><c:f>Sheet1!$A$2:$BL$1563</c:f><c:multiLvlStrCache><c:ptCount val="${count}"/>${Array.from({length:depth},(_,i)=>`<c:lvl><c:pt idx="0"><c:v>${i}</c:v></c:pt></c:lvl>`).join('')}</c:multiLvlStrCache></c:multiLvlStrRef></c:cat>`;
    const bytes=change(xml=>xml.replace(/<c:cat>[\s\S]*?<\/c:cat>/g,cat).replace(/<c:externalData[\s\S]*?<\/c:externalData>/g,''));
    const p=await core.parse(bytes,{edit:true,keepPackage:true,lazy:false}),editor=new edit.Editor(edit.createDoc(p));
    const id=chart.listEditableCharts(editor.doc)[0].id;
    assert.equal(chart.queryChartData(editor.doc,id).binding.mode,'cache');
    assert.throws(()=>chart.createChartDataEditor(editor).addCategory(id,'Over limit'),/层级.*上限/,'不能写出自身读取器拒绝的层级规模');
    assert.equal(editor.isDirty(),false);assert.deepEqual(await editor.save(),bytes);
    editor.dispose();p.dispose();
  }
}
