/** 字节保留不等于可播放：让真实浏览器从保存产物解码，视频还必须产生实际画面帧。 */
export async function runMediaInsertionBrowserContract({ core, load }) {
  const { createMediaEditor, createDoc, disposeDoc, Editor } = await import('/out/editor/media.mjs');
  const original = await core.parse(await load('sample-media.pptx'), { keepPackage: true, lazy: false });
  const audioSource = original.slides.flatMap((slide) => slide.elements)
    .find((element) => element.media?.mime === 'audio/wav');
  if (!audioSource) throw new Error('真实播放验收缺少 WAV 固件');
  const sound = original.package.assets[audioSource.media.src];
  const poster = original.package.assets[audioSource.src];
  const cases = [
    { name: 'WAV', kind: 'audio', bytes: sound.bytes, mime: 'audio/wav' },
    { name: 'MP4', kind: 'video', bytes: new Uint8Array(await load('sample-editor-media.mp4')), mime: 'video/mp4' },
    { name: 'fMP4', kind: 'video', bytes: new Uint8Array(await load('sample-editor-media-fragmented.mp4')), mime: 'video/mp4' },
  ];
  const mount = document.createElement('div');
  mount.style.cssText = 'position:fixed;left:0;top:0;width:960px;height:540px;background:white';
  document.body.append(mount);
  const results = [];
  try {
    for (const sample of cases) for (const generated of [false, true]) {
      const presentation = await core.parse(await load('sample-editor-add-media.pptx'), { edit: true, keepPackage: true, lazy: false });
      const doc = createDoc(presentation);
      const editor = new Editor(doc);
      let reopened;
      try {
        createMediaEditor(editor).exec({
          type: 'AddMedia', slideId: doc.slideOrder[0],
          rect: { x: 30, y: 30, w: 300, h: 100 },
          source: { kind: 'embedded', bytes: sample.bytes, mime: sample.mime },
          poster: { bytes: poster.bytes, mime: poster.mime },
        });
        if (generated) presentation.dispose();
        const saved = await editor.save();
        reopened = await core.parse(saved, { lazy: false });
        mount.innerHTML = core.renderSlideToSvg(reopened, reopened.slides[0], { textMode: 'html', media: 'player' });
        const player = mount.querySelector(sample.kind);
        if (!player?.controls || !/^(blob:|data:(audio|video)\/)/.test(player.src)) {
          throw new Error(`保存重开未产生离线原生控件：${player?.outerHTML ?? mount.innerHTML.slice(-1000)}`);
        }
        player.muted = true;
        const play = document.createElement('button');
        play.textContent = `播放 ${sample.name} 验收`;
        play.dataset.mediaPlayback = '';
        play.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647';
        mount.append(play);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => finish(new Error(`${sample.name} 真实点击或实际播放超时`)), 10000);
          const finish = (error) => {
            clearTimeout(timeout);
            player.removeEventListener('ended', ended);
            player.removeEventListener('error', failed);
            play.remove();
            error ? reject(error) : resolve();
          };
          const ended = () => finish();
          const failed = () => finish(new Error(`${sample.name} 播放失败：${player.error?.message}`));
          player.addEventListener('ended', ended);
          player.addEventListener('error', failed);
          // 静音音频也受自动播放限制；驱动真实点击，不关闭浏览器的用户激活策略。
          play.addEventListener('click', (event) => {
            if (!event.isTrusted) return finish(new Error('媒体播放缺少真实用户点击'));
            play.disabled = true;
            player.play().catch((error) => finish(new Error(`${sample.name} 播放被拒绝：${String(error)}`)));
          }, { once: true });
        });
        if (!(player.duration > 0 && player.currentTime > 0) || player.error) throw new Error('媒体未被真实解码');
        if (sample.kind === 'video' && (player.videoWidth !== 32 || player.videoHeight !== 24
          || player.getVideoPlaybackQuality().totalVideoFrames < 1)) throw new Error('MP4 未产生真实视频帧');
        results.push({ name: sample.name, mode: generated ? 'generated' : 'patched', duration: player.duration, ended: player.ended });
      } finally { mount.replaceChildren(); reopened?.dispose(); editor.dispose(); disposeDoc(doc); }
    }
  } finally { mount.remove(); original.dispose(); }
  console.log('媒体原生控件离线播放通过', results);
  return results;
}
