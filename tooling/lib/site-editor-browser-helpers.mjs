export async function openFixture({ evaluate, waitFor }, url, name) {
  await evaluate(`(async () => {
    window.confirm = () => true;
    const bytes = await fetch(${JSON.stringify(url)}).then((response) => response.arrayBuffer());
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${JSON.stringify(name)}, {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }));
    const input = document.querySelector('#fileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor(`document.querySelector('#fileName')?.textContent === ${JSON.stringify(name)}
    && !document.querySelector('#editorApp')?.dataset.loading`, `${name} 就绪`);
}

export async function selectPaneObject({ evaluate, waitFor }, name) {
  await evaluate(`(() => {
    const row = [...document.querySelectorAll('[data-pane-element]')]
      .find((candidate) => candidate.querySelector('[data-pane-name]')?.textContent === ${JSON.stringify(name)});
    row?.click();
  })()`);
  await waitFor(`[...document.querySelectorAll('[data-pane-element]')].some((candidate) =>
    candidate.getAttribute('aria-selected') === 'true'
    && candidate.querySelector('[data-pane-name]')?.textContent === ${JSON.stringify(name)})`, `${name} 选中`);
}

export async function changeValue({ evaluate }, selector, value, event = 'change') {
  await evaluate(`(() => {
    const control = document.querySelector(${JSON.stringify(selector)});
    control.value = ${JSON.stringify(value)};
    control.dispatchEvent(new Event(${JSON.stringify(event)}, { bubbles: true }));
  })()`);
}

export async function saveAndReopen({ evaluate, waitFor, click }, name) {
  await evaluate('globalThis.__capturedDownload = null');
  await click('#saveFile');
  await waitFor('!!globalThis.__capturedDownload', `${name} 下载`);
  await evaluate(`(async () => {
    const captured = globalThis.__capturedDownload;
    const bytes = await fetch(captured.href).then((response) => response.arrayBuffer());
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${JSON.stringify(name)}, {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    }));
    const input = document.querySelector('#fileInput');
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
  await waitFor(`document.querySelector('#fileName')?.textContent === ${JSON.stringify(name)}
    && !document.querySelector('#editorApp')?.dataset.loading`, `${name} 重开`);
}
