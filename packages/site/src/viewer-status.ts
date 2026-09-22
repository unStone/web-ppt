import { setMessage, setText } from './i18n/runtime';
import type { SiteMessage } from './i18n/message';

export type OpenPhase = 'pending' | 'opening' | 'download' | 'parsing' | 'ready' | 'error';

export function setOpenPhase(stage: HTMLElement, phase: OpenPhase): void {
  stage.dataset.openPhase = phase;
}

/** 下载与本地解析分别显示；两处查看器共用消息绑定，错误参数不进入 HTML。 */
export function createViewerStatus(stage: HTMLElement): {
  status: (value: string | SiteMessage, cls?: string) => void;
  opening: () => void;
  progress: (got: number, total: number) => void;
  parsing: (bytes?: number) => void;
} {
  const fmtMB = (n: number): string => `${(n / 1048576).toFixed(1)}MB`;
  const paintLoading = (phase: Extract<OpenPhase, 'opening' | 'download' | 'parsing'>): void => {
    setOpenPhase(stage, phase);
    stage.innerHTML = '<div class="loading"><div class="loading-label"></div>'
      + '<div class="loading-bar"><i style="width:100%"></i></div>'
      + '<div class="loading-note"></div></div>';
  };
  return {
    status(value, cls = '') {
      setOpenPhase(stage, cls === 'err' ? 'error' : cls === 'spin' ? 'pending' : 'pending');
      const status = document.createElement('div');
      status.className = cls;
      status.style.whiteSpace = 'pre-line';
      setMessage(status, value);
      stage.replaceChildren(status);
    },
    opening() {
      paintLoading('opening');
      setText(stage.querySelector('.loading-label')!, '正在打开…');
      setText(stage.querySelector('.loading-note')!, '先确认是不是演示文稿');
    },
    progress(got, total) {
      const pct = total ? Math.min(100, (got / total) * 100) : 0;
      paintLoading('download');
      const bar = stage.querySelector<HTMLElement>('.loading-bar > i');
      if (bar) bar.style.width = `${pct.toFixed(1)}%`;
      setText(stage.querySelector('.loading-label')!, '下载中 · {size}', {
        size: `${fmtMB(got)}${total ? ` / ${fmtMB(total)}` : ''}`,
      });
      setText(stage.querySelector('.loading-note')!, '下载完成后才开始解析，解析与渲染全在本地');
    },
    parsing(bytes) {
      paintLoading('parsing');
      const size = bytes && bytes > 0 ? fmtMB(bytes) : '';
      if (size) setText(stage.querySelector('.loading-label')!, '解析中 · {size}', { size });
      else setText(stage.querySelector('.loading-label')!, '解析中…');
      setText(stage.querySelector('.loading-note')!, '正在本机解析，文件不会上传');
    },
  };
}
