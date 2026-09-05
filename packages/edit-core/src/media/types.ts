import type { SlideId } from '../types';
import type { InsertionRect } from '../commands/insertion-rect';

export interface AddMediaCommand {
  readonly type: 'AddMedia';
  readonly slideId: SlideId;
  readonly rect: InsertionRect;
  readonly source: {
    readonly kind: 'embedded';
    readonly bytes: Uint8Array;
    readonly mime: 'audio/wav';
  };
  readonly poster: {
    readonly bytes: Uint8Array;
    readonly mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
  };
}
