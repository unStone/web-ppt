import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';

const root=resolve('.'),out=join(root,'out/portable-rich-text');
const soffice=process.env.SOFFICE ?? '/Applications/LibreOffice.app/Contents/MacOS/soffice';
const m='http://schemas.openxmlformats.org/officeDocument/2006/math';
const snapshot=bytes=>{
  const parts=unzipSync(bytes),result=[];
  for(let index=1;index<=3;index++){
    const window=new JSDOM(strFromU8(parts[`ppt/slides/slide${index}.xml`]),{contentType:'text/xml'}).window;
    const doc=window.document;
    result.push({fraction:doc.getElementsByTagNameNS(m,'f').length,root:doc.getElementsByTagNameNS(m,'rad').length,
      script:doc.getElementsByTagNameNS(m,'sSubSup').length,text:[...doc.getElementsByTagNameNS(m,'t')].map(n=>n.textContent).join('')});
    window.close();
  }
  return result;
};
const evidence={version:execFileSync(soffice,['--version'],{encoding:'utf8'}).trim(),readers:{}};
for(const [name,file] of [['source','fixtures/sample-portable-rich-text.pptx'],['generated','out/portable-rich-text/generated.pptx']]){
  const dir=join(out,'libreoffice',name);mkdirSync(dir,{recursive:true});
  const target=join(dir,basename(file));rmSync(target,{force:true});
  execFileSync(soffice,[`-env:UserInstallation=file://${out}/lo-profile`,'--headless','--norestore','--convert-to','pptx','--outdir',dir,resolve(file)],{timeout:60000,stdio:'pipe'});
  assert(existsSync(target),'独立读取器本次实际产出文件');
  const before=snapshot(readFileSync(file)),after=snapshot(readFileSync(target));
  assert.equal(after[2].fraction,1,'独立读取器保留分式');
  assert.equal(after[2].root,1,'独立读取器保留根式');
  assert.equal(after[2].script,1,'独立读取器保留上下标');
  assert.equal(after[2].text,before[2].text,'独立读取器保留数学叶子文本');
  evidence.readers[name]={before,after};
}
assert.deepEqual(evidence.readers.generated.after,evidence.readers.source.after,'来源与生成文件在独立读取器中的语义一致');
evidence.boundary='当前 LibreOffice 会丢弃形状内混排及表格公式；独立公式形状可读取。该结果不等于 Windows PowerPoint 验收。';
writeFileSync(join(out,'libreoffice.json'),JSON.stringify(evidence,null,2)+'\n');
console.log('LibreOffice：来源与生成均保留独立嵌套公式；行内与表格公式边界已记录');
