import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import Ajv from 'ajv';
const data=JSON.parse(readFileSync('out/agent-lint/corpus-input.json','utf8'));
const validate=new Ajv({strict:false}).compile(JSON.parse(readFileSync('packages/edit-core/schemas/lint.schema.json','utf8')));
const counts={},failures={},rows=[];
for(const[file,result]of Object.entries(data)){
 if(result.error){const r=result.error.reason;assert.equal(file,'sample-editor-image-content.pptx',`${file} 未解释的失败 ${r}`);assert.equal(r,'image-metadata-unavailable');failures[r]=(failures[r]??0)+1;rows.push({file,...result.error,review:'源图是 example.invalid 外链且未携带字节；缺少真实尺寸，整次调用明确失败'});continue;}
 assert(validate(result.report),`${file} ${JSON.stringify(validate.errors)}`);
 for(const issue of result.report.issues){
  const m=issue.measurements;counts[issue.reason]=(counts[issue.reason]??0)+1;
  const valid=issue.reason==='off-canvas'?m.outsidePx>m.tolerancePx:issue.reason==='element-overlap'?m.ratio>m.threshold:
   issue.reason==='image-distorted'?m.deviation>m.threshold:issue.reason==='low-contrast'?m.ratio>=1&&m.ratio<m.threshold:
   issue.reason==='missing-font'?m.missingCount===m.families.length&&m.missingCount>0:issue.reason==='placeholder-prompt-left'?m.matchedCount>0&&m.text.trim():
   m.contentBottom>m.availableBottom+m.tolerancePx||m.widthOverflow>m.tolerancePx;
  assert(valid,`${file} ${issue.elementId} 触发条件与实测不符`);
  rows.push({file,...issue,review:'数值/来源条件成立；合成固件中的有意越界、重叠、缺字体与拉伸仍是观察结果，由调用者判断是否修改'});
 }
}
writeFileSync('out/agent-lint/reviewed.json',JSON.stringify({counts,failures,rows},null,2));
console.log(JSON.stringify({files:Object.keys(data).length,counts,failures,reviewed:rows.length},null,2));
