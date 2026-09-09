import {fontSample} from './font-glyph-samples.mjs';

function replaceTable(tableName,replacement){
  const bytes=fontSample('latin.ttf'),view=new DataView(bytes.buffer),count=view.getUint16(4),tables=[];
  for(let index=0;index<count;index++){
    const at=12+index*16,tag=new TextDecoder().decode(bytes.subarray(at,at+4));
    tables.push({at,data:tag===tableName?replacement:bytes.slice(view.getUint32(at+8),view.getUint32(at+8)+view.getUint32(at+12))});
  }
  const align=value=>(value+3)&~3,header=12+count*16;
  const output=new Uint8Array(header+tables.reduce((size,table)=>size+align(table.data.length),0));
  output.set(bytes.subarray(0,header));const result=new DataView(output.buffer);let offset=header;
  for(const {at,data} of tables){output.set(data,offset);result.setUint32(at+8,offset);result.setUint32(at+12,data.length);offset+=align(data.length);}
  return output;
}

export async function fontInputBudgetContract(api,assert){
  const options={purpose:'edit'},source={id:'budget',origin:'explicit'};
  const tooMany=new Uint8Array(4+257*8+32);new DataView(tooMany.buffer).setUint16(2,257);
  const provider=api.createFontProvider();
  try{
    assert.equal((await provider.register({...source,bytes:replaceTable('cmap',tooMany)},options)).reason,'resource-limit','cmap 记录预算不能交给后续整形器');
    const entries=0x110000,subLength=20+entries*2,cmap=new Uint8Array(20+subLength*2),view=new DataView(cmap.buffer);
    view.setUint16(2,2);
    for(let index=0;index<2;index++){
      const record=4+index*8,start=20+subLength*index;
      view.setUint16(record,3);view.setUint16(record+2,10);view.setUint32(record+4,start);
      view.setUint16(start,10);view.setUint32(start+4,subLength);view.setUint32(start+16,entries);
    }
    assert.equal((await provider.register({...source,bytes:replaceTable('cmap',cmap)},options)).reason,'resource-limit','多张大 cmap 累计映射预算不能分别绕过');
    assert.equal(provider.state().reservedFontBytes,0,'失败的 cmap 校验归还全部注册预留');
    const language=new Uint8Array(40),lang=new DataView(language.buffer);
    lang.setUint16(2,1);lang.setUint16(4,3);lang.setUint16(6,10);lang.setUint32(8,12);
    lang.setUint16(12,12);lang.setUint32(16,28);lang.setUint32(20,0xb6c00000);
    lang.setUint32(24,1);lang.setUint32(28,65);lang.setUint32(32,65);lang.setUint32(36,1);
    assert.equal((await provider.register({...source,bytes:replaceTable('cmap',language)},options)).reason,'invalid-font','Windows / Unicode cmap 的非零 language 必须在 FontFace / HarfBuzz 前拒绝');
    for(const count of [2048,300]){
      const start=6+count*12,name=new Uint8Array(start+512),data=new DataView(name.buffer);
      data.setUint16(2,count);data.setUint16(4,start);
      for(let index=0;index<count;index++){
        const at=6+index*12;data.setUint16(at,3);data.setUint16(at+6,1);data.setUint16(at+8,512);
      }
      for(let offset=start;offset<name.length;offset+=2)data.setUint16(offset,65);
      assert.equal((await provider.register({...source,bytes:replaceTable('name',name)},options)).reason,'resource-limit','重复名称记录不能通过共享字节绕过同步解码预算');
    }
  }finally{provider.dispose();}
  const glyphs=api.createFontProvider({limits:{maxGlyphs:100}});
  try{assert.equal((await glyphs.register({...source,bytes:fontSample('latin.ttf')},options)).reason,'resource-limit','调用方字形数量预算生效');}
  finally{glyphs.dispose();}
}
