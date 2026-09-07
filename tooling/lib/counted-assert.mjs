import nodeAssert from 'node:assert/strict';
import { recordCount } from './measured.mjs';

/** 统计实际执行的契约断言；可选外部语料放在 record() 后，不影响确定性门禁数字。 */
export function countedAssert(suite) {
  let count=0;
  const call=fn=>(...args)=>{const result=fn(...args);count++;return result;};
  const assert=new Proxy(call(nodeAssert),{
    get:(_,key)=>typeof nodeAssert[key]==='function'?call(nodeAssert[key]):nodeAssert[key],
  });
  return {assert,record:()=>recordCount(suite,count)};
}
