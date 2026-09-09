import {fontSample} from './font-glyph-samples.mjs';

export async function fontWorkerResultContract(api,assert){
  let response;
  const listeners=new Set();
  // 模拟传输对端的错误载荷；整形算法本身仍由 Provider 的公开输出规则验证。
  const adapter=api.createWorkerFontShaper(()=>({
    postMessage(message){queueMicrotask(()=>{
      const result={ok:true,value:message.operation==='register'?{}:response};
      for(const listener of listeners)listener({data:{protocol:message.protocol,id:message.id,result}});
    });},
    addEventListener(type,listener){if(type==='message')listeners.add(listener);},
    removeEventListener(type,listener){if(type==='message')listeners.delete(listener);},
    terminate(){listeners.clear();},
  }));
  const provider=api.createFontProvider({loadShaper:async()=>adapter});
  const options={purpose:'edit',script:'Latn',direction:'ltr',language:'en'};
  try{
    await provider.register({id:'latin',origin:'explicit',bytes:fontSample('latin.ttf')},options);
    const valid={faceId:'latin',text:'A',script:'Latn',direction:'ltr',language:'en',unitsPerEm:1000,xAdvance:100,yAdvance:0,
      glyphs:[{id:1,xAdvance:100,yAdvance:0,xOffset:0,yOffset:0}],clusters:[{start:0,end:1,text:'A',glyphStart:0,glyphEnd:1}]};
    for(const change of [run=>{run.clusters[0].glyphEnd=Infinity;},run=>{run.clusters[0].glyphEnd=100000000;},
      run=>{run.clusters[0].glyphStart=-1;},run=>{run.clusters[0].text='B';},run=>{run.faceId='another';},
      run=>{run.glyphs[0].id=99999;},run=>{run.xAdvance=123;},run=>{run.clusters=[];}]){
      response=structuredClone(valid);change(response);
      assert.equal((await provider.shape('latin','A',options)).reason,'shaper-failed','外部 Worker 非法簇/字体/字形/宽度不能绕过输出边界');
    }
    response=valid;
    assert.equal((await provider.shape('latin','A',options)).value.xAdvance,100,'非法传输结果不会污染后续请求');
  }finally{provider.dispose();adapter.dispose();}
}
