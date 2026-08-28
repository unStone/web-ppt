import type { WebPptAdapterSnapshot } from './framework-adapter-types';

export const DEFAULT_WEB_PPT_VIEW = Object.freeze({
  mode: 'edit' as const, zoom: 1, textMode: 'auto' as const, snapping: true,
});

/** 空态也是完整受控状态，宿主首帧无需判空后再补默认值。 */
export const WEB_PPT_IDLE_SNAPSHOT: WebPptAdapterSnapshot = Object.freeze({
  status: 'idle', progress: 0, error: null, session: null, view: null, selectionPane: null,
  documentKind: null,
  recovery: null,
  formatPainter: Object.freeze({ active: false, mode: 'inactive', source: null, readonly: true }),
  textSearch: Object.freeze({
    open: false, mode: 'find', query: '', replacement: '',
    scope: Object.freeze({ kind: 'document' }), matchCase: false, wholeWord: false,
    matches: Object.freeze([]), currentIndex: -1, current: null,
    currentInvalidated: false, canReplace: false,
  }),
  mode: DEFAULT_WEB_PPT_VIEW.mode, slideId: null, zoom: DEFAULT_WEB_PPT_VIEW.zoom,
  snapping: DEFAULT_WEB_PPT_VIEW.snapping,
});
