import type { SlideEditor } from '@web-ppt/editor';
import { setMessage } from './i18n/runtime';
import { message, type SiteNotice } from './i18n/message';

/** 异步预览只能更新自己仍持有的状态，不能盖掉后来打开文件或编辑操作的反馈。 */
export function createEditorFeedback(element: HTMLElement) {
  let revision = 0;
  const notice: SiteNotice = (value, tone = 'normal') => {
    revision++;
    setMessage(element, value);
    element.dataset.tone = tone;
  };
  const reportError = (error: unknown): void => {
    notice(message('操作失败：{detail}', {
      detail: error instanceof Error ? error.message : String(error),
    }), 'error');
  };
  async function previewAnimations(view: SlideEditor | null): Promise<void> {
    if (!view) return;
    notice(message('正在播放当前页元素动画'));
    const owner = revision;
    try {
      const played = await view.previewAnimations();
      if (owner !== revision) return;
      // SDK 的 true 也包括主动取消，不能宣称完整播放成功。
      notice(message(played ? '动画预览已结束' : '当前页没有可播放的元素动画'));
    } catch (error) {
      if (owner === revision) reportError(error);
    }
  }
  return { notice, reportError, previewAnimations };
}
