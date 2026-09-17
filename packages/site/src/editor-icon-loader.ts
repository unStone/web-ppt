export function activateEditorIcons(signal: AbortSignal): void {
  void import('./editor-icons').then(module => module.activateEditorIcons(signal));
}
