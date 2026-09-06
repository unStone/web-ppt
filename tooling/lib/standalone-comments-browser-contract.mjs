export async function runStandaloneCommentsBrowserContract({ evaluate, request, waitFor, click }) {
  const upload = async (name) => {
    await evaluate(`(async () => {
      const bytes=await fetch('/fixtures/sample-editor-comments.pptx').then(r=>r.arrayBuffer());
      const files=new DataTransfer();files.items.add(new File([bytes],${JSON.stringify(name)}));
      const input=document.querySelector('#fileInput');input.files=files.files;input.dispatchEvent(new Event('change',{bubbles:true}));
    })()`, true);
    await waitFor(`document.querySelector('#fileInfo').textContent.includes(${JSON.stringify(name)})`, '独立查看器文稿');
  };
  await request('Page.navigate', { url: await evaluate("new URL('/standalone.html?file=/fixtures/sample-editor-comments.pptx', location.href).href") });
  await waitFor("document.querySelector('#fileInfo')?.textContent.includes('（内置示例）')", '独立查看器入口');
  await upload('comments.pptx');
  await click('#btnComments');
  await waitFor("document.querySelectorAll('#commentsPanel li').length === 2", '独立查看器批注');
  await click('#btnNext');
  await waitFor("document.querySelectorAll('#commentsPanel li').length === 1", '独立查看器批注切页');
  await click('#btnNext');
  await waitFor("document.querySelector('#commentsPanel [data-comments-empty]')?.hidden === false", '独立查看器空状态');
  await upload('replacement.pptx');
  if (await evaluate("!!document.querySelector('#commentsPanel')")) throw new Error('独立查看器替换文稿残留批注');
  console.log('  独立查看器批注、切页和文稿释放通过');
}
