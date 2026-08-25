import { createElement, forwardRef, useImperativeHandle } from 'react';
import type { HTMLAttributes } from 'react';
import type {
  EditorChange, EditorSession, SlideEditor, WebPptAdapter, WebPptAdapterBinding,
} from '@web-ppt/editor';
import { useWebPptAdapter } from './use-web-ppt-adapter';

type ContainerProps = Omit<HTMLAttributes<HTMLDivElement>,
  'children' | 'onChange' | 'onError' | 'onProgress'>;

export type WebPptEditorProps = WebPptAdapterBinding & ContainerProps;

export interface WebPptEditorHandle {
  readonly adapter: WebPptAdapter | null;
  readonly session: EditorSession | null;
  readonly view: SlideEditor | null;
  save(): Promise<Uint8Array>;
  undo(): EditorChange | null;
  redo(): EditorChange | null;
}

const EditorComponent = forwardRef<WebPptEditorHandle, WebPptEditorProps>((props, ref) => {
  const {
    source, session, sessionOwnership, openOptions,
    mode, slideId, zoom, textMode, snapping, snapMargins, onLinkFollow,
    onReady, onError, onProgress, onChange, onViewChange,
    ...containerProps
  } = props;
  const binding = {
    source, session, sessionOwnership, openOptions,
    mode, slideId, zoom, textMode, snapping, snapMargins, onLinkFollow,
    onReady, onError, onProgress, onChange, onViewChange,
  } as WebPptAdapterBinding;
  const { adapter, containerRef } = useWebPptAdapter(binding);
  useImperativeHandle(ref, () => ({
    get adapter() { return adapter; },
    get session() { return adapter?.snapshot.session ?? null; },
    get view() { return adapter?.snapshot.view ?? null; },
    save: () => {
      if (!adapter) return Promise.reject(new Error('WebPptEditor 尚未挂载'));
      return adapter.save();
    },
    undo: () => adapter?.undo() ?? null,
    redo: () => adapter?.redo() ?? null,
  }), [adapter]);
  return createElement('div', { ...containerProps, ref: containerRef });
});

EditorComponent.displayName = 'WebPptEditor';
export const WebPptEditor = EditorComponent;
