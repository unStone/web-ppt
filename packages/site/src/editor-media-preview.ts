import type { ImageElement } from '@web-ppt/core';

/** 试听属于用户主动打开的产品工具，不改变投影、保存内容或默认渲染器。 */
export function createMediaPreview(image: ImageElement, current: () => boolean) {
  const section = document.createElement('section');
  section.id = 'mediaPreview';
  section.innerHTML = `<h3>选中媒体试听 / 播放</h3><small id="mediaPreviewSource"></small>
<img id="mediaPreviewPoster" alt="当前媒体海报" style="max-width:100%;max-height:120px;margin:12px auto" />
<button id="playSelectedMedia" type="button" class="button">播放</button>
<p id="mediaPlaybackStatus" role="status" aria-live="polite"></p>`;
  const media = image.media!;
  const source = section.querySelector<HTMLElement>('#mediaPreviewSource')!;
  const poster = section.querySelector<HTMLImageElement>('#mediaPreviewPoster')!;
  const play = section.querySelector<HTMLButtonElement>('#playSelectedMedia')!;
  const status = section.querySelector<HTMLElement>('#mediaPlaybackStatus')!;
  const player = document.createElement(media.kind);
  player.id = 'mediaPreviewPlayer';
  player.controls = true;
  player.preload = 'none';
  player.style.cssText = 'width:100%;max-height:240px;margin:10px 0';
  if (image.src) poster.src = image.src; else poster.hidden = true;
  player.hidden = true;
  source.textContent = media.external ? `外链：${media.src ?? '源不可用'}。点击播放才会访问该地址。`
    : '嵌入媒体；使用浏览器原生控件播放，不修改文件。';
  section.insertBefore(player, play);
  const events = new AbortController();
  let active = true;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = (): void => { clearTimeout(timer); timer = undefined; };
  const state = (kind: string, message: string): void => {
    if (!active) return;
    status.dataset.state = kind;
    status.textContent = message;
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  };
  const failed = (message: string): void => {
    clearTimer();
    if (!active) return;
    attempt++;
    player.pause();
    player.hidden = media.kind === 'video';
    poster.hidden = !image.src;
    play.textContent = '重试播放';
    state('error', `${message}；海报与原媒体源仍保留，可重试播放或保存文件。`);
  };
  const loading = (): void => {
    clearTimer();
    timer = setTimeout(() => failed('加载超时，请检查网络或稍后重试'), 15000);
  };
  const listen = (type: string, listener: () => void): void => {
    player.addEventListener(type, listener, { signal: events.signal });
  };
  listen('error', () => {
    if (player.error) failed(media.external
      ? '外链不可用或浏览器无法解码此媒体' : '浏览器无法加载或解码此媒体');
  });
  listen('playing', () => {
    clearTimer();
    if (!current()) { player.pause(); return; }
    if (media.kind === 'video') { poster.hidden = true; player.hidden = false; }
    state('playing', '正在播放');
  });
  listen('ended', () => { if (player.ended) { clearTimer(); state('ended', '播放结束'); } });
  listen('pause', () => { if (player.paused) clearTimer(); });
  const awaitingData = (): void => { if (!player.paused && !player.error) loading(); };
  listen('waiting', awaitingData);
  listen('stalled', awaitingData);
  play.onclick = () => {
    if (!current()) { failed('选中媒体或文稿已变化，请重新打开工具'); return; }
    if (!media.src) { failed('媒体源不可用'); return; }
    const generation = ++attempt;
    state('loading', '正在加载媒体…');
    play.textContent = '重新播放';
    player.hidden = false;
    // preload 只是提示；不设置 src 才能保证打开工具本身不请求外链媒体。
    player.src = media.src;
    player.load();
    loading();
    void player.play().catch((error: unknown) => {
      // load() 会拒绝上一次 play()；过期回调不能暂停用户刚启动的新尝试。
      if (!active || generation !== attempt) return;
      failed(error instanceof DOMException && error.name === 'NotAllowedError'
        ? '浏览器阻止了播放，请再次点击播放' : media.external
          ? '外链不可用或浏览器无法解码此媒体' : '浏览器无法加载或解码此媒体');
    });
  };
  if (!media.src) { play.disabled = true; failed('媒体源不可用'); }
  return {
    element: section,
    destroy(): void {
      active = false;
      clearTimer(); events.abort(); player.pause(); player.removeAttribute('src'); player.load();
      section.remove();
    },
  };
}
