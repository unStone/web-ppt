import { readCounts,recordCount } from './lib/measured.mjs';
const keys=['slideResize','commentEdit','chartDesign','chartexEdit','smartartEdit','cfb','oleEdit','inkEdit','regionMap','emfPlus','threeD','pdf','video','portableClipboard','pptSave'];
const counts=readCounts();
if(!keys.every(key=>Number.isInteger(counts?.[key])))throw new Error('扩展专项实测计数不完整');
const total=keys.reduce((sum,key)=>sum+counts[key],0);recordCount('expanded',total);
console.log(`扩展能力 ${keys.length} 套契约，共 ${total} 项断言`);
