import { changeValue, openFixture } from './site-editor-browser-helpers.mjs';
import { runSiteLanguageInputContract } from './site-language-input-contract.mjs';

export async function runSiteI18nMediaContract(context) {
  const { evaluate, request, click, waitFor } = context;
  await click('[data-site-locale="en"]');
  await waitFor("document.documentElement.lang === 'en'", '媒体流程使用英文');
  await openFixture(context, '/fixtures/sample-editor-add-media.pptx', '<媒体 & 原文>.pptx');
  await click('#mediaTools');
  await waitFor("document.querySelector('#mediaDialog')?.open", '媒体工具按需打开');
  await waitFor("document.querySelector('#mediaDialogTitle').textContent === 'Audio, video and posters'", '英文媒体工具标题');
  if (!await evaluate(`document.querySelector('#mediaAction').labels[0].textContent.startsWith('Action')
    && document.querySelector('#mediaFile').labels[0].textContent === 'Media file'
    && document.querySelector('#mediaKind option[value="audio"]').textContent === 'Audio · PCM WAV'`)) {
    throw new Error('媒体字段及选项的可访问名称未翻译');
  }
  await changeValue(context, '#mediaSource', 'external');
  const address = await evaluate("location.origin + '/missing-media.wav?原文=复制&lang=zh-CN'");
  await changeValue(context, '#mediaUrl', address);
  await evaluate(`(() => {
    globalThis.__mediaLanguageDialog = document.querySelector('#mediaDialog');
    globalThis.__mediaLanguageCanvas = document.querySelector('#canvasMount').firstElementChild;
  })()`);
  await click('#mediaDialog [data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#mediaDialogTitle').textContent === '音视频与海报'", '媒体对话框内切中文');
  if (!await evaluate(`globalThis.__mediaLanguageDialog === document.querySelector('#mediaDialog')
    && globalThis.__mediaLanguageCanvas === document.querySelector('#canvasMount').firstElementChild
    && document.querySelector('#mediaSource').value === 'external'
    && document.querySelector('#mediaUrl').value === ${JSON.stringify(address)}`)) throw new Error('语言切换重建媒体工具或改写了用户地址');
  await runSiteLanguageInputContract(context, '媒体对话框');
  await request('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await request('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await waitFor("!document.querySelector('#mediaDialog') && !!document.querySelector('.app-header #siteLanguage')", '取消媒体工具归还语言入口');
  await runMediaValidationContract(context);
  await runMediaPlaybackContract(context);
}

async function runMediaPlaybackContract(context) {
  const { evaluate, click, waitFor } = context;
  await click('#mediaTools');
  await waitFor("!!document.querySelector('#mediaPreviewPlayer')", '插入音频的原生试听');
  await waitFor("document.querySelector('#mediaPreview h3').textContent === 'Preview selected media'", '试听标题英文');
  if (!await evaluate(`document.querySelector('#mediaPreviewPoster').alt === 'Current media poster'
    && document.querySelector('#mediaPreviewPlayer').getAttribute('aria-label') === 'Selected media player'`)) throw new Error('海报和原生播放器缺少英文可访问名称');
  await evaluate("document.querySelector('#mediaPreviewPlayer').muted = true");
  await click('#playSelectedMedia');
  await waitFor("document.querySelector('#mediaPreviewPlayer').ended", '真实 WAV 播放结束');
  await waitFor("document.querySelector('#mediaPlaybackStatus').textContent === 'Playback ended'", '播放结束英文状态');
  await evaluate("globalThis.__languageMediaPlayer = document.querySelector('#mediaPreviewPlayer'); globalThis.__languageMediaTime = globalThis.__languageMediaPlayer.currentTime");
  await click('#mediaDialog [data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#mediaPlaybackStatus').textContent === '播放结束'", '结束状态原地切中文');
  if (!await evaluate(`globalThis.__languageMediaPlayer === document.querySelector('#mediaPreviewPlayer')
    && globalThis.__languageMediaPlayer.currentTime === globalThis.__languageMediaTime`)) throw new Error('切语言重建了播放器或重置了播放位置');
  await changeValue(context, '#mediaAction', 'poster');
  await uploadMedia(context, '#mediaPoster', '/assets/replacement.png', 'image/png', '原始海报.png');
  await click('#mediaDialog [data-site-locale="en"]');
  await waitFor("document.querySelector('#insertMedia').textContent === 'Replace poster'", '替换动作英文名称');
  if (!await evaluate("document.querySelector('#mediaPoster').files[0].name === '原始海报.png'")) throw new Error('语言切换清除了海报选择');
  await click('#insertMedia');
  await waitFor("document.querySelector('#statusText').textContent === 'Poster replaced'", '替换成功英文状态');
  await click('#mediaTools');
  await waitFor("document.querySelector('#mediaDialog')?.open", '外链插入工具');
  await changeValue(context, '#mediaSource', 'external');
  const address = await evaluate("location.origin + '/missing-media.wav?source=%E5%A4%8D%E5%88%B6&lang=zh-CN'");
  await changeValue(context, '#mediaUrl', address);
  await click('#insertMedia');
  await waitFor("!document.querySelector('#mediaDialog')", '外链实际插入');
  await click('#mediaTools');
  await waitFor("document.querySelector('#mediaPreviewSource')?.textContent.startsWith('External URL: ')", '外链英文说明');
  if (!await evaluate(`document.querySelector('#mediaPreviewSource').textContent.includes(${JSON.stringify(address)})
    && !document.querySelector('#mediaPreviewPlayer').hasAttribute('src')
    && !performance.getEntriesByName(${JSON.stringify(address)}).length`)) throw new Error('外链被改写或未经点击已访问');
  await click('#playSelectedMedia');
  await waitFor("document.querySelector('#mediaPlaybackStatus').dataset.state === 'error' && document.querySelector('#playSelectedMedia').textContent === 'Retry playback'", '外链失败英文提示');
  await click('#mediaDialog [data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#mediaPlaybackStatus').textContent.startsWith('外链不可用或浏览器无法解码此媒体；')", '失败嵌套消息切中文');
  if (!await evaluate(`document.querySelector('#mediaPreviewPlayer').getAttribute('src') === ${JSON.stringify(address)}
    && !document.querySelector('#mediaPreviewPoster').hidden`)) throw new Error('切语言丢失了失效外链或海报');
  await click('#closeMediaDialog');
  await waitFor("!!document.querySelector('.app-header #siteLanguage')", '播放工具关闭归还语言入口');
}

async function runMediaValidationContract(context) {
  const { evaluate, click, waitFor } = context;
  await click('#mediaTools');
  await waitFor("document.querySelector('#mediaDialog')?.open", '媒体校验工具');
  await click('#insertMedia');
  await waitFor("document.querySelector('#mediaError').textContent === 'Choose a media file'", '英文未选择文件错误');
  await click('#mediaDialog [data-site-locale="zh-CN"]');
  await waitFor("document.querySelector('#mediaError').textContent === '请选择媒体文件'", '错误消息原地切中文');
  await changeValue(context, '#mediaKind', 'video');
  await click('#insertMedia');
  await waitFor("document.querySelector('#mediaError').textContent === '视频必须提供海报'", '视频缺海报校验');
  await click('#mediaDialog [data-site-locale="en"]');
  await waitFor("document.querySelector('#mediaError').textContent === 'Video requires a poster'", '视频校验切英文');
  await changeValue(context, '#mediaKind', 'audio');
  await uploadMedia(context, '#mediaFile', null, 'audio/wav', '<无效>.wav');
  await click('#insertMedia');
  await waitFor("document.querySelector('#mediaError').textContent.startsWith('Could not complete the media action: ')", '引擎诊断带英文产品摘要');
  await uploadMedia(context, '#mediaFile', '/fixtures/sample-editor-media.wav', 'audio/wav', '<录音 & 原文>.wav');
  await evaluate(`(() => {
    const original = File.prototype.arrayBuffer;
    globalThis.__mediaFileRead = original;
    File.prototype.arrayBuffer = function () {
      return this.name === '<录音 & 原文>.wav' ? new Promise((resolve, reject) => {
        globalThis.__finishMediaRead = () => original.call(this).then(resolve, reject);
      }) : original.call(this);
    };
  })()`);
  try {
    await click('#insertMedia');
    await waitFor("!!globalThis.__finishMediaRead && document.querySelector('#insertMedia').disabled", '原生文件读取边界等待');
    await click('#mediaDialog [data-site-locale="zh-CN"]');
    if (!await evaluate(`document.querySelector('#mediaFile').files[0].name === '<录音 & 原文>.wav'
      && document.querySelector('#mediaError').textContent === '' && document.querySelector('#insertMedia').disabled`)) throw new Error('读取中切语言丢失文件、复活旧错误或提前解锁提交');
    await evaluate('globalThis.__finishMediaRead()', true);
    await waitFor("document.querySelector('#statusText').textContent === '已插入音频' && !document.querySelector('#mediaDialog')", '读取期间切语言后完成真实插入');
  } finally { await evaluate('File.prototype.arrayBuffer = globalThis.__mediaFileRead'); }
  const count = await evaluate("document.querySelectorAll('[data-pane-element]').length");
  await click('[data-site-locale="en"]');
  await waitFor("document.querySelector('#statusText').textContent === 'Audio inserted'", '成功状态切英文');
  await click('#undo');
  await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${count - 1}`, '切语言后仍可撤销媒体');
  await click('#redo');
  await waitFor(`document.querySelectorAll('[data-pane-element]').length === ${count}`, '切语言后仍可重做媒体');
}

async function uploadMedia({ evaluate }, selector, url, mime, name) {
  await evaluate(`(async () => {
    const bytes = ${url ? `await fetch(${JSON.stringify(url)}).then((response) => response.arrayBuffer())` : "'invalid'"};
    const files = new DataTransfer(); files.items.add(new File([bytes], ${JSON.stringify(name)}, { type: ${JSON.stringify(mime)} }));
    const input = document.querySelector(${JSON.stringify(selector)}); input.files = files.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`, true);
}
