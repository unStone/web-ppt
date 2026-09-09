import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve(import.meta.dirname,'..'),out=resolve(root,'out/font-glyphs/upstream');
mkdirSync(out,{recursive:true});
const sources=JSON.parse(readFileSync(resolve(root,'tooling/font-glyph-samples/sources.json')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const source of sources){
 const file=resolve(out,source.name);
 if(existsSync(file)&&sha(readFileSync(file))===source.sha256)continue;
 const response=await fetch(source.url);
 if(!response.ok)throw new Error(`${source.name}: HTTP ${response.status}`);
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(sha(bytes)!==source.sha256)throw new Error(`${source.name}: 上游 hash 不一致`);
 writeFileSync(file,bytes);console.log(`${source.name}: ${bytes.length} 字节`);
}
