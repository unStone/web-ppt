import assert from 'node:assert/strict';
import {createServer} from 'node:http';

const within=async promise=>{
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('图片读取连接未收口')),3000);})]);}
  finally{clearTimeout(timer);}
};

/** 在实际 HTTP 字节流边界验证取消，不替换写入器或图片加载器。 */
export async function vectorPdfImageLifetimeContract(api,pres,fonts,{options={},issues=[]}={}){
  let started;
  const server=createServer((_request,response)=>{
    const closed=new Promise(resolve=>response.once('close',resolve));
    response.writeHead(200,{'Content-Type':'image/png',...(_request.url==='/huge'?{'Content-Length':String(32*1024*1024+1)}:{})});
    response.write(Buffer.from([137,80,78,71,13,10,26,10]));
    started(closed);
  });
  let image;
  try{
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const address=server.address(),base=`http://127.0.0.1:${address.port}`;
    image=pres.slides[0].elements.find(el=>el.kind==='image');
    const original=image.src,onePage={...pres,slides:[pres.slides[0]]};
    try{
      let begin=new Promise(resolve=>{started=closed=>resolve({closed});});
      const controller=new AbortController();image.src=base+'/slow';
      const rejected=assert.rejects(api.presentationToVectorPdf(onePage,{...options,fonts,signal:controller.signal}),{name:'AbortError'});
      const {closed}=await within(begin);controller.abort();await rejected;await within(closed);
      begin=new Promise(resolve=>{started=closed=>resolve({closed});});image.src=base+'/huge';
      const oversized=assert.rejects(api.presentationToVectorPdf(onePage,{...options,fonts}),error=>{
        assert(error instanceof api.VectorPdfError);assert.equal(error.issue.reason,'image-byte-limit');return true;
      });
      const huge=await within(begin);await oversized;await within(huge.closed);
      image.src=original;
      const retry=await api.presentationToVectorPdf(onePage,{...options,fonts});
      assert.equal(retry.blob.type,'application/pdf');assert.deepEqual(retry.issues,issues);
    }finally{image.src=original;}
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  console.log('矢量 PDF 图片：实际流读取取消、超限响应关闭及同一文稿重试通过');
}
