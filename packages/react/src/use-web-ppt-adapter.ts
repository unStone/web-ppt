import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyWebPptAdapterBinding, createWebPptAdapter, WEB_PPT_IDLE_SNAPSHOT,
} from '@web-ppt/editor';
import type {
  WebPptAdapter, WebPptAdapterBinding, WebPptAdapterSnapshot,
} from '@web-ppt/editor';

export interface UseWebPptAdapterResult {
  readonly adapter: WebPptAdapter | null;
  readonly snapshot: WebPptAdapterSnapshot;
  readonly containerRef: (container: HTMLDivElement | null) => void;
}

/** Effect 内创建控制器，React StrictMode 的 setup→cleanup→setup 会得到两份完整生命周期。 */
export function useWebPptAdapter(binding: WebPptAdapterBinding): UseWebPptAdapterResult {
  const live = useRef<WebPptAdapter | null>(null);
  const container = useRef<HTMLDivElement | null>(null);
  const [adapter, setAdapter] = useState<WebPptAdapter | null>(null);
  const [snapshot, setSnapshot] = useState<WebPptAdapterSnapshot>(WEB_PPT_IDLE_SNAPSHOT);

  const containerRef = useCallback((next: HTMLDivElement | null) => {
    container.current = next;
    if (live.current && !live.current.disposed) live.current.attach(next);
  }, []);

  useEffect(() => {
    const current = createWebPptAdapter();
    live.current = current;
    const unsubscribe = current.subscribe(setSnapshot);
    current.attach(container.current);
    setAdapter(current);
    setSnapshot(current.snapshot);
    return () => {
      unsubscribe();
      current.dispose();
      if (live.current === current) live.current = null;
    };
  }, []);

  useEffect(() => {
    if (!adapter) return;
    void applyWebPptAdapterBinding(adapter, binding).catch(() => {
      // onError 与 snapshot 已携带错误；effect 不制造未处理 rejection。
    });
  }, [
    adapter,
    binding.source, binding.session, binding.sessionOwnership, binding.openOptions,
    binding.mode, binding.slideId, binding.zoom, binding.textMode, binding.snapping,
    binding.snapMargins, binding.onLinkFollow,
    binding.onReady, binding.onError, binding.onProgress, binding.onChange, binding.onViewChange,
  ]);

  return { adapter, snapshot, containerRef };
}
