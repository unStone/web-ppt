import { setMessage, setText } from './i18n/runtime';
import type { SiteMessage } from './i18n/message';

/** 下载与本地解析分别显示；两处查看器共用消息绑定，错误参数不进入 HTML。 */
export function createViewerStatus(stage: HTMLElement): {
  status: (value: string | SiteMessage, cls?: string) => void;
  progress: (got: number, total: number) => void;
} {
  const fmtMB = (n: number): string => `${(n / 1048576).toFixed(1)}MB`;
  return {
    status(value, cls = '') {
      const status = document.createElement('div');
      status.className = cls;
      status.style.whiteSpace = 'pre-line';
      setMessage(status, value);
      stage.replaceChildren(status);
    },
    progress(got, total) {
      const pct = total ? Math.min(100, (got / total) * 100) : 0;
      stage.innerHTML = '<div class="loading"><div class="loading-label"></div>'
        + `<div class="loading-bar"><i style="width:${pct.toFixed(1)}%"></i></div>`
        + '<div class="loading-note"></div></div>';
      setText(stage.querySelector('.loading-label')!, '下载中 · {size}', {
        size: `${fmtMB(got)}${total ? ` / ${fmtMB(total)}` : ''}`,
      });
      setText(stage.querySelector('.loading-note')!, '下载完成后才开始解析，解析与渲染全在本地');
    },
  };
}
