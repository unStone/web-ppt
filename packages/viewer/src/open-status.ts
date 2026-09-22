import { mapOpenError } from '../../site/src/open-kind';

const fmtMB = (n: number): string => `${(n / 1048576).toFixed(1)}MB`;

function paintStatus(stage: HTMLElement, phase: 'opening' | 'download' | 'parsing' | 'error', label: string, note = ''): void {
  stage.dataset.openPhase = phase;
  stage.innerHTML =
    '<div class="open-status">' +
    '<div class="open-status-label"></div>' +
    (phase === 'error' ? '' : '<div class="open-status-bar"><i></i></div>') +
    '<div class="open-status-note"></div>' +
    '</div>';
  const title = stage.querySelector('.open-status-label');
  const hint = stage.querySelector('.open-status-note');
  if (title) title.textContent = label;
  if (hint) hint.textContent = note;
}

export function describeOpenFailure(error: unknown): string {
  if (error instanceof TypeError) return '无法下载：网络不通或对方不允许跨域';
  const mapped = mapOpenError(error);
  if (mapped) return mapped;
  if (error instanceof Error) return error.message;
  return String(error);
}

export function showOpenOpening(stage: HTMLElement): void {
  paintStatus(stage, 'opening', '正在打开…', '先确认是不是演示文稿');
}

export function showOpenDownload(stage: HTMLElement, got: number, total: number): void {
  const size = `${fmtMB(got)}${total ? ` / ${fmtMB(total)}` : ''}`;
  paintStatus(stage, 'download', `下载中 · ${size}`, '下载完成后才开始解析，解析与渲染全在本地');
  const bar = stage.querySelector<HTMLElement>('.open-status-bar > i');
  if (bar) bar.style.width = `${total ? Math.min(100, (got / total) * 100) : 0}%`;
}

export function showOpenParsing(stage: HTMLElement, bytes?: number): void {
  const size = bytes && bytes > 0 ? fmtMB(bytes) : '';
  paintStatus(stage, 'parsing', size ? `解析中 · ${size}` : '解析中…', '正在本机解析，文件不会上传');
  const bar = stage.querySelector<HTMLElement>('.open-status-bar > i');
  if (bar) bar.style.width = '100%';
}

export function showOpenError(stage: HTMLElement, reason: string): void {
  paintStatus(stage, 'error', reason);
}

export function showOpenCancelled(stage: HTMLElement, name: string): void {
  paintStatus(stage, 'error', `已取消打开“${name}”`);
}

/** 默认示例不在时回到可拖入，不当成用户指定的失败。 */
export function restoreOpenDropHint(stage: HTMLElement): void {
  delete stage.dataset.openPhase;
  stage.innerHTML =
    '<div id="dropHint">拖入 .pptx / .ppt 文件，或点击右上角「打开文件」<br /><small></small></div>';
}
