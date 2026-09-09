import type { Context } from 'cordis';
import { createSiteRecovery, type SiteRecovery } from './editor-recovery';
import type { SiteNotice } from './i18n/message';

declare module 'cordis' {
  interface Context { editorRecovery: SiteRecovery }
}

/** 恢复偏好与尚未完成的恢复选择跨文稿存在，由应用作用域持有。 */
export const editorRecoveryPlugin = {
  name: 'editor-recovery',
  apply(ctx: Context, { notice }: { notice: SiteNotice }) {
    ctx.effect(function* () {
      const recovery = createSiteRecovery(notice);
      yield () => recovery.dispose();
      yield ctx.provide('editorRecovery', recovery);
    });
  },
};
