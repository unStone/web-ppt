/**
 * 打开态状态栏只报已经知道的标量。
 * 不能读 slides[i]：那会把第十七、十八轮推迟的后页 XML / 图重新解完。
 */

export function formatOpenFileInfo(input: {
  name: string;
  pages: number;
  width: number;
  height: number;
  parseMs: number;
  source?: string;
}): string {
  if (!Number.isFinite(input.pages) || input.pages < 0) {
    throw new Error(`打开态页数无效：${input.pages}`);
  }
  if (!Number.isFinite(input.parseMs) || input.parseMs < 0) {
    throw new Error(`打开态耗时无效：${input.parseMs}`);
  }
  const extra = input.source === 'ppt' ? ' · .ppt 二进制格式' : '';
  return `${input.name} · ${input.pages} 页 · ${input.width | 0}×${input.height | 0}px · ${Math.round(input.parseMs)}ms${extra}`;
}

/** 换文件时上一份的查询不属于新稿；残留查询会在打开成功后把后页全部 inflate。 */
export function resetViewerSearch(query: HTMLInputElement, hitsLabel: HTMLElement): void {
  query.value = '';
  hitsLabel.textContent = '';
  query.disabled = true;
}

export function enableViewerSearch(query: HTMLInputElement): void {
  query.disabled = false;
}
