const ensure=(condition,message)=>{if(!condition)throw new Error(message);};
const until=async check=>{for(let i=0;i<1000;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw new Error('字体工具状态超时');};

export async function fontToolsBrowserContract(fonts,bytes){
  const runtime=await import('../../packages/site/src/i18n/runtime');await runtime.languageReady;
  const toolbar=document.querySelector('#fontTools');toolbar.disabled=false;toolbar.click();
  await until(()=>document.querySelector('#fontDialog')&&!document.querySelector('#checkFonts').disabled);
  const dialog=document.querySelector('#fontDialog');
  ensure(!dialog.querySelector('#fontError').textContent,'字体检查不应意外报错');
  ensure(dialog.querySelector('#fontIssues').textContent.includes('😀'),'对话框未显示缺失的字符');
  const english=dialog.querySelector('[data-site-locale="en"]');
  english.click();await until(()=>dialog.querySelector('#fontDialogTitle').textContent==='Fonts and missing glyphs');
  ensure(dialog.querySelector('#embeddedFontStatus').textContent.includes('preview and printing'),'字体许可失败未提供英文原因');
  ensure(dialog.querySelector('#fontIssues').textContent.includes('right-to-left'),'RTL 未提供英文原因');
  const file=dialog.querySelector('#fontFile'),form=dialog.querySelector('#fontFileForm');
  const choose=value=>{const transfer=new DataTransfer();transfer.items.add(value);file.files=transfer.files;};
  choose(new File([new Uint8Array([0,1,2,3])],'broken.ttf',{type:'font/ttf'}));
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>!dialog.querySelector('#applyFontFile').disabled);
  ensure(dialog.querySelector('#fontError').textContent.includes('invalid or unsupported'),'损坏字体没有可理解的错误');
  choose(new File([bytes],'chosen-latin.ttf',{type:'font/ttf'}));
  dialog.querySelector('#fontFamily').value='WebPPT Glyph Preview';
  form.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));
  await until(()=>!dialog.querySelector('#applyFontFile').disabled);
  ensure(!dialog.querySelector('#fontError').textContent,'用户指定的合法替换字体未能应用');
  ensure(fonts.activeFaces().some(face=>face.family==='WebPPT Glyph Preview'&&face.sourceLabel==='chosen-latin.ttf'&&face.origin==='substitute'),'本机字体没有按明确的替换家族绑定');
  ensure(dialog.querySelector('#fontScopeHint').textContent.includes('not written to the PPTX'),'本机字体的保存范围必须明确');
  dialog.querySelector('[data-site-locale="zh-CN"]').click();
  await until(()=>dialog.querySelector('#fontDialogTitle').textContent==='字体与缺字');
  ensure(dialog.querySelector('#fontIssues').textContent.includes('暂不支持'),'动态检查结果切回中文失败');
  dialog.querySelector('#closeFontDialog').click();
  ensure(!dialog.isConnected&&document.querySelector('#siteLanguage'),'关闭字体对话框没有归还语言入口');
}
