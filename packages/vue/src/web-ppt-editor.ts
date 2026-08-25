import { computed, defineComponent, h } from 'vue';
import type { PropType } from 'vue';
import type {
  EditorChange, EditorSession, SlideEditor, WebPptAdapter, WebPptAdapterBinding,
  WebPptAdapterCallbacks, WebPptAdapterProgress, WebPptViewOptions, WebPptViewState,
} from '@web-ppt/editor';
import { useWebPptAdapter } from './use-web-ppt-adapter';

export interface WebPptEditorHandle {
  readonly adapter: WebPptAdapter | null;
  readonly session: EditorSession | null;
  readonly view: SlideEditor | null;
  save(): Promise<Uint8Array>;
  undo(): EditorChange | null;
  redo(): EditorChange | null;
}

type BindingProp<Key extends keyof WebPptAdapterBinding> =
  Exclude<WebPptAdapterBinding[Key], undefined>;

export const WebPptEditor = defineComponent({
  name: 'WebPptEditor',
  inheritAttrs: false,
  props: {
    source: { type: null as unknown as PropType<BindingProp<'source'>>, default: null },
    session: { type: Object as PropType<BindingProp<'session'>>, default: null },
    sessionOwnership: { type: String as PropType<BindingProp<'sessionOwnership'>>, default: undefined },
    openOptions: { type: Object as PropType<BindingProp<'openOptions'>>, default: undefined },
    mode: { type: String as PropType<BindingProp<'mode'>>, default: 'edit' },
    slideId: { type: String as PropType<BindingProp<'slideId'>>, default: undefined },
    zoom: { type: Number as PropType<BindingProp<'zoom'>>, default: 1 },
    textMode: { type: String as PropType<BindingProp<'textMode'>>, default: 'auto' },
    snapping: { type: Boolean as PropType<BindingProp<'snapping'>>, default: true },
    snapMargins: {
      type: Object as PropType<BindingProp<'snapMargins'>>,
      default: undefined,
    },
    onLinkFollow: { type: Function as PropType<BindingProp<'onLinkFollow'>>, default: undefined },
  },
  emits: {
    ready: (_session: EditorSession) => true,
    error: (_error: unknown) => true,
    progress: (_progress: WebPptAdapterProgress) => true,
    change: (_change: EditorChange) => true,
    viewChange: (_state: WebPptViewState) => true,
  },
  setup(props, { attrs, emit, expose }) {
    const binding = computed<WebPptAdapterBinding>(() => {
      const common = {
      mode: props.mode,
      slideId: props.slideId,
      zoom: props.zoom,
      textMode: props.textMode,
      snapping: props.snapping,
      snapMargins: props.snapMargins,
      onLinkFollow: props.onLinkFollow,
      onReady: (session: EditorSession) => emit('ready', session),
      onError: (error: unknown) => emit('error', error),
      onProgress: (progress: WebPptAdapterProgress) => emit('progress', progress),
      onChange: (change: EditorChange) => emit('change', change),
      onViewChange: (state: WebPptViewState) => emit('viewChange', state),
      } satisfies WebPptViewOptions & WebPptAdapterCallbacks;
      if (props.session != null && props.source == null && props.sessionOwnership === 'external') {
        return { ...common, session: props.session, sessionOwnership: 'external' };
      }
      if (props.source != null && props.session == null) {
        return { ...common, source: props.source, openOptions: props.openOptions };
      }
      if (props.source == null && props.session == null) {
        return { ...common, source: null, openOptions: props.openOptions };
      }
      // Vue 的运行时 props 无法表达互斥联合；保留非法组合，让共享 adapter 统一发布 error。
      return {
        ...common, source: props.source, session: props.session,
        sessionOwnership: props.sessionOwnership, openOptions: props.openOptions,
      } as unknown as WebPptAdapterBinding;
    });
    const state = useWebPptAdapter(binding);
    const handle: WebPptEditorHandle = {
      get adapter(): WebPptAdapter | null { return state.adapter.value; },
      get session(): EditorSession | null { return state.snapshot.value.session; },
      get view(): SlideEditor | null { return state.snapshot.value.view; },
      save: () => state.adapter.value?.save()
        ?? Promise.reject(new Error('WebPptEditor 尚未挂载')),
      undo: () => state.adapter.value?.undo() ?? null,
      redo: () => state.adapter.value?.redo() ?? null,
    };
    expose(handle);
    return () => h('div', { ...attrs, ref: state.container });
  },
});
