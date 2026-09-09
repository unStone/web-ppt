import {fontSample,fontWithPermissions} from './font-glyph-samples.mjs';
import {wrapEot,TTEMBED_TTCOMPRESSED,TTEMBED_XORENCRYPTDATA} from './font.mjs';
import {eotV2} from './font-eot-v2.mjs';

export async function fontEotContract(api,assert){
  const source={id:'eot',origin:'embedded'},options={purpose:'edit'},ttf=fontSample('latin.ttf');
  const provider=api.createFontProvider();
  assert.equal((await provider.register({...source,bytes:wrapEot(ttf)},options)).ok,true,'未压缩 EOT 验证外层后还原静态字体');
  assert.deepEqual((await provider.embedding('eot',options)).value.bytes,ttf);
  const preview=wrapEot(ttf);new DataView(preview.buffer).setUint16(32,4,true);
  assert.equal((await provider.register({...source,id:'preview',bytes:preview},options)).reason,'preview-print-only','不能用内层 installable 标志覆盖外层预览限制');
  assert.equal((await provider.register({...source,id:'preview',bytes:preview},{purpose:'view-print'})).ok,true);
  assert.equal((await provider.embedding('preview',options)).reason,'preview-print-only');
  assert.equal((await provider.register({...source,id:'inner',bytes:wrapEot(fontWithPermissions(2))},options)).reason,'embedding-restricted');
  assert.equal((await provider.register({...source,id:'xor',bytes:wrapEot(ttf,{flags:TTEMBED_XORENCRYPTDATA})},options)).ok,true);
  const compressed=wrapEot(ttf,{flags:TTEMBED_TTCOMPRESSED});
  assert.equal((await provider.register({...source,id:'mtx',bytes:compressed},options)).reason,'decoder-unavailable');
  for(const version of [0x20001,0x20002]){
    const container=eotV2(ttf,{version});
    assert.equal((await provider.register({...source,id:`v2-${version}`,bytes:container.bytes},options)).ok,true,'v2 空 RootString 与无载荷默认 codepage 可用');
    assert.deepEqual((await provider.embedding(`v2-${version}`,options)).value.bytes,ttf);
  }
  assert.equal((await provider.register({...source,id:'root',bytes:eotV2(ttf,{root:'https://example.test'}).bytes},options)).reason,'eot-root-restricted');
  const checksum=eotV2(ttf);checksum.bytes[checksum.extraOffset+4]^=1;
  assert.equal((await provider.register({...source,id:'checksum',bytes:checksum.bytes},options)).reason,'invalid-font','v2 RootString 校验和损坏必须拒绝');
  const eudc=eotV2(ttf);new DataView(eudc.bytes.buffer).setUint32(eudc.extraOffset+16,1,true);
  assert.equal((await provider.register({...source,id:'eudc',bytes:eudc.bytes},options)).reason,'eot-feature-not-supported','EUDC 标志与默认 codepage 区别处理');
  provider.dispose();
  let decodes=0;
  const invalid=api.createFontProvider({decodeEot:async()=>{decodes++;return new Uint8Array([0,1,0,0]);}});
  assert.equal((await invalid.register({...source,bytes:compressed},options)).reason,'invalid-font','注入解码器也必须重新验证 sfnt');
  new DataView(compressed.buffer).setUint16(32,2,true);
  assert.equal((await invalid.register({...source,bytes:compressed},options)).reason,'embedding-restricted');
  assert.equal(decodes,1,'在调用重型解码器之前拒绝外层受限字体');
  invalid.dispose();
}
