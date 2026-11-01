import { readCounts,recordCount } from './lib/measured.mjs';
const keys=['slideResize','commentEdit','chartDesign','chartexEdit','smartartEdit','cfb','oleEdit','inkEdit','regionMap','emfPlus','threeD','advancedRendering','pdf','video','portableClipboard','pptSave'];
const counts=readCounts();
// counts 由各源码套件在 test:functional 里写入；发布快路径只跑 dist 套件，全新 runner
// 上无 counts 文件，此时跳过汇总（verify-consistency 对缺失 key 已有黄字跳过语义）。
// 文件存在而 key 不全或值非整数仍抛错——counts 是累积文件，那是套件没跑完的真问题。
if(counts===null) {
  console.log('  扩展能力：本环境无源码套件计数（发布快路径），跳过汇总登记');
} else {
  if(!keys.every(key=>Number.isInteger(counts?.[key])))throw new Error('扩展专项实测计数不完整');
  const total=keys.reduce((sum,key)=>sum+counts[key],0);recordCount('expanded',total);
  console.log(`扩展能力 ${keys.length} 套契约，共 ${total} 项断言`);
}
