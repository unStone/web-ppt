import type { EditorSession } from './session';
import type { WebPptAdapter, WebPptAdapterBinding } from './framework-adapter-types';

/** React/Vue/Svelte/Web Component 只需把受控 props 映射到这一处。 */
export function applyWebPptAdapterBinding(
  adapter: WebPptAdapter,
  binding: WebPptAdapterBinding,
): Promise<EditorSession | null> {
  return adapter.applyBinding(binding);
}
