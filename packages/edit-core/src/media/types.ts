import type { ElementId, SlideId } from '../types';
import type { InsertionRect } from '../commands/insertion-rect';

export interface MediaPoster {
  readonly bytes: Uint8Array;
  readonly mime: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp';
}

type MediaSource<K extends 'audio' | 'video'> = {
  readonly kind: 'embedded';
  readonly bytes: Uint8Array;
  readonly mime: K extends 'audio' ? 'audio/wav' : 'video/mp4';
} | {
  readonly kind: 'external';
  readonly mediaKind: K;
  readonly url: string;
};

export type AddMediaCommand = {
  readonly type: 'AddMedia';
  readonly slideId: SlideId;
  readonly rect: InsertionRect;
} & (
  { readonly source: MediaSource<'audio'>; readonly poster?: MediaPoster }
  | { readonly source: MediaSource<'video'>; readonly poster: MediaPoster }
);

export interface ReplaceMediaPosterCommand {
  readonly type: 'ReplaceMediaPoster';
  readonly id: ElementId;
  readonly poster: MediaPoster;
}

export type MediaCommand = AddMediaCommand | ReplaceMediaPosterCommand;
