import {
  onBeforeUnmount, onMounted, shallowRef, toValue, watchEffect,
} from 'vue';
import type { MaybeRefOrGetter, ShallowRef } from 'vue';
import {
  applyWebPptAdapterBinding, createWebPptAdapter, WEB_PPT_IDLE_SNAPSHOT,
} from '@web-ppt/editor';
import type {
  WebPptAdapter, WebPptAdapterBinding, WebPptAdapterSnapshot,
} from '@web-ppt/editor';

export interface UseWebPptAdapterResult {
  readonly container: ShallowRef<HTMLElement | null>;
  readonly adapter: ShallowRef<WebPptAdapter | null>;
  readonly snapshot: ShallowRef<WebPptAdapterSnapshot>;
}

/** composable 只绑定 Vue 生命周期；文件与 DOM 所有权仍由共享 adapter 决定。 */
export function useWebPptAdapter(
  binding: MaybeRefOrGetter<WebPptAdapterBinding>,
): UseWebPptAdapterResult {
  const container = shallowRef<HTMLElement | null>(null);
  const adapter = shallowRef<WebPptAdapter | null>(null);
  const snapshot = shallowRef<WebPptAdapterSnapshot>(WEB_PPT_IDLE_SNAPSHOT);
  let unsubscribe: (() => void) | null = null;

  onMounted(() => {
    const current = createWebPptAdapter();
    adapter.value = current;
    unsubscribe = current.subscribe((value) => { snapshot.value = value; });
    current.attach(container.value);
    snapshot.value = current.snapshot;
  });
  watchEffect(() => {
    const element = container.value;
    const current = adapter.value;
    if (current && !current.disposed) current.attach(element);
  });
  watchEffect(() => {
    const value = toValue(binding);
    const current = adapter.value;
    if (!current) return;
    void applyWebPptAdapterBinding(current, value).catch(() => {
      // onError 与 snapshot 已携带错误；watchEffect 不制造未处理 rejection。
    });
  });
  onBeforeUnmount(() => {
    unsubscribe?.();
    unsubscribe = null;
    adapter.value?.dispose();
    adapter.value = null;
  });
  return { container, adapter, snapshot };
}
