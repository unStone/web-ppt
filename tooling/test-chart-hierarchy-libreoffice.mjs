import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';

const out=resolve('out/chart-hierarchy'),soffice=process.env.SOFFICE??'/Applications/LibreOffice.app/Contents/MacOS/soffice';
const c='http://schemas.openxmlformats.org/drawingml/2006/chart';
const snapshot=bytes=>{
  const parts=unzipSync(bytes),result=[];
  for(const part of Object.keys(parts).filter(p=>/^ppt\/charts\/chart\d+\.xml$/.test(p)).sort()){
    const window=new JSDOM(strFromU8(parts[part]),{contentType:'text/xml'}).window;
    const series=[...window.document.getElementsByTagNameNS(c,'ser')].map(ser=>{
      const cache=ser.getElementsByTagNameNS(c,'multiLvlStrCache')[0];
      return {levels:cache?[...cache.getElementsByTagNameNS(c,'lvl')].map(level=>[...level.getElementsByTagNameNS(c,'pt')].map(pt=>[Number(pt.getAttribute('idx')),pt.textContent])).reverse():[],
        count:Number(cache?.getElementsByTagNameNS(c,'ptCount')[0]?.getAttribute('val')),
        values:[...ser.getElementsByTagNameNS(c,'numCache')].flatMap(cache=>[...cache.getElementsByTagNameNS(c,'pt')].map(pt=>[Number(pt.getAttribute('idx')),pt.textContent]))};
    });
    result.push({part,series});window.close();
  }
  return result;
};
const evidence={version:execFileSync(soffice,['--version'],{encoding:'utf8'}).trim(),readers:{}};
for(const [name,file] of [['source','fixtures/sample-chart-hierarchy.pptx'],['patched',`${out}/patched.pptx`],['generated',`${out}/generated.pptx`]]){
  const dir=join(out,'libreoffice',name);mkdirSync(dir,{recursive:true});
  const target=join(dir,basename(file));rmSync(target,{force:true});
  execFileSync(soffice,[`-env:UserInstallation=file://${out}/lo-profile`,'--headless','--norestore','--convert-to','pptx','--outdir',dir,resolve(file)],{timeout:60000,stdio:'pipe'});
  assert(existsSync(target),'独立读取器实际生成文件');
  evidence.readers[name]={before:snapshot(readFileSync(file)),after:snapshot(readFileSync(target))};
}
evidence.boundary='LibreOffice 重存省略显式空字符串；本工具保存时保留空字符串与缺失槽的区别。Windows PowerPoint 真机验收仍暂缓。';
writeFileSync(join(out,'libreoffice.json'),JSON.stringify(evidence,null,2)+'\n');
assert.deepEqual(evidence.readers.patched.after,evidence.readers.generated.after,'补丁与生成文件在独立读取器中一致');
for(const [name,reader] of Object.entries(evidence.readers)){
  assert.equal(reader.after.length,3);
  reader.after.forEach((chart,index)=>{
    assert.equal(chart.series.length,name==='source'?2:3);
    for(const [s,series] of chart.series.entries()){
      assert.equal(series.levels.length,index===1?3:2,'LibreOffice 保留层级数');
      const before=reader.before[index].series[s];
      assert.equal(series.count,before.count);
      assert.deepEqual(series.levels,before.levels.map(level=>level.filter(([,value])=>value!=='')),'独立读取保留非空父组与重复叶标签');
      assert.deepEqual(series.values,before.values,'独立读取保留修改后的数值和缺失点');
    }
  });
}
console.log('LibreOffice：多级类别来源、补丁和生成保存均保留两级/三级结构；原始对照已落盘');
