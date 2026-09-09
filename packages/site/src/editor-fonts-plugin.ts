import type {Context} from 'cordis';
import {createDocumentFontService} from './editor-document-fonts';
import type {DocumentFontService} from './editor-document-fonts';
import type {EditorSession} from '@web-ppt/editor';

declare module 'cordis' { interface Context {editorFonts: DocumentFontService} }

export const editorFontsPlugin = {
  name:'editor-document-fonts',
  async apply(ctx: Context, {session,signal}: {session: EditorSession; signal: AbortSignal}) {
    await ctx.effect(async function* () {
      const service = createDocumentFontService(session);
      yield () => service.dispose();
      yield ctx.provide('editorFonts',service);
      await service.initialize(signal);
    });
  },
};
