import type { EditorSession, SlideEditor } from '@web-ppt/editor';
import { createMediaEditor, MAX_MEDIA_BYTES, type AddMediaCommand, type MediaPoster } from '@web-ppt/editor/media';
import { createMediaPreview } from './editor-media-preview';
import { setText, setMessage } from './i18n/runtime';
import { moveLanguageControl } from './i18n/controls';
import { message, type SiteMessage, type SiteNotice } from './i18n/message';

interface MediaContext {
  session: EditorSession | null;
  view: SlideEditor | null;
  writable: boolean;
}

/** 异步校验保存词条身份，读取期间切语言后仍按显示时的语言呈现。 */
class MediaInputError extends Error {
  constructor(readonly notice: SiteMessage) { super(notice.source); }
}

async function readBytes(file: File | undefined, maximum: number, label: '媒体文件' | '海报'): Promise<Uint8Array> {
  if (!file) throw new MediaInputError(message(label === '媒体文件' ? '请选择媒体文件' : '请选择新的海报'));
  if (!file.size || file.size > maximum) throw new MediaInputError(message('{label}必须非空且不超过 {maximum} MiB', {
    label: message(label), maximum: maximum / 1024 / 1024,
  }));
  return new Uint8Array(await file.arrayBuffer());
}

async function readPoster(file: File | undefined): Promise<MediaPoster | undefined> {
  if (!file) return undefined;
  if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
    throw new MediaInputError(message('海报仅支持 PNG、JPEG、GIF 或 WebP'));
  }
  return { bytes: await readBytes(file, 5 * 1024 * 1024, '海报'), mime: file.type as MediaPoster['mime'] };
}

