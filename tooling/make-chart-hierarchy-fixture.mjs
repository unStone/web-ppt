/** 层级缓存先叶后根，工作簿先根后叶；两者刻意同时覆盖稀疏和重复父标签。 */
import { readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { deck, makeZip, slideXml } from './lib/ooxml.mjs';

const base=unzipSync(readFileSync('fixtures/sample-chart-data.pptx'));
const workbook=unzipSync(base['ppt/embeddings/chart-data.xlsx']);
const chart=strFromU8(base['ppt/charts/chart1.xml']);
const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const c='http://schemas.openxmlformats.org/drawingml/2006/chart';
const s='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;');
const col=index=>String.fromCharCode(65+index);
const variants=[
  {name:'两级类别',slots:[['North','A'],[null,'A'],['South',''],['',null],[null,'0']],cells:[['North','A'],['North','A'],['South',''],['',null],['',0]]},
  {name:'三级类别',slots:[['North','East','A'],[null,null,'A'],[null,'West',''],['South',null,null],[null,'East','0'],[null,null,'B']],cells:[['North','East','A'],['North','East','A'],['North','West',''],['South',null,null],['South','East',0],['South','East','B']]},
  {name:'横向两级类别',horizontal:true,slots:[['North','A'],[null,'A'],['South',''],['',null],[null,'0']],cells:[['North','A'],['North','A'],['South',''],['',null],['',0]]},
];
const entries=[],types=[],relationships=[];
const slides=variants.map((variant,index)=>{
  const n=index+1,depth=variant.slots[0].length,count=variant.slots.length;
  const address=(point,level)=>variant.horizontal ? `${col(point+1)}${level+1}` : `${col(level)}${point+2}`;
  const formula=`Sheet1!$${address(0,0).replace(/(\d+)/,'$$$1')}:$${address(count-1,depth-1).replace(/(\d+)/,'$$$1')}`;
  const cache=`<c:multiLvlStrRef><c:f>${formula}</c:f><c:multiLvlStrCache><c:ptCount val="${count}"/>${Array.from({length:depth},(_,i)=>depth-i-1).map(level=>`<c:lvl>${variant.slots.map((path,p)=>path[level]===null?'':`<c:pt idx="${p}"><c:v>${esc(path[level])}</c:v></c:pt>`).join('')}</c:lvl>`).join('')}</c:multiLvlStrCache></c:multiLvlStrRef>`;
  const cells=new Map();
  const cell=(address,value)=>cells.set(address,value===null?`<c r="${address}"/>`:typeof value==='number'?`<c r="${address}"><v>${value}</v></c>`:`<c r="${address}" t="inlineStr"><is><t>${esc(value)}</t></is></c>`);
  variant.cells.forEach((path,p)=>path.forEach((value,level)=>cell(address(p,level),value)));
  let seriesIndex=0;
  let xml=chart.replace(/<c:ser>[\s\S]*?<\/c:ser>/g,series=>{
    const i=seriesIndex++,name=variant.horizontal?`A${depth+i+1}`:`${col(depth+i)}1`;
    const valueAddress=p=>variant.horizontal?`${col(p+1)}${depth+i+1}`:`${col(depth+i)}${p+2}`;
    cell(name,`Series ${i+1}`);
    const values=Array.from({length:count},(_,p)=>p===3?null:(p+i)*10);
    values.forEach((value,p)=>cell(valueAddress(p),value));
    const ref=`Sheet1!${valueAddress(0)}:${valueAddress(count-1)}`;
    return series.replace(/<c:cat>[\s\S]*?<\/c:cat>/,`<c:cat>${cache}</c:cat>`)
      .replace(/<c:tx>[\s\S]*?<\/c:tx>/,`<c:tx><c:strRef><c:f>Sheet1!${name}</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Series ${i+1}</c:v></c:pt></c:strCache></c:strRef></c:tx>`)
      .replace(/<c:val>[\s\S]*?<\/c:val>/,`<c:val><c:numRef><c:f>${ref}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="${count}"/>${values.map((value,p)=>value===null?'':`<c:pt idx="${p}"><c:v>${value}</c:v></c:pt>`).join('')}</c:numCache></c:numRef></c:val>`);
  });
  const rows=new Map();
  for(const [address,xml] of cells){const row=Number(address.match(/\d+/)[0]);if(!rows.has(row))rows.set(row,[]);rows.get(row).push([address,xml]);}
  const sheet=`<worksheet xmlns="${s}"><sheetData>${[...rows].sort(([a],[b])=>a-b).map(([row,cells])=>`<row r="${row}">${cells.sort(([a],[b])=>a.localeCompare(b)).map(([,xml])=>xml).join('')}</row>`).join('')}<row r="20"><c r="Z20" t="inlineStr"><is><t>KEEP</t></is></c></row></sheetData></worksheet>`;
  const book=makeZip(Object.entries({...workbook,'xl/worksheets/sheet1.xml':new TextEncoder().encode(sheet)}));
  entries.push([`ppt/charts/chart${n}.xml`,xml],[`ppt/embeddings/hierarchy${n}.xlsx`,book],
    [`ppt/charts/_rels/chart${n}.xml.rels`,`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/package" Target="../embeddings/hierarchy${n}.xlsx"/></Relationships>`]);
  types.push(`<Override PartName="/ppt/charts/chart${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`);
  relationships.push(`<Relationship Id="rIdChart" Type="${rel}/chart" Target="../charts/chart${n}.xml"/>`);
  return slideXml(`<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="${variant.name}"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr><p:xfrm><a:off x="952500" y="952500"/><a:ext cx="9144000" cy="4762500"/></p:xfrm><a:graphic><a:graphicData uri="${c}"><c:chart xmlns:c="${c}" r:id="rIdChart"/></a:graphicData></a:graphic></p:graphicFrame>`);
});
writeFileSync('fixtures/sample-chart-hierarchy.pptx',deck({name:'Chart Hierarchy',width:1280,height:720,slides,slideRelationships:relationships,extraTypes:`<Default Extension="xlsx" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"/>${types.join('')}`,extraEntries:entries}));
console.log('多级类别固件：两级、三级、横向矩阵、空槽、重复标签及数值零');
