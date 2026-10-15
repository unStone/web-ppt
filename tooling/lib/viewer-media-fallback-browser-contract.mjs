/**
 * 经典引用不可用、字节只在 p14:media 的媒体（issue #7）：Viewer 的 player 模式必须生成原生控件，
 * 并且 Chrome 能从回退得到的 blob 真实解码播放到结束——只断言 src 非空挡不住「指错部件」。
 */
export async function runViewerMediaFallbackBrowserContract({ Viewer, parse, load }) {
  const mount = document.createElement('div');
  mount.style.cssText = 'position:fixed;left:0;top:0;width:960px;height:540px;background:white';
  document.body.append(mount);
  const presentation = await parse(await load('sample-media-fallback.pptx'), { lazy: false });
  let viewer;
  const results = [];
  try {
    viewer = new Viewer(mount, presentation, { index: 0, textMode: 'html', media: 'player' });
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const players = [...mount.querySelectorAll('audio, video')].map((player) => ({
      player, spid: Number(player.closest('[data-el]')?.getAttribute('data-el')),
    }));
    const layout = players.map(({ player, spid }) => `${spid}:${player.localName}:${player.src.split(':')[0]}`).join(',');
    const expected = '10:audio:blob,11:video:blob,12:video:blob,13:audio:blob,14:video:https,15:audio:https,16:video:blob';
    if (layout !== expected) throw new Error(`Viewer player 模式控件与回退源不符：${layout}`);
    for (const { player, spid } of players.filter(({ player }) => player.src.startsWith('blob:'))) {
      player.muted = true;
      const play = document.createElement('button');
      play.textContent = `播放回退媒体 ${spid} 验收`;
      play.dataset.mediaPlayback = '';
      play.style.cssText = 'position:fixed;left:8px;top:8px;z-index:2147483647';
      document.body.append(play);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => finish(new Error(`回退媒体 ${spid} 真实点击或实际播放超时`)), 10000);
        const finish = (error) => {
          clearTimeout(timeout);
          player.removeEventListener('ended', ended);
          player.removeEventListener('error', failed);
          play.remove();
          error ? reject(error) : resolve();
        };
        const ended = () => finish();
        const failed = () => finish(new Error(`回退媒体 ${spid} 播放失败：${player.error?.message}`));
        player.addEventListener('ended', ended);
        player.addEventListener('error', failed);
        // 静音媒体同样受自动播放限制；由 DevTools 驱动真实点击，不放宽浏览器策略
        play.addEventListener('click', (event) => {
          if (!event.isTrusted) return finish(new Error('回退媒体播放缺少真实用户点击'));
          play.disabled = true;
          player.play().catch((error) => finish(new Error(`回退媒体 ${spid} 播放被拒绝：${String(error)}`)));
        }, { once: true });
      });
      if (!(player.duration > 0 && player.currentTime > 0) || player.error) throw new Error(`回退媒体 ${spid} 未被真实解码`);
      if (player.localName === 'video' && (player.videoWidth !== 32 || player.videoHeight !== 24
        || player.getVideoPlaybackQuality().totalVideoFrames < 1)) throw new Error(`回退视频 ${spid} 未产生真实画面帧`);
      results.push({ spid, kind: player.localName, duration: player.duration });
    }
  } finally {
    viewer?.destroy();
    presentation.dispose();
    mount.remove();
  }
  console.log('Viewer player 模式回退媒体真实播放通过', results);
  return results;
}
