import { base64ToBytes } from '../clipboard-binary';
import { createImageResource, MAX_REPLACE_IMAGE_BYTES } from '../commands/image-resource';
import { assertDataObject } from '../data-validation';
import { AUDIO_ICON_PNG } from './audio-icon';
import type { MediaPoster } from './types';

export function prepareMediaPoster(poster: MediaPoster | undefined, kind: 'audio' | 'video') {
  const input = poster === undefined && kind === 'audio'
    ? { bytes: base64ToBytes(AUDIO_ICON_PNG), mime: 'image/png' } : poster;
  assertDataObject(input, ['bytes', 'mime'], '媒体海报');
  return createImageResource(input.bytes, input.mime, '媒体海报', MAX_REPLACE_IMAGE_BYTES);
}
