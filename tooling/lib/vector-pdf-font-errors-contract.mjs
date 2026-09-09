import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';

export async function vectorPdfFontErrorsContract(api,fonts,out){
  const pres=await api.parse(new Uint8Array(readFileSync('fixtures/sample-vector-pdf-font-errors.pptx')));
  const issues=[],options={fonts,skipHidden:true};
  const failure=async (expected,presentation=pres,overrides={})=>{
    const progress=[];
    await assert.rejects(()=>api.presentationToVectorPdf(presentation,{...options,...overrides,onProgress:p=>progress.push(p)}),error=>{
      assert(error instanceof api.VectorPdfError);
      assert.deepEqual(error.issue,expected);issues.push(error.issue);return true;
    });
    assert.deepEqual(progress,[]);
  };
  try{
    const group=pres.slides[1].elements[1],child=group.children[0],run=child.text.paragraphs[0].runs[0];
    // 测试字体缺失来自公开注册表，缺字来自真实 HarfBuzz；两条失败路径不使用替身。
    run.fonts=['Unavailable PDF Font'];
    await failure({slideNumber:2,elementId:child.id,reason:'face-unavailable',fontFamilies:run.fonts,text:'ABC'});
    run.fonts=['WebPPT Glyph Latin','Unavailable PDF Font'];run.text='Ā';
    await failure({slideNumber:2,elementId:child.id,reason:'missing-glyphs',fontFamilies:run.fonts,text:'Ā'});
    const anonymous={...pres,slides:[pres.slides[0],{...pres.slides[1],elements:[pres.slides[1].elements[0],
      {...group,id:undefined,children:[{...child,id:undefined}]}]}]};
    await failure({slideNumber:2,elementPath:[1,0],reason:'missing-glyphs',fontFamilies:run.fonts,text:'Ā'},anonymous);
    assert.equal(anonymous.slides[1].elements[1].children[0].id,undefined);
    run.text='A'.repeat(79)+'😀';
    await failure({slideNumber:2,elementId:child.id,reason:'missing-glyphs',fontFamilies:run.fonts,text:'A'.repeat(79)});
    run.text='Ω';
    await failure({slideNumber:2,elementId:child.id,reason:'unsupported-script',fontFamilies:run.fonts,text:'Ω'});
    run.fonts=['Unavailable PDF Font','WebPPT Glyph Latin'];run.text='ABC';
    const groupOnly={...pres,slides:[pres.slides[0],{...pres.slides[1],elements:[group]}]};
    // 宿主可在公开端口控制字体嵌入权限；仍复用真实 Provider 的解析与整形。
    const guarded={...fonts,provider:{resolve:(...args)=>fonts.provider.resolve(...args),shape:(...args)=>fonts.provider.shape(...args),
      embedding:async()=>({ok:false,reason:'embedding-restricted'})}};
    await failure({slideNumber:2,elementId:child.id,reason:'embedding-restricted',fontFamilies:['WebPPT Glyph Latin'],text:'ABC'},groupOnly,{fonts:guarded});
    const controller=new AbortController(),progress=[];
    await assert.rejects(()=>api.presentationToVectorPdf(groupOnly,{...options,signal:controller.signal,onProgress:p=>progress.push(p),
      fonts:{...guarded,provider:{...guarded.provider,embedding:async(...args)=>{
        const result=await fonts.provider.embedding(...args);controller.abort();return result;
      }}}}),{name:'AbortError'});
    assert.deepEqual(progress,[]);
    const retry=await api.presentationToVectorPdf(pres,options);
    assert.deepEqual(retry.issues,[]);assert(retry.blob.size>1000);
    assert.equal(fonts.provider.state().faces,2);
    writeFileSync(resolve(out,'font-errors.json'),JSON.stringify(issues,null,2)+'\n');
    console.log('字体诊断：缺字体、真实缺字、嵌入拒绝、原始对象定位、片段边界、取消及 Provider 重试通过');
  }finally{pres.dispose();}
}
