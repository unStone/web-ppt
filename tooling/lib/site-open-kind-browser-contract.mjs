import { zipSync } from 'fflate';

function officeZip(contentType) {
  return zipSync({
    '[Content_Types].xml': new TextEncoder().encode(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
      + `<Override PartName="/doc.xml" ContentType="${contentType}"/></Types>`,
    ),
  });
}

export async function runViewerOpenKindContract({ evaluate, click, waitFor, request }) {
  await evaluate(`document.querySelector('#demoRoot')?.scrollIntoView({ block: 'start', behavior: 'instant' })`);
  // 失败契约刚把舞台留在认错态，这里必须先铺回真稿，才能证明 PDF 拆掉的是幻灯片而不是错误页。
  await evaluate(`(async () => {
    const bytes = await fetch('demo/showcase.pptx').then((r) => r.arrayBuffer());
    const files = new DataTransfer(); files.items.add(new File([bytes], 'before-kind.pptx'));
    const input = document.querySelector('#pick'); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor("document.querySelector('#stage svg') && document.querySelector('#meta').textContent.includes('before-kind.pptx')", '认文件前先有一份文稿');

  const drop = (bytes, name) => evaluate(`(() => {
    const files = new DataTransfer();
    files.items.add(new File([Uint8Array.from(${JSON.stringify([...bytes])})], ${JSON.stringify(name)}));
    const input = document.querySelector('#pick');
    input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);

  await drop(new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF'), 'notes.pdf');
  await waitFor("document.querySelector('#stage .err')?.textContent.includes('这是 PDF')", 'PDF 立刻说人话');
  if (await evaluate("document.querySelector('#stage svg') || document.querySelector('#stage')?.dataset.openPhase === 'parsing'")) {
    throw new Error('PDF 仍进入了解析或留下了旧页');
  }
  if (!await evaluate("document.querySelector('#present').disabled && document.querySelector('#pager').textContent === '— / —'")) {
    throw new Error('认错后演示仍可用或页码不是空态');
  }
  const g = { key: 'g', code: 'KeyG', windowsVirtualKeyCode: 71, nativeVirtualKeyCode: 71 };
  await Promise.all([
    request('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...g }),
    request('Input.dispatchKeyEvent', { type: 'keyUp', ...g }),
  ]);
  if (await evaluate("document.querySelector('.slide-grid:not([hidden])')")) {
    throw new Error('认错后 G 制造了网格');
  }

  await drop(officeZip('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml'), 'essay.docx');
  await waitFor("document.querySelector('#stage .err')?.textContent.includes('这是 Word')", 'Word 压缩包说人话');
  if (await evaluate("document.querySelector('#stage')?.dataset.openPhase === 'parsing'")) {
    throw new Error('Word 进入了解析中');
  }

  await drop(new Uint8Array(), 'empty.pptx');
  await waitFor("document.querySelector('#stage .err')?.textContent.includes('空文件')", '空文件说人话');

  await evaluate(`(async () => {
    const bytes = await fetch('demo/showcase.pptx').then((r) => r.arrayBuffer());
    const files = new DataTransfer(); files.items.add(new File([bytes], 'after-reject.pptx'));
    const input = document.querySelector('#pick'); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor("document.querySelector('#stage svg') && document.querySelector('#meta').textContent.includes('after-reject.pptx')", '认错后再打开真稿');
  if (!await evaluate("document.querySelector('#present').disabled === false")) {
    throw new Error('真稿打开后演示仍不可用');
  }
  console.log('  官网认文件通过');
}
