import { zipSync } from 'fflate';

function officeZip(contentType) {
  return zipSync({
    '[Content_Types].xml': new TextEncoder().encode(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Override PartName="/doc.xml" ContentType="${contentType}"/></Types>`,
    ),
  });
}

export async function runStandaloneOpenKindContract({ evaluate, request, waitFor }) {
  const standalone = (query = '') => evaluate(`new URL(${JSON.stringify(query ? `/standalone.html?${query}` : '/standalone.html')}, location.href).href`);
  const pressG = async () => {
    const key = { key: 'g', code: 'KeyG', windowsVirtualKeyCode: 71, nativeVirtualKeyCode: 71 };
    await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...key });
    await request('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
  };
  const openLocal = (bytes, name) => evaluate(`(() => {
    const file = new File([Uint8Array.from(${JSON.stringify([...bytes])})], ${JSON.stringify(name)});
    const input = document.querySelector('#fileInput');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  await request('Page.navigate', { url: await standalone('file=/demo/showcase.pptx&p=2') });
  await waitFor(
    "document.querySelector('#fileInfo')?.textContent.includes('showcase.pptx') && document.querySelector('#pageIndicator')?.textContent === '2 / 7'",
    '认文件前远程第 2 页',
  );

  const pdf = new TextEncoder().encode('%PDF-1.4\ntrailer\n%%EOF');
  await openLocal(pdf, 'deck.pdf');
  await waitFor("document.querySelector('#stage')?.dataset.openPhase === 'error' && document.querySelector('.open-status-label')?.textContent.includes('这是 PDF')", '独立查看器本地 PDF');
  if (String(await evaluate('location.search')).includes('file=')) {
    throw new Error('本地拖 PDF 后地址还指着远程 file');
  }
  if (await evaluate("document.querySelector('#stage svg')")) throw new Error('本地 PDF 仍留下幻灯片');
  await pressG();
  if (await evaluate("document.querySelector('.slide-grid:not([hidden])')")) throw new Error('认错后 G 造了网格');

  await request('Page.navigate', { url: await standalone('file=/missing-notes.pdf&p=3') });
  await waitFor("document.querySelector('#stage')?.dataset.openPhase === 'error' && document.querySelector('.open-status-label')?.textContent.includes('这是 PDF')", '远程 PDF 认错');
  const search = String(await evaluate('location.search'));
  if (!search.includes('file=') || !search.includes('p=3')) {
    throw new Error('远程 PDF 失败后删掉了人家写进来的 file/p');
  }

  await openLocal(officeZip('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'), 'notes.docx');
  await waitFor("document.querySelector('.open-status-label')?.textContent.includes('这是 Word')", '独立查看器 Word');
  if (String(await evaluate('location.search')).includes('file=')) {
    throw new Error('本地 Word 失败后地址还指着远程 file');
  }

  console.log('  独立查看器认文件通过');
}
