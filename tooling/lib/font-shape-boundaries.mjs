import {fontSample} from './font-glyph-samples.mjs';

/** 整形器是可注入边界；错误结果不能成为可交付的定位字形。 */
export async function fontShapeBoundaryContract(api,assert){
  const glyph={id:1,cluster:0,xAdvance:500,yAdvance:0,xOffset:0,yOffset:0};
  const options={purpose:'edit',script:'Latn',direction:'ltr',language:'en'};
  let raw=[glyph],path='M0 0L1 1',destroyed=0;
  const provider=api.createFontProvider({loadShaper:async()=>({
    open:async()=>({shape:async()=>raw,outline:async()=>path,dispose(){}}),dispose(){destroyed++;},
  })});
  await provider.register({id:'latin',origin:'explicit',bytes:fontSample('latin.ttf')},{purpose:'edit'});
  try{
    for(const [text,value,reason] of [
      ['A',[],'shaper-failed'],['A',[{...glyph,id:65535}],'shaper-failed'],
      ['A',[{...glyph,xAdvance:Infinity}],'shaper-failed'],['A',[{...glyph,xOffset:1e10}],'shaper-failed'],
      ['ABC',[glyph,{...glyph,cluster:2},{...glyph,cluster:1}],'shaper-failed'],
      ['😀',[glyph,{...glyph,cluster:1}],'shaper-failed'],
      ['A',Array.from({length:257},()=>glyph),'resource-limit'],
    ]){
      raw=value;assert.equal((await provider.shape('latin',text,options)).reason,reason,'非法 GID、数值、簇边界与数量返回失败');
    }
    raw=[glyph];
    assert.equal((await provider.shape('latin','A',options)).ok,true,'异常结果不污染后续合法请求');
    path='<script/>';
    assert.equal((await provider.outline('latin',1,{purpose:'edit'})).reason,'shaper-failed','轮廓只允许 SVG path 数据');
    path='M0 0'.repeat(1_000_001);
    assert.equal((await provider.outline('latin',1,{purpose:'edit'})).reason,'resource-limit');
  }finally{provider.dispose();provider.dispose();}
  assert.equal(destroyed,1,'自定义整形器只关闭一次');
  let lateLoads=0;
  const cold=api.createFontProvider({loadShaper:async()=>{lateLoads++;return {open:async()=>({shape:async()=>[glyph],outline:async()=>'',dispose(){}}),dispose(){}};}});
  await cold.register({id:'latin',origin:'explicit',bytes:fontSample('latin.ttf')},{purpose:'edit'});
  const late=cold.shape('latin','A',options);cold.dispose();
  assert.equal((await late).reason,'provider-disposed');
  assert.equal(lateLoads,0,'关闭后不能开始尚未调用的整形器加载');
}
