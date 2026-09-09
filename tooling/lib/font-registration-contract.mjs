import {fontSample} from './font-glyph-samples.mjs';

export async function fontRegistrationContract(api,assert){
  const bytes=fontSample('latin.ttf'),source={id:'face',origin:'explicit',bytes},options={purpose:'edit'};
  const provider=api.createFontProvider({limits:{maxTotalFontBytes:bytes.length,maxFaces:1}});
  const controller=new AbortController();
  const canceled=provider.register(source,{...options,signal:controller.signal});
  controller.abort();
  assert.equal((await canceled).reason,'aborted','调用者能取消尚未提交的字体注册');
  assert.equal(provider.state().retainedFontBytes,0,'取消不会提交半成品字体');
  const pending=provider.register(source,options);
  assert.equal((await provider.register({...source,id:'overflow'},options)).reason,'resource-limit','并发注册也计算预留预算');
  assert.equal((await pending).ok,true,'取消归还预算后可注册完整字体');
  provider.dispose();
  const closing=api.createFontProvider(),late=closing.register(source,options);
  closing.dispose();
  assert.equal((await late).reason,'provider-disposed','关闭后的校验结果不能重新占有字节');
  assert.equal(closing.state().retainedFontBytes,0);
  const formats=api.createFontProvider();
  for(const [name,reason] of [['latin.woff','needs-container-decoder'],['latin.woff2','needs-container-decoder'],
    ['collection.ttc','collection-not-supported'],['variable.ttf','variable-not-supported'],['cff.otf','cff-not-supported']]){
    assert.equal((await formats.register({...source,id:name,bytes:fontSample(name)},options)).reason,reason,name);
  }
  formats.dispose();
  const direct=api.createFontProvider(),coincidence=fontSample('latin.ttf');
  coincidence[34]=0x4c;coincidence[35]=0x50;
  assert.equal((await direct.register({...source,bytes:coincidence},options)).ok,true,'sfnt 头魔数优先，目录校验和碰巧包含 EOT 魔数不能改变格式识别');
  direct.dispose();
}