/** 对话框连同媒体校验一起按需加载；读文件期间切换文稿不能把旧选择插入新会话。 */
export function showMediaTools(
  context: () => MediaContext, notice: SiteNotice, onClose: () => void,
): (() => void) | undefined {
  if (document.querySelector('#mediaDialog')) return;
  const { session, view, writable } = context();
  if (!session || !view || !writable) return;
  const slideId = view.slideId;
  const selection = session.editor.selection;
  const selectedId = selection.kind === 'elements' && selection.ids.length === 1 ? selection.ids[0] : null;
  const record = selectedId ? session.editor.doc.elements[selectedId] : undefined;
  const canReplace = record?.src.kind === 'image' && !!record.src.media && record.meta.editable === 'frame'
    && !record.meta.locked && !record.src.editInfo?.requiresOriginal;
  const dialog = document.createElement('dialog');
  dialog.id = 'mediaDialog';
  dialog.setAttribute('aria-labelledby', 'mediaDialogTitle');
  dialog.innerHTML = `<style>
#mediaDialog{box-sizing:border-box;width:min(520px,calc(100vw - 32px));max-height:calc(100vh - 32px);padding:24px;border:1px solid var(--line);border-radius:14px;color:var(--ink);background:#fff}
#mediaDialog::backdrop{background:#11182770}#mediaDialog h2{margin:0 0 16px;font-size:20px}
#mediaDialog label{display:grid;gap:6px;margin:12px 0}#mediaDialog input,#mediaDialog select{box-sizing:border-box;width:100%;min-width:0;padding:8px;border:1px solid var(--line);border-radius:6px}
#mediaDialog small{display:block;color:var(--muted);line-height:1.5}#mediaDialog .media-actions{display:flex;gap:12px;justify-content:flex-end;margin-top:16px}
#mediaDialog [role=alert]{color:#a82917;white-space:pre-wrap}#mediaDialog [hidden]{display:none}
</style><div class="media-head"><h2 id="mediaDialogTitle"></h2></div>
<form id="mediaForm">
<label><span id="mediaActionLabel"></span><select id="mediaAction"><option value="insert"></option><option value="poster"></option></select></label>
<small id="mediaTargetHint"></small>
<div id="mediaInsertionFields">
<label><span id="mediaKindLabel"></span><select id="mediaKind"><option value="audio"></option><option value="video"></option></select></label>
<label><span id="mediaSourceLabel"></span><select id="mediaSource"><option value="embedded"></option><option value="external"></option></select></label>
<label id="mediaFileField"><span id="mediaFileLabel"></span><input id="mediaFile" type="file" accept=".wav,audio/wav" /></label>
<label id="mediaUrlField" hidden><span id="mediaUrlLabel"></span><input id="mediaUrl" type="url" placeholder="https://example.com/media" /></label>
<small id="mediaSourceHint"></small>
</div>
<label><span id="mediaPosterLabel"></span><input id="mediaPoster" type="file" accept="image/png,image/jpeg,image/gif,image/webp" /></label>
<small id="mediaPosterHint"></small>
<p id="mediaError" role="alert"></p>
<div class="media-actions"><button id="closeMediaDialog" class="button" type="button"></button><button id="insertMedia" class="button primary" type="submit"></button></div>
</form>`;
  for (const [selector, label] of [
    ['#mediaDialogTitle', '音视频与海报'], ['#mediaActionLabel', '操作'],
    ['#mediaAction option[value="insert"]', '插入新媒体'], ['#mediaAction option[value="poster"]', '替换选中媒体的海报'],
    ['#mediaKindLabel', '媒体类型'], ['#mediaKind option[value="audio"]', '音频 · PCM WAV'],
    ['#mediaKind option[value="video"]', '视频 · MP4'], ['#mediaSourceLabel', '媒体来源'],
    ['#mediaSource option[value="embedded"]', '本机文件（嵌入）'], ['#mediaSource option[value="external"]', 'HTTP(S) 外链'],
    ['#mediaFileLabel', '媒体文件'], ['#mediaUrlLabel', '外链地址'], ['#mediaPosterLabel', '海报图片'],
    ['#closeMediaDialog', '取消'],
  ] as const) setText(dialog.querySelector(selector)!, label);
  const get = <T extends HTMLElement>(id: string): T => dialog.querySelector<T>(`#${id}`)!;
  const kind = get<HTMLSelectElement>('mediaKind');
  const action = get<HTMLSelectElement>('mediaAction');
  action.options[1].disabled = !canReplace;
  if (canReplace) setText(get('mediaTargetHint'), '当前选中：{name}', { name: record.src.name || message('媒体') });
  else setText(get('mediaTargetHint'), '选中一个未锁定的媒体对象后可替换海报；兼容外壳内容保持原样。');
  const source = get<HTMLSelectElement>('mediaSource');
  const file = get<HTMLInputElement>('mediaFile');
  const url = get<HTMLInputElement>('mediaUrl');
  const posterInput = get<HTMLInputElement>('mediaPoster');
  const error = get<HTMLElement>('mediaError');
  const submit = get<HTMLButtonElement>('insertMedia');
  const selectedMedia = record?.src.kind === 'image' && record.src.media
    ? session.editor.effectiveElement(record.id) : null;
  const preview = selectedMedia?.kind === 'image' ? createMediaPreview(selectedMedia, () => {
    const current = context();
    return current.session === session && current.view === view && view.slideId === slideId
      && !!selectedId && !!session.editor.doc.elements[selectedId];
  }) : null;
  if (preview) dialog.insertBefore(preview.element, get('mediaForm'));
  let pending = false;
  const sync = (): void => {
    const external = source.value === 'external', video = kind.value === 'video';
    const replacing = action.value === 'poster';
    get('mediaInsertionFields').hidden = replacing;
    setText(submit, replacing ? '替换海报' : '插入');
    get('mediaFileField').hidden = external;
    get('mediaUrlField').hidden = !external;
    url.disabled = !external || replacing;
    file.accept = video ? '.mp4,video/mp4' : '.wav,audio/wav';
    setText(get('mediaSourceHint'), external
      ? '外链不会下载或嵌入 PPTX；播放时会访问该地址，需要网络，且不保证浏览器支持其编码。'
      : '文件最大 25 MiB，保存在 PPTX 内，不会上传或转码。');
    setText(get('mediaPosterHint'), replacing ? '仅替换海报，不改变音视频源；图片最大 5 MiB。'
      : video ? '视频必须提供海报；图片最大 5 MiB。'
      : '音频可省略海报，使用内置喇叭图标；图片最大 5 MiB。');
  };
  kind.onchange = source.onchange = action.onchange = sync;
  const close = (): void => {
    if (!dialog.isConnected) return;
    preview?.destroy(); restoreLanguage(); dialog.close(); dialog.remove();
    onClose();
  };
  get('closeMediaDialog').onclick = close;
  dialog.addEventListener('close', close, { once: true });
  get<HTMLFormElement>('mediaForm').onsubmit = (event) => {
    event.preventDefault();
    if (pending) return;
    pending = true; submit.disabled = true; setMessage(error, '');
    void (async () => {
      const video = kind.value === 'video', external = source.value === 'external';
      const replacing = action.value === 'poster';
      const address = url.value, mediaFile = file.files?.[0];
      const poster = await readPoster(posterInput.files?.[0]);
      if ((video || replacing) && !poster) throw new MediaInputError(message(replacing ? '请选择新的海报' : '视频必须提供海报'));
      const bytes = external || replacing ? null : await readBytes(mediaFile, MAX_MEDIA_BYTES, '媒体文件');
      const current = context();
      if (!dialog.open) return;
      if (!current.writable || current.session !== session || current.view !== view || view.slideId !== slideId) {
        throw new MediaInputError(message('文稿、页面或编辑模式已变化，请关闭后重新选择媒体'));
      }
      if (replacing) {
        const active = session.editor.selection;
        if (!canReplace || !selectedId || active.kind !== 'elements' || active.ids.length !== 1 || active.ids[0] !== selectedId) {
          throw new MediaInputError(message('选中对象已变化或不能替换海报，请重新选择媒体'));
        }
        createMediaEditor(session.editor).exec({ type: 'ReplaceMediaPoster', id: selectedId, poster: poster! });
        close(); view.element.focus(); notice(message('海报已替换'), 'success');
        return;
      }
      const rect = { x: session.editor.doc.meta.width * .3, y: session.editor.doc.meta.height * .3,
        w: session.editor.doc.meta.width * .4, h: session.editor.doc.meta.height * .3 };
      const command: AddMediaCommand = video ? {
        type: 'AddMedia', slideId, rect, poster: poster!,
        source: external ? { kind: 'external', mediaKind: 'video', url: address }
          : { kind: 'embedded', bytes: bytes!, mime: 'video/mp4' },
      } : {
        type: 'AddMedia', slideId, rect, ...(poster ? { poster } : {}),
        source: external ? { kind: 'external', mediaKind: 'audio', url: address }
          : { kind: 'embedded', bytes: bytes!, mime: 'audio/wav' },
      };
      createMediaEditor(session.editor).exec(command);
      close(); view.element.focus();
      notice(message(video ? '已插入视频' : '已插入音频'), 'success');
    })().catch((failure: unknown) => {
      if (dialog.open) setMessage(error, failure instanceof MediaInputError ? failure.notice
        : message('无法完成媒体操作：{detail}', { detail: failure instanceof Error ? failure.message : String(failure) }));
    }).finally(() => { pending = false; submit.disabled = false; });
  };
  sync();
  document.body.append(dialog);
  const restoreLanguage = moveLanguageControl(dialog.querySelector('.media-head')!);
  dialog.showModal();
  return close;
}
