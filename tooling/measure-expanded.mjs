import { readCounts,recordCount } from './lib/measured.mjs';
const keys=['slideResize','commentEdit','chartDesign','chartexEdit','smartartEdit','cfb','oleEdit','inkEdit','regionMap','emfPlus','threeD','advancedRendering','pdf','video','portableClipboard','pptSave'];
const counts=readCounts();
// counts 由各源码套件在 test:functional 里写入；发布快路径只跑 dist 套件，runner 上
// counts 只含 dist 套件的少数 key（或完全没有）。两种缺失都跳过汇总并说明缺哪些
// （verify-consistency 对缺失 key 已有黄字跳过语义）；齐备时才登记总数。
const missing = counts === null ? keys : keys.filter(key=>!Number.isInteger(counts[key]));
if(missing.length) {
  console.log(`  扩展能力：${missing.length} 个源码套件计数缺失（${missing.slice(0,4).join('、')}${missing.length>4?' 等':''}），跳过汇总登记`);
} else {
  const total=keys.reduce((sum,key)=>sum+counts[key],0);recordCount('expanded',total);
  console.log(`扩展能力 ${keys.length} 套契约，共 ${total} 项断言`);
}
