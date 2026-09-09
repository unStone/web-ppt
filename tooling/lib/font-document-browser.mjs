const ensure=(condition,message)=>{if(!condition)throw new Error(message);};

export async function fontDocumentBrowserContract(){
  const html=await fetch('/packages/site/editor.html').then(response=>response.text());
  const parsed=new DOMParser().parseFromString(html,'text/html');
  for(const link of parsed.head.querySelectorAll('link[rel="canonical"],link[rel="alternate"]'))document.head.append(link.cloneNode(true));
  document.body.innerHTML=parsed.body.innerHTML;
  const [{createEditorApplication},{openEditor},adjustments,{createFontFaceScope},{inspectDocumentFonts}]=await Promise.all([
    import('../../packages/site/src/editor-application'),import('@web-ppt/editor'),import('@web-ppt/editor/adjustments'),
    import('@web-ppt/fonts/glyphs/browser'),
    import('../../packages/site/src/editor-font-diagnostics'),
  ]);
  let owner;
  const host={canvas:document.querySelector('#canvasMount'),objects:document.querySelector('#objectList'),textTools:[],onChange(){},
    tools:{snapshot:()=>({session:owner?.session??null,view:owner?.view??null,fonts:owner?.fonts,adjustments:owner?.adjustments??null,
      writable:true,name:'font-contract.pptx'}),showSlide(id){owner?.view.setSlide(id);},openInspector(){}}};
  const app=await createEditorApplication(host,()=>{}),results=[];
  const bytes=new Uint8Array(await fetch('/fixtures/sample-font-glyphs.pptx').then(response=>response.arrayBuffer()));
  let previous,readerLifetime;
  try{
    const plain=await openEditor(new Uint8Array(await fetch('/fixtures/sample-editor-text.pptx').then(response=>response.arrayBuffer())));
    owner=await app.replace(plain,{}, {adjustments},new AbortController().signal);
    ensure(!owner.fonts.state().loaded&&!owner.fonts.state().workerActive,'没有嵌入字体的文稿不能提前加载字体 Provider 或 Worker');
    previous=owner.fonts;
    for(let cycle=0;cycle<3;cycle++){
      const session=await openEditor(bytes,{embeddedFonts:'source'}),current=await app.replace(session,{}, {adjustments},new AbortController().signal);
      owner=current;app.tools.bindSession();
      const fonts=current.fonts;
      ensure(fonts&&fonts.state().loaded&&!fonts.state().workerActive,'嵌入字体应在画布挂载前检查，静态 TTF 不启动整形 Worker');
      ensure(fonts.state().installedFaces===4&&fonts.state().initialIssues===1,'默认打开必须只应用四个具有编辑许可的字体');
      if(previous){ensure(previous.state().disposed&&!previous.state().workerActive&&previous.state().retainedFontBytes===0,'替换文稿后旧服务资源应归零');}
      const embedded=await fonts.embedded({purpose:'edit'});
      ensure(embedded.length===5,'原始字体列表缺失');
      ensure(embedded.filter(item=>item.result.ok).length===4,'应注册四个可编辑 face');
      ensure(embedded.find(item=>!item.result.ok).result.reason==='preview-print-only','EOT 外层预览限制丢失');
      ensure(!fonts.state().workerActive,'静态 TTF 元数据注册不能启动 WASM');
      const provider=await fonts.provider();
      const originalResources=session.toPresentation().embeddedFonts;
      session.setFontResources([],{browserFontsReady:true});
      const scope=createFontFaceScope(provider),beforeFaces=new Set(document.fonts);let ownedFaces=[];
      try{
        const face=await scope.install('embedded-0',{purpose:'edit'});
        ensure(face.ok,`浏览器无法安装已验证的字体：${JSON.stringify(face)}`);
        ownedFaces=[...document.fonts].filter(face=>!beforeFaces.has(face));
        ensure(ownedFaces.length===1,'FontFace 未加入当前文稿的浏览器字体集');
        const denied=await scope.install('embedded-4',{purpose:'edit'});
        ensure(!denied.ok&&denied.reason==='preview-print-only','浏览器字体绑定绕过了 EOT 编辑限制');
        const canvas=document.createElement('canvas').getContext('2d');
        canvas.font=`100px "${face.value.family}"`;
        const canvasWidth=canvas.measureText('AV office ffi ﬃ').width;
        ensure(Math.abs(canvasWidth-669)<.1,`Canvas 未使用对应字体字节：cycle=${cycle}, width=${canvasWidth}, family=${face.value.family}`);
        const svg=current.view.element.querySelector('[data-ppt-static] svg')??current.view.element.querySelector('svg');
        const history=session.editor.history.undoCount;
        session.setFontResources(scope.resources(),{browserFontsReady:true});
        ensure(session.toPresentation().embeddedFonts[0].src===face.value.src,'导出投影未绑定字体资源');
        ensure(!current.view.element.querySelector('[data-ppt-layer="static"]').innerHTML.includes('@font-face'),'已有 FontFace 时不能重复注册 CSS 字体');
        ensure(!svg.isConnected,'字体资源变更未更新静态渲染');
        ensure(session.editor.history.undoCount===history,'字体加载不能写入编辑历史');
        const {slideToSvgFile,slideToPng}=await import('@web-ppt/core');
        const projection=session.toPresentation();
        const exported=await slideToSvgFile(projection,projection.slides[0]);
        ensure(exported.includes('data:font/ttf;base64,')&&!exported.includes('blob:'),'独立 SVG 没有内联带引号的字体资源 URL');
        ensure(!exported.includes('foreignObject')&&exported.includes('<text'),'独立 SVG 应保留原生文字路径');
        const png=await slideToPng(projection,projection.slides[0],1,{strictResources:true});
        ensure(png.type==='image/png'&&png.size>1000,'实际浏览器 PNG 导出失败');
        const textRecord=Object.values(session.editor.doc.elements).find(item=>item.src.kind==='shape'&&item.src.text?.paragraphs[0]?.runs[0]?.text==='AV office ffi ﬃ');
        current.view.element.querySelector(`[data-edit-id="${textRecord.id}"]`).dispatchEvent(new MouseEvent('dblclick',{bubbles:true,composed:true}));
        const editable=current.view.element.querySelector(`[data-ppt-text-editor="${textRecord.id}"]`);
        ensure(editable,'字体绑定验收没有进入文字编辑');
        const beforeText=editable.textContent;
        editable.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true,composed:true}));
        session.setFontResources(scope.resources(),{browserFontsReady:true});
        ensure(editable.isConnected&&editable.textContent===beforeText,'字体异步到达不能替换输入法正在组词的节点');
        editable.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,composed:true,data:''}));
        ensure(session.editor.history.undoCount===history,'字体重新排版不能创建文字编辑历史');
        session.editor.select({kind:'none'});
        const cancelled=new AbortController();cancelled.abort();
        ensure((await scope.install('embedded-1',{purpose:'edit',signal:cancelled.signal})).reason==='aborted','预先取消的字体不应安装');
      }finally{session.setFontResources(originalResources,{browserFontsReady:true});scope.dispose();scope.dispose();}
      ensure(ownedFaces.every(face=>!document.fonts.has(face))&&scope.state().sourceBytes===0,'字体作用域未释放 FontFace 或字节');
      const stale=await scope.install('embedded-0',{purpose:'edit'});
      ensure(!stale.ok&&stale.reason==='provider-disposed','字体作用域关闭后不能重新安装');
      const applied=await fonts.activate({});
      ensure(applied.filter(item=>item.result.ok).length===4&&fonts.activeFaces().length===4,'Cordis 服务未应用四个可编辑字体');
      ensure(fonts.state().installedFaces===4&&session.toPresentation().embeddedFonts.length===4,'画布与导出未共用已验证的字体资源');
      ensure(!fonts.state().workerActive,'安装静态 TTF 不应启动整形 Worker');
      const diagnosis=await inspectDocumentFonts(session,provider,fonts.activeFaces(),new AbortController().signal);
      ensure(diagnosis.issues.some(issue=>issue.failure.reason==='missing-glyphs'&&issue.failure.missing.some(item=>item.text==='😀'&&item.start===2&&item.end===4)),'缺字检查没有保留 emoji 的 UTF-16 区间');
      ensure(diagnosis.issues.some(issue=>issue.family==='WebPPT Glyph Preview'&&issue.failure.reason==='face-unavailable'),'未应用的预览字体应报告缺少可编辑字节');
      ensure(diagnosis.issues.some(issue=>issue.page===2&&issue.failure.reason==='unsupported-direction'),'段落 RTL 必须独立诊断');
      ensure(diagnosis.issues.filter(issue=>issue.page===2&&issue.failure.reason==='unsupported-layout').length===3,'竖排、艺术字和小型大写必须明确报告未支持');
      ensure(diagnosis.issues.some(issue=>issue.page===2&&issue.failure.reason==='unsupported-script'),'复杂脚本必须明确报告未支持');
      const localBytes=new Uint8Array(await fetch('/tooling/font-glyph-samples/latin.ttf').then(response=>response.arrayBuffer()));
      const local=await fonts.load({bytes:localBytes,origin:'substitute',family:'WebPPT Glyph Latin',sourceLabel:'explicit.ttf'},{});
      ensure(local.ok&&fonts.activeFaces().find(face=>face.family==='WebPPT Glyph Latin'&&face.weight===400).id===local.value.id,'显式替换没有取得所选家族的 regular face');
      await fonts.activate({});
      ensure(fonts.activeFaces().some(face=>face.id===local.value.id),'重复检查不能覆盖用户选定的替换字体');
      if(cycle===0){
        const {fontReplacementBrowserContract}=await import('./font-replacement-browser.mjs');
        await fontReplacementBrowserContract(fonts,provider,localBytes);
        const {fontReadBrowserContract}=await import('./font-read-browser.mjs');
        await fontReadBrowserContract(fonts,provider,localBytes);
        const {fontExportBrowserContract}=await import('./font-export-browser.mjs');
        await fontExportBrowserContract(app,session,fonts);
        const {fontInstallBrowserContract}=await import('./font-install-browser.mjs');
        await fontInstallBrowserContract(createFontFaceScope,provider);
        const {fontDiagnosticsBrowserContract}=await import('./font-diagnostics-browser.mjs');
        await fontDiagnosticsBrowserContract(session,provider,fonts.activeFaces(),inspectDocumentFonts);
        const {fontToolsBrowserContract}=await import('./font-tools-browser.mjs');
        await fontToolsBrowserContract(fonts,localBytes);
      }
      const shaped=await provider.shape('embedded-0','AV office ffi ﬃ',{purpose:'edit',script:'Latn',direction:'ltr',language:'en'});
      ensure(shaped.ok&&shaped.value.xAdvance===6690&&shaped.value.glyphs.length===11,`浏览器 Worker 没有完成真实 HarfBuzz 整形：${JSON.stringify(shaped)}`);
      ensure(fonts.state().workerActive,'整形必须发生在文稿独占 Worker');
      results.push({cycle,state:fonts.state(),glyphs:shaped.value.glyphs.length,advance:shaped.value.xAdvance});previous=fonts;
    }
    const {fontCloseReadBrowserContract}=await import('./font-read-browser.mjs');
    readerLifetime=await fontCloseReadBrowserContract(app,owner.session,previous);
  }finally{await app.dispose();}
  await new Promise(resolve=>setTimeout(resolve,30));
  ensure(!document.querySelector('#fontDialog'),'应用卸载后不能弹出迟到的字体对话框');
  ensure(previous.state().disposed&&!previous.state().workerActive&&previous.state().retainedFontBytes===0,'应用关闭后字体 Worker 未释放');
  let rejected=false;try{await previous.provider();}catch(error){rejected=error.name==='AbortError';}
  ensure(rejected,'已关闭的文稿服务不能复活');
  const {fontInitializationBrowserContract}=await import('./font-initialization-browser.mjs');
  const cancelled=await fontInitializationBrowserContract({createEditorApplication,openEditor,adjustments,bytes,host});
  const {vectorPdfExportLifetimeBrowser}=await import('./vector-pdf-export-lifetime-browser.mjs');
  const vectorExports=await vectorPdfExportLifetimeBrowser({createEditorApplication,openEditor,adjustments,host});
  return {cycles:results,closed:previous.state(),cancelled,readerLifetime,vectorExports};
}
