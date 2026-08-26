import {
  defineComponent, h, onBeforeUnmount, shallowRef, watchEffect,
} from 'vue';
import type { PropType } from 'vue';
import type { SelectionPane, WebPptAdapter } from '@web-ppt/editor';

export interface WebPptSelectionPaneHandle {
  readonly pane: SelectionPane | null;
}

export const WebPptSelectionPane = defineComponent({
  name: 'WebPptSelectionPane',
  inheritAttrs: false,
  props: {
    adapter: { type: Object as PropType<WebPptAdapter | null>, default: null },
  },
  setup(props, { attrs, expose }) {
    const container = shallowRef<HTMLElement | null>(null);
    let attached: WebPptAdapter | null = null;
    watchEffect(() => {
      const adapter = props.adapter;
      const element = container.value;
      if (attached && attached !== adapter && !attached.disposed) attached.attachSelectionPane(null);
      attached = adapter;
      if (adapter && !adapter.disposed) adapter.attachSelectionPane(element);
    });
    onBeforeUnmount(() => {
      if (attached && !attached.disposed) attached.attachSelectionPane(null);
      attached = null;
    });
    expose({
      get pane(): SelectionPane | null { return props.adapter?.snapshot.selectionPane ?? null; },
    } satisfies WebPptSelectionPaneHandle);
    return () => h('div', { ...attrs, ref: container });
  },
});
