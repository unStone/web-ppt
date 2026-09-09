const ensure=(condition,message)=>{if(!condition)throw new Error(message);};

export async function fontDiagnosticsBrowserContract(session,provider,faces,inspect){
  const original=session.editor.toSlide.bind(session.editor);
  let scenario='caps';
  // 保留真实会话与 Provider；只把诊断输入接缝换成含换行和大小写展开的投影。
  session.editor.toSlide=id=>{
    const slide=original(id),source=slide.elements.find(element=>element.kind==='shape'&&element.text);
    const run=source.text.paragraphs[0].runs[0];
    const generated=scenario==='bullet'?{...run,text:'',b:true,i:true,caps:'small'}:scenario==='budget'?{
      ...run,text:'A中'.repeat(1000),fonts:['Unavailable'],editInfo:undefined,
    }:{...run,text:'v\nv\t😀',caps:'all',fonts:['WebPPT Glyph Chinese'],
      editInfo:{...run.editInfo,fontSlots:{latin:'WebPPT Glyph Latin',eastAsian:'WebPPT Glyph Chinese'}}};
    return {...slide,elements:[{...source,name:'diagnostic-projection',text:{...source.text,paragraphs:[{
      ...source.text.paragraphs[0],rtl:false,bullet:scenario==='bullet'?'A':undefined,bulletFont:'WebPPT Glyph Latin',runs:[generated],
    }]}}]};
  };
  try{
    const report=await inspect(session,provider,faces,new AbortController().signal);
    ensure(report.issues.length===session.editor.doc.slideOrder.length,'大小写转换或换行产生了额外诊断');
    for(const issue of report.issues){
      ensure(issue.family==='WebPPT Glyph Latin','诊断没有使用当前投影的字体槽');
      ensure(issue.failure.reason==='missing-glyphs','换行和制表不应当作字体控制符失败');
      ensure(issue.failure.missing.length===1&&issue.failure.missing[0].text==='😀'&&
        issue.failure.missing[0].start===4&&issue.failure.missing[0].end===6,`全大写与换行后的缺字丢失源 UTF-16 位置：${JSON.stringify(issue)}`);
    }
    scenario='bullet';
    ensure((await inspect(session,provider,faces,new AbortController().signal)).issues.length===0,'项目符号不能继承正文粗斜体或小型大写');
    scenario='budget';
    const limited=await inspect(session,provider,faces,new AbortController().signal);
    ensure(limited.issues.length===500&&limited.issues.at(-1).failure.reason==='resource-limit','单个 run 的字体分段不能绕过问题列表预算');
  }finally{session.editor.toSlide=original;}
}
