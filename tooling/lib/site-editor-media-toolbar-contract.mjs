import { changeValue, openFixture, saveAndReopen, selectPaneObject } from './site-editor-browser-helpers.mjs';

const selectedPoster = `(() => {
  const row = [...document.querySelectorAll('[data-pane-element]')].find((node) => node.getAttribute('aria-selected') === 'true');
  const image = row && document.querySelector('[data-edit-id="' + CSS.escape(row.dataset.paneElement) + '"] image');
  return image?.getAttribute('href') || image?.getAttribute('xlink:href');
})()`;

async function upload({ evaluate }, selector, url, mime, name = 'media-fixture') {
  await evaluate(`(async () => {
    const bytes = await fetch(${JSON.stringify(url)}).then((response) => response.arrayBuffer());
    const transfer = new DataTransfer();
    transfer.items.add(new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} }));
    const input = document.querySelector(${JSON.stringify(selector)});
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
}

export async function runSiteEditorMediaToolbarContract(context) {
  const { evaluate, waitFor, click, request } = context;
  if (await evaluate(`performance.getEntriesByType('resource').some((entry) =>
    ${JSON.stringify(context.lazyMediaUrls)}.includes(new URL(entry.name).pathname))`)) {
    throw new Error('普通形状/文字编辑和恢复不能加载媒体能力');
  }
  await openFixture(context, '/fixtures/sample-editor-add-media.pptx', 'media-tools.pptx');
  await click('#mediaTools');
  await waitFor("document.querySelector('#mediaDialog')?.open", '按需媒体对话框');
  await upload(context, '#mediaFile', '/fixtures/sample-editor-media.wav', 'audio/wav');
  await click('#insertMedia');
  await waitFor("document.querySelector('#statusText').textContent === '已插入音频'", '默认图标音频插入');
  if (!await evaluate("document.querySelector('#imageInspector').hidden")) {
    throw new Error('媒体只能编辑海报，不能进入普通图片裁剪面板');
  }
  const count = await evaluate("document.querySelectorAll('[data-pane-element]').length");
  await click('#undo');
  await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${count - 1}`, '媒体插入撤销');
  await click('#redo');
  await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${count}`, '媒体插入重做');
  await waitFor("document.querySelector('#recoveryState').textContent === '恢复记录已写入本机'", '音频日志落盘');
  await request('Page.reload');
  await waitFor("document.querySelector('#fileName')?.textContent === 'showcase.pptx' && !document.querySelector('#editorApp')?.dataset.loading", '刷新后的新会话');
  await upload(context, '#fileInput', '/fixtures/sample-editor-add-media.pptx', 'application/octet-stream', 'media-tools.pptx');
  await waitFor("!document.querySelector('#recoveryPrompt').hidden", '新页面发现媒体恢复日志');
  await click('#restoreRecovery');
  await waitFor("document.querySelector('#fileName').textContent === '● media-tools.pptx' && !document.querySelector('#editorApp').dataset.loading", '未打开媒体工具也能恢复');
  await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${count}`, '恢复后保留媒体对象');
  await evaluate(`(() => {
    window.confirm = () => true;
    const original = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { globalThis.__capturedDownload = { name: this.download, href: this.href }; return; }
      return original.call(this);
    };
  })()`);
  const saveTarget = await evaluate(`(() => {
    const button = document.querySelector('#saveFile'), rect = button.getBoundingClientRect();
    return { disabled: button.disabled, left: rect.left, right: rect.right,
      hit: document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)?.id };
  })()`);
  if (saveTarget.disabled || saveTarget.hit !== 'saveFile') throw new Error(`媒体工具不能挤走保存入口：${JSON.stringify(saveTarget)}`);
  await saveAndReopen(context, 'media-tools-reopened.pptx');
  await waitFor("[...document.querySelectorAll('[data-pane-name]')].some((node) => node.textContent === '音频')", '音频保存重开');
  await selectPaneObject(context, '音频');
  const originalPoster = await evaluate(selectedPoster);
  await click('#mediaTools');
  await waitFor("document.querySelector('#mediaDialog')?.open", '选中媒体工具');
  await changeValue(context, '#mediaAction', 'poster');
  await upload(context, '#mediaPoster', '/assets/replacement.png', 'image/png');
  await click('#insertMedia');
  await waitFor("document.querySelector('#statusText').textContent === '海报已替换'", '媒体海报替换');
  const replacedPoster = await evaluate(selectedPoster);
  if (!replacedPoster || replacedPoster === originalPoster) throw new Error('海报替换未更新画布');
  await click('#undo');
  await waitFor(`${selectedPoster} === ${JSON.stringify(originalPoster)}`, '海报替换撤销');
  await click('#redo');
  await waitFor(`${selectedPoster} === ${JSON.stringify(replacedPoster)}`, '海报替换重做');
  await saveAndReopen(context, 'media-poster-reopened.pptx');
  await selectPaneObject(context, '音频');
  const preservedPoster = await evaluate(`(async () => {
    const fingerprint = async (url) => [...new Uint8Array(await crypto.subtle.digest('SHA-256',
      await fetch(url).then((response) => response.arrayBuffer())))].join(',');
    return await fingerprint(${selectedPoster}) === await fingerprint('/assets/replacement.png');
  })()`, true);
  if (!preservedPoster) throw new Error('保存重开的海报字节与选择的图片不一致');
  await click('#mediaTools');
  await waitFor("!!document.querySelector('#mediaPreviewPlayer')", '选中音频试听控件');
  await evaluate("document.querySelector('#mediaPreviewPlayer').muted = true");
  await click('#playSelectedMedia');
  await waitFor("document.querySelector('#mediaPreviewPlayer').ended", '保存后音频真实点击播放结束');
  await click('#closeMediaDialog');
  await waitFor("!document.querySelector('#mediaDialog')", '关闭试听并释放对话框');
  await click('#mediaTools');
  await waitFor("document.querySelector('#mediaDialog')?.open", '重新打开媒体工具');
  await changeValue(context, '#mediaSource', 'external');
  const missingUrl = await evaluate("location.origin + '/missing-media.wav'");
  await changeValue(context, '#mediaUrl', missingUrl);
  await click('#insertMedia');
  await waitFor("!document.querySelector('#mediaDialog')", '外链插入');
  await click('#mediaTools');
  await waitFor("!!document.querySelector('#mediaPreviewPlayer')", '外链试听控件');
  if (await evaluate(`performance.getEntriesByName(${JSON.stringify(missingUrl)}).length`) !== 0) {
    throw new Error('打开工具或插入媒体不应提前请求外链');
  }
  await click('#playSelectedMedia');
  await waitFor("document.querySelector('#mediaPlaybackStatus').dataset.state === 'error'", '失效外链明确降级');
  const fallback = await evaluate(`(() => {
    const poster = document.querySelector('#mediaPreviewPoster');
    return { poster: !!poster && !poster.hidden && poster.naturalWidth === 128,
      source: document.querySelector('#mediaPreviewPlayer').getAttribute('src') };
  })()`);
  if (!fallback.poster || fallback.source !== missingUrl) throw new Error('播放失败不能丢失海报或原外链');
  await click('#closeMediaDialog');
  await waitFor("!document.querySelector('#mediaDialog')", '关闭失效外链预览');
  await click('#mediaTools');
  await waitFor("document.querySelector('#mediaDialog')?.open", '慢响应媒体插入入口');
  await changeValue(context, '#mediaSource', 'external');
  await changeValue(context, '#mediaUrl', await evaluate("location.origin + '/slow-media.wav'"));
  await click('#insertMedia');
  await waitFor("!document.querySelector('#mediaDialog')", '慢响应外链插入');
  await click('#mediaTools');
  await waitFor("!!document.querySelector('#mediaPreviewPlayer')", '慢响应试听控件');
  await evaluate("document.querySelector('#mediaPreviewPlayer').muted = true");
  await click('#playSelectedMedia');
  await click('#playSelectedMedia');
  await waitFor("document.querySelector('#mediaPlaybackStatus').dataset.state === 'ended'", '加载期间重新播放不被旧尝试中止');
  const dropIsolated = await evaluate(`(async () => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([await fetch('/fixtures/sample-editor-media.wav').then((response) => response.arrayBuffer())], 'preview.wav', { type: 'audio/wav' }));
    const status = document.querySelector('#statusText').textContent;
    const input = document.querySelector('#mediaFile');
    input.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    input.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    return document.querySelector('#dropLayer').hidden && !document.querySelector('#editorApp').dataset.loading
      && document.querySelector('#statusText').textContent === status;
  })()`, true);
  if (!dropIsolated) throw new Error('媒体工具内拖放不能被全局 PPT 打开入口劫持');
  await evaluate('globalThis.__previousMediaPlayer = document.querySelector("#mediaPreviewPlayer")');
  await click('#playSelectedMedia');
  await openFixture(context, '/demo/showcase.pptx', 'media-lifecycle.pptx');
  await waitFor("!document.querySelector('#mediaDialog')", '切换文稿关闭旧媒体工具');
  if (!await evaluate('globalThis.__previousMediaPlayer.paused && !globalThis.__previousMediaPlayer.hasAttribute("src")')) {
    throw new Error('切换文稿必须终止播放并释放媒体源');
  }
  await runVideoContract(context);
}

