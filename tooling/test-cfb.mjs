import { countedAssert } from './lib/counted-assert.mjs';
const {assert,record}=countedAssert('cfb');
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { bundleBrowser } from './lib/bundle-browser.mjs';
const root = resolve(import.meta.dirname, '..'), out = join(root, 'out/cfb'); mkdirSync(out, { recursive: true });
const cfb = await bundleBrowser({ root, entry: join(root, 'packages/edit-core/src/cfb/index.ts'), output: join(out, 'cfb.mjs') });
const { Cfb } = await bundleBrowser({ root, entry: join(root, 'packages/core/src/ppt/cfb.ts'), output: join(out, 'reader.mjs') });
for(let size=0;size<32;size++){
 const file=cfb.readCompoundFile(cfb.createCompoundFile(Object.fromEntries(Array.from({length:size},(_,i)=>[`stream-${i}`,new Uint8Array()]))));
 const root=new DataView(file.entries[0].raw.buffer).getUint32(76,true);
 if(root!==0xffffffff)assert.equal(file.entries[root].raw[67],1,'目录树根为黑色');
 const depth=(id,red=false)=>{
  if(id===0xffffffff)return 0;
  const raw=file.entries[id].raw,v=new DataView(raw.buffer),black=raw[67];
  assert(!red||black===1,'红节点不能有红孩子');
  const left=depth(v.getUint32(68,true),black===0),right=depth(v.getUint32(72,true),black===0);
  assert.equal(left,right,'每条路径黑节点数量相等');return left+black;
 };
 depth(root);
}
const fixtures = { empty: new Uint8Array(), small: new Uint8Array([1,2,3]), 'storage/child': new Uint8Array(4095).fill(23),
  big: new Uint8Array(8 * 1024 * 1024).fill(42), 'storage/nested/another': new Uint8Array(4096).fill(77) };
const bytes = cfb.createCompoundFile(fixtures), parsed = cfb.readCompoundFile(bytes);
assert(new DataView(bytes.buffer).getUint32(72,true) > 0, '大型文件使用 DIFAT');
for (const [path, value] of Object.entries(fixtures)) assert.deepEqual(parsed.entries.find((e) => e.path === path).bytes, value);
const independent = new Cfb(bytes); assert.deepEqual(independent.stream('big'), fixtures.big);
const storage = parsed.entries.find((e) => e.path === 'storage'); storage.raw.set([1,2,3,4],80); storage.raw.set([5,6,7,8],100);
const source = cfb.writeCompoundFile(parsed), updated = cfb.patchCompoundFile(source, { small: new Uint8Array(6000).fill(9), big: new Uint8Array([8,7]) });
const reopened = cfb.readCompoundFile(updated);
assert.deepEqual(reopened.entries.find((e) => e.path === 'storage').raw.slice(80,116), storage.raw.slice(80,116));
assert.equal(reopened.entries.find((e) => e.path === 'small').bytes.length, 6000);
assert.deepEqual(new Cfb(updated).stream('big'), new Uint8Array([8,7]));
assert.deepEqual(cfb.createCompoundFile(fixtures), bytes);
assert.throws(() => cfb.createCompoundFile({ one: new Uint8Array(), ONE: new Uint8Array() }), /冲突/);
assert.throws(() => cfb.readCompoundFile(bytes.subarray(0, bytes.length - 1)), /截断/);
const corrupt = bytes.slice(), view = new DataView(corrupt.buffer); view.setUint32(48, 0xfffffffa, true);
assert.throws(() => cfb.readCompoundFile(corrupt), /越界/);
writeFileSync(join(out, 'compound.bin'), updated);
record();
console.log('CFB：大小流互换、DIFAT、嵌套存储、未知元数据、独立读取器与损坏拒绝通过');
