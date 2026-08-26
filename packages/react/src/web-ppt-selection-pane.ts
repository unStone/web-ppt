import {
  createElement, forwardRef, useEffect, useImperativeHandle, useRef,
} from 'react';
import type { HTMLAttributes } from 'react';
import type { SelectionPane, WebPptAdapter } from '@web-ppt/editor';

export type WebPptSelectionPaneProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
  readonly adapter: WebPptAdapter | null;
};

export interface WebPptSelectionPaneHandle {
  readonly pane: SelectionPane | null;
}

const SelectionPaneComponent = forwardRef<
WebPptSelectionPaneHandle, WebPptSelectionPaneProps
>(({ adapter, ...containerProps }, ref) => {
  const container = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!adapter || adapter.disposed) return;
    adapter.attachSelectionPane(container.current);
    return () => {
      if (!adapter.disposed) adapter.attachSelectionPane(null);
    };
  }, [adapter]);
  useImperativeHandle(ref, () => ({
    get pane() { return adapter?.snapshot.selectionPane ?? null; },
  }), [adapter]);
  return createElement('div', { ...containerProps, ref: container });
});

SelectionPaneComponent.displayName = 'WebPptSelectionPane';
export const WebPptSelectionPane = SelectionPaneComponent;
