/**
 * 查看器与样本预览地址里的打开参数。
 *
 * 只认查询串 `p`（1-based）和查看器的 `file`。hash 不读——两套语法会让分享链接分裂。
 * 改写走 replaceState：翻页或换本地文件不该往历史栈里堆条目，后退应离开这一次打开。
 */

function replaceSearch(mutate: (params: URLSearchParams) => void): void {
  const url = new URL(location.href);
  mutate(url.searchParams);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${location.pathname}${location.search}${location.hash}`;
  if (next === current) return;
  history.replaceState(history.state, '', next);
}

export function parseOpenPage(raw: string | null): number {
  if (raw == null || raw === '') return 1;
  if (!/^[0-9]+$/.test(raw)) return 1;
  const page = Number(raw);
  if (!Number.isSafeInteger(page) || page < 1) return 1;
  return page;
}

export function clampOpenPage(page: number, count: number): number {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`无法落到第 ${page} 页：文稿没有幻灯片（${count}）`);
  }
  if (!Number.isInteger(page) || page < 1) {
    throw new Error(`页码必须是 ≥1 的整数，实际是 ${page}`);
  }
  return Math.min(page, count);
}

export function writeOpenPageParam(page1: number): void {
  if (!Number.isInteger(page1) || page1 < 1) {
    throw new Error(`回写页码必须是 ≥1 的整数，实际是 ${page1}`);
  }
  replaceSearch((params) => {
    if (page1 === 1) params.delete('p');
    else params.set('p', String(page1));
  });
}

export function clearOpenPageParam(): void {
  writeOpenPageParam(1);
}

/** 本地文件写不进地址；留下 ?file= 会让复制和刷新打开另一份。 */
export function clearOpenFileParam(): void {
  replaceSearch((params) => {
    params.delete('file');
  });
}