async function runVideoContract(context) {
  const { evaluate, waitFor, click, request } = context;
  const count = await evaluate("document.querySelectorAll('[data-pane-element]').length");
  await click('#mediaTools');
  await waitFor("document.querySelector('#mediaDialog')?.open", '视频输入校验入口');
  await upload(context, '#mediaFile', '/fixtures/sample-editor-media.mp4', 'audio/wav', 'fake.wav');
  await click('#insertMedia');
  await waitFor("document.querySelector('#mediaError').textContent.includes('PCM WAV')", '伪装 WAV 按签名拒绝');
  await changeValue(context, '#mediaKind', 'video');
  await upload(context, '#mediaFile', '/fixtures/sample-editor-media.mp4', 'video/mp4');
  await click('#insertMedia');
  await waitFor("document.querySelector('#mediaError').textContent === '视频必须提供海报'", '视频未提供海报明确拒绝');
  if (await evaluate("document.querySelectorAll('[data-pane-element]').length") !== count) {
    throw new Error('校验失败不能创建对象或历史');
  }
  await upload(context, '#mediaPoster', '/assets/replacement.png', 'image/png');
  await click('#insertMedia');
  await waitFor("document.querySelector('#statusText').textContent === '已插入视频'", 'MP4 与海报插入');
  await click('#undo');
  await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${count}`, '视频插入撤销');
  await click('#redo');
  await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${count + 1}`, '视频插入重做');
  await saveAndReopen(context, 'embedded-video.pptx');
  await selectPaneObject(context, '视频');
  await click('#mediaTools');
  await waitFor("document.querySelector('#mediaPreviewPlayer')?.tagName === 'VIDEO'", '保存后视频播放控件');
  await request('Network.enable');
  await request('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
  try { await playVideo(context, '嵌入 MP4 保存重开后离线播放'); }
  finally { await request('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); }
  await click('#closeMediaDialog');
  await waitFor("!document.querySelector('#mediaDialog')", '关闭嵌入视频播放');
  await click('#mediaTools');
  await waitFor("document.querySelector('#mediaDialog')?.open", '外链视频入口');
  await changeValue(context, '#mediaKind', 'video');
  await changeValue(context, '#mediaSource', 'external');
  const linkedUrl = await evaluate("location.origin + '/fixtures/sample-editor-media.mp4?linked=1'");
  await changeValue(context, '#mediaUrl', linkedUrl);
  await upload(context, '#mediaPoster', '/assets/replacement.png', 'image/png');
  await click('#insertMedia');
  await waitFor("!document.querySelector('#mediaDialog')", '外链视频插入');
  await evaluate(`(() => {
    const row = document.querySelector('[data-pane-element][aria-selected="true"]');
    row.querySelector('[data-pane-name]').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const input = row.querySelector('input');
    input.value = '外链视频';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  })()`);
  await saveAndReopen(context, 'linked-video.pptx');
  await selectPaneObject(context, '外链视频');
  await click('#mediaTools');
  await waitFor("document.querySelector('#mediaPreviewPlayer')?.tagName === 'VIDEO'", '外链视频重开后的控件');
  if (await evaluate(`performance.getEntriesByName(${JSON.stringify(linkedUrl)}).length`) !== 0
    || !await evaluate(`document.querySelector('#mediaPreviewSource').textContent.includes(${JSON.stringify(linkedUrl)})`)) {
    throw new Error('外链视频重开必须保留地址且点击前不下载：' + JSON.stringify(await evaluate(`({
      source: document.querySelector('#mediaPreviewSource').textContent,
      requests: performance.getEntriesByName(${JSON.stringify(linkedUrl)}).map((entry) => entry.name),
      names: [...document.querySelectorAll('[data-pane-element]')].filter((row) => row.querySelector('[data-pane-name]')?.textContent === '视频')
        .map((row) => ({ id: row.dataset.paneElement, selected: row.getAttribute('aria-selected') })),
    })`)));
  }
  await playVideo(context, '外链 MP4 保存重开后真实播放');
  await evaluate('globalThis.__closedMediaDialogRef = new WeakRef(document.querySelector("#mediaDialog"))');
  await click('#closeMediaDialog');
  await waitFor("!document.querySelector('#mediaDialog')", '结束视频工具回归');
  await request('HeapProfiler.collectGarbage');
  if (await evaluate('!!globalThis.__closedMediaDialogRef.deref()')) {
    throw new Error('关闭媒体工具后不能继续持有已移除的对话框与文件输入');
  }
}

async function playVideo({ evaluate, click, waitFor }, label) {
  await evaluate("document.querySelector('#mediaPreviewPlayer').muted = true");
  await click('#playSelectedMedia');
  await waitFor("document.querySelector('#mediaPlaybackStatus').dataset.state === 'ended'", label);
  const video = await evaluate(`(() => {
    const player = document.querySelector('#mediaPreviewPlayer');
    return { width: player.videoWidth, height: player.videoHeight,
      frames: player.getVideoPlaybackQuality().totalVideoFrames,
      posterHidden: document.querySelector('#mediaPreviewPoster').hidden, visible: !player.hidden };
  })()`);
  if (video.width !== 32 || video.height !== 24 || video.frames < 1 || !video.posterHidden || !video.visible) {
    throw new Error(`${label}必须产生实际画面帧：${JSON.stringify(video)}`);
  }
}
