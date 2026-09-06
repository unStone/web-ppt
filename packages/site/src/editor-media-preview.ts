import type { ImageElement } from '@web-ppt/core';
import { message, type SiteMessage } from './i18n/message';
import { setText, setMessage, setAttributeText } from './i18n/runtime';

/** 试听属于用户主动打开的产品工具，不改变投影、保存内容或默认渲染器。 */
export function createMediaPreview(image: ImageElement, current: () => boolean) {
  const section = document.createElement('section');
  section.id = 'mediaPreview';
  section.innerHTML = `<h3></h3><small id="mediaPreviewSource"></small>
<img id="mediaPreviewPoster" style="max-width:100%;max-height:120px;margin:12px auto" />
<button id="playSelectedMedia" type="button" class="button"></button>
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
  setText(section.querySelector('h3')!, '选中媒体试听 / 播放');
  setText(play, '播放');
  setAttributeText(poster, 'alt', '当前媒体海报');
  setAttributeText(player, 'aria-label', '选中媒体播放器');
  player.style.cssText = 'width:100%;max-height:240px;margin:10px 0';
  if (image.src) poster.src = image.src; else poster.hidden = true;
  player.hidden = true;
  if (media.external) setText(source, '外链：{url}。点击播放才会访问该地址。', { url: media.src ?? message('源不可用') });
  else setText(source, '嵌入媒体；使用浏览器原生控件播放，不修改文件。');
  section.insertBefore(player, play);
  const events = new AbortController();
  let active = true;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const clearTimer = (): void => { clearTimeout(timer); timer = undefined; };
  const state = (kind: string, notice: SiteMessage): void => {
    if (!active) return;
    status.dataset.state = kind;
    setMessage(status, notice);
    status.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  };
  const failed = (reason: SiteMessage): void => {
    clearTimer();
    if (!active) return;
    attempt++;
    player.pause();
    player.hidden = media.kind === 'video';
    poster.hidden = !image.src;
    setText(play, '重试播放');
    state('error', message('{reason}；海报与原媒体源仍保留，可重试播放或保存文件。', { reason }));
  };
  const loading = (): void => {
    clearTimer();
    timer = setTimeout(() => failed(message('加载超时，请检查网络或稍后重试')), 15000);
  };
  const listen = (type: string, listener: () => void): void => {
    player.addEventListener(type, listener, { signal: events.signal });
  };
  listen('error', () => {
    if (player.error) failed(message(media.external
      ? '外链不可用或浏览器无法解码此媒体' : '浏览器无法加载或解码此媒体'));
  });
  listen('playing', () => {
    clearTimer();
    if (!current()) { player.pause(); return; }
    if (media.kind === 'video') { poster.hidden = true; player.hidden = false; }
    state('playing', message('正在播放'));
  });
  listen('ended', () => { if (player.ended) { clearTimer(); state('ended', message('播放结束')); } });
  listen('pause', () => { if (player.paused) clearTimer(); });
  const awaitingData = (): void => { if (!player.paused && !player.error) loading(); };
  listen('waiting', awaitingData);
  listen('stalled', awaitingData);
  play.onclick = () => {
    if (!current()) { failed(message('选中媒体或文稿已变化，请重新打开工具')); return; }
    if (!media.src) { failed(message('媒体源不可用')); return; }
    const generation = ++attempt;
    state('loading', message('正在加载媒体…'));
    setText(play, '重新播放');
    player.hidden = false;
    // preload 只是提示；不设置 src 才能保证打开工具本身不请求外链媒体。
    player.src = media.src;
    player.load();
    loading();
    void player.play().catch((error: unknown) => {
      // load() 会拒绝上一次 play()；过期回调不能暂停用户刚启动的新尝试。
      if (!active || generation !== attempt) return;
      failed(message(error instanceof DOMException && error.name === 'NotAllowedError'
        ? '浏览器阻止了播放，请再次点击播放' : media.external
          ? '外链不可用或浏览器无法解码此媒体' : '浏览器无法加载或解码此媒体'));
    });
  };
  if (!media.src) { play.disabled = true; failed(message('媒体源不可用')); }
  return {
    element: section,
    destroy(): void {
      active = false;
      clearTimer(); events.abort(); player.pause(); player.removeAttribute('src'); player.load();
      section.remove();
    },
  };
}
