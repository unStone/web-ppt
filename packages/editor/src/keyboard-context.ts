import type { Editor, SlideId } from '@web-ppt/edit-core';

export interface KeyboardControllerOptions {
  editor: Editor;
  namespace: string;
  slideId(): SlideId;
  gestureActive(): boolean;
}
