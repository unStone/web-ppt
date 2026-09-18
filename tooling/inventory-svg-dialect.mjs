#!/usr/bin/env node
/** 盘点固件原生 SVG 实际发出的节点 / 属性 / CSS，供矢量 PDF 覆盖审计消费。 */
import {readdirSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {bundleBrowser} from './lib/bundle-browser.mjs';

const root=resolve('.'),out=resolve(root,'out/vector-pdf');mkdirSync(out,{recursive:true});
writeFileSync(resolve(out,'dialect-entry.mjs'),`export {parse,renderSlideToSvg} from '@web-ppt/core';
export {parseXmlLite} from 'web-ppt-xml-lite';`);
const api=await bundleBrowser({root,entry:resolve(out,'dialect-entry.mjs'),output:resolve(out,'dialect-contract.mjs'),aliases:[
  ['@web-ppt/core',resolve(root,'packages/core/src/index.ts')],
  ['web-ppt-xml-lite',resolve(root,'packages/core/src/xml-lite.ts')],
]});

const fixtures=readdirSync(resolve(root,'fixtures')).filter(name=>/\.(pptx|ppt)$/i.test(name)).sort();
const tags=new Map(),errors=[];
let files=0,pages=0;

function bump(map,key,value){
  let entry=map.get(key); if(!entry){entry={count:0,attributes:new Map(),styles:new Map()}; map.set(key,entry);}
  entry.count++;
  for(const attr of value.attributes){
    let values=entry.attributes.get(attr.name); if(!values){values=new Map(); entry.attributes.set(attr.name,values);}
    values.set(attr.value,(values.get(attr.value)??0)+1);
  }
  const style=value.getAttribute('style'); if(!style) return;
  for(const part of style.split(';')){
    const i=part.indexOf(':'); if(i<0) continue;
    const prop=part.slice(0,i).trim(),val=part.slice(i+1).trim(); if(!prop) continue;
    let values=entry.styles.get(prop); if(!values){values=new Map(); entry.styles.set(prop,values);}
    values.set(val,(values.get(val)??0)+1);
  }
}

function walk(el){
  bump(tags,el.localName,el);
  for(const child of el.children) walk(child);
}

function freeze(map){
  const out={};
  for(const [key,entry] of [...map.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
    out[key]={count:entry.count,attributes:{},styles:{}};
    for(const [name,values] of [...entry.attributes.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
      out[key].attributes[name]=Object.fromEntries([...values.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));
    }
    for(const [name,values] of [...entry.styles.entries()].sort((a,b)=>a[0].localeCompare(b[0]))){
      out[key].styles[name]=Object.fromEntries([...values.entries()].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0])));
    }
  }
  return out;
}

for(const file of fixtures){
  try{
    const pres=await api.parse(new Uint8Array(readFileSync(resolve(root,'fixtures',file))));
    try{
      files++;
      for(const slide of pres.slides){
        walk(api.parseXmlLite(api.renderSlideToSvg(pres,slide,{textMode:'svg',idPrefix:'inventory'})));
        pages++;
      }
    }finally{pres.dispose();}
  }catch(error){
    errors.push({file,error:error instanceof Error?error.message:String(error)});
  }
}

const report={files,pages,errors,tags:freeze(tags)};
writeFileSync(resolve(out,'svg-dialect.json'),JSON.stringify(report,null,2)+'\n');
console.log(`SVG 方言盘点：${files} 份固件、${pages} 页、${Object.keys(report.tags).length} 种节点、${errors.length} 份解析失败`);
