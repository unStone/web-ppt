import { zipSync } from 'fflate';

function officeZip(contentType) {
  return zipSync({
    '[Content_Types].xml': new TextEncoder().encode(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Override PartName="/doc.xml" ContentType="${contentType}"/></Types>`,
    ),
  });
}

export async function runSiteEditorOpenKindContract({ evaluate, waitFor, click }) {
  await evaluate(`globalThis.__editorKindCanvas = document.querySelector('#canvasMount').firstElementChild`);
  const drop = (bytes, name) => evaluate(`(() => {
    const files = new DataTransfer();
    files.items.add(new File([Uint8Array.from(${JSON.stringify([...bytes])})], ${JSON.stringify(name)}));
    const input = document.querySelector('#fileInput');
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  const kept = () => evaluate(`globalThis.__editorKindCanvas === document.querySelector('#canvasMount').firstElementChild
    && document.querySelector('#fileName').textContent.includes('showcase.pptx')
    && !document.querySelector('#editorApp').dataset.loading
    && !document.querySelector('#addShape').disabled`);

  await drop(new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF'), 'notes.pdf');
  await waitFor("document.querySelector('#statusText').textContent.includes('这是 PDF')", '编辑器 PDF 人话');
  if (!await kept()) throw new Error('PDF 拆掉了现有文稿或禁用了编辑');

  await drop(officeZip('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'), 'essay.docx');
  await waitFor("document.querySelector('#statusText').textContent.includes('这是 Word')", '编辑器 Word 人话');
  if (!await kept()) throw new Error('Word 拆掉了现有文稿');
  if (await evaluate("document.querySelector('#statusText').textContent.includes('presentation.xml')")) {
    throw new Error('Word 仍走到了解析器行话');
  }

  await drop(new Uint8Array(), 'empty.pptx');
  await waitFor("document.querySelector('#statusText').textContent.includes('空文件')", '编辑器空文件人话');
  if (!await kept()) throw new Error('空文件拆掉了现有文稿');

  await evaluate(`(() => {
    const input = document.querySelector('#fileInput');
    input.value = '';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  if (!await kept() || !await evaluate("document.querySelector('#statusText').textContent.includes('空文件')")) {
    throw new Error('空选择改变了文稿或清掉了上一次认错');
  }

  await evaluate(`(async () => {
    const bytes = await fetch('/demo/showcase.pptx').then((r) => r.arrayBuffer());
    const files = new DataTransfer();
    files.items.add(new File([bytes], 'showcase.pptx'));
    const input = document.querySelector('#fileInput');
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  const ready = "document.querySelector('#fileName').textContent === 'showcase.pptx' && !document.querySelector('#editorApp').dataset.loading";
  await waitFor(`(${ready}) || document.querySelector('#recoveryPrompt')?.hidden === false`, '真稿或恢复选择');
  if (await evaluate("document.querySelector('#recoveryPrompt')?.hidden === false")) await click('#discardRecovery');
  await waitFor(ready, '认错后再打开真稿');
  if (!await evaluate("document.querySelector('#canvasMount').firstElementChild && !document.querySelector('#addShape').disabled")) {
    throw new Error('真稿打开后不能编辑');
  }
  console.log('  编辑器认文件通过');
}
