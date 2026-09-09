import type {FontFaceInfo,FontResult,FontShapeOptions,GlyphRun} from './types';

export const FONT_WORKER_PROTOCOL = 'web-ppt-fonts/1';
export type FontWorkerRequest = {protocol: typeof FONT_WORKER_PROTOCOL; id: number} & (
  | {operation:'register'; face:FontFaceInfo; bytes:Uint8Array}
  | {operation:'shape'; faceId:string; text:string; options:Omit<FontShapeOptions,'signal'>}
  | {operation:'outline'; faceId:string; glyphId:number; purpose:'edit'|'view-print'}
  | {operation:'decode'; bytes:Uint8Array; maxOutputBytes:number}
);
export interface FontWorkerResponse {
  protocol: typeof FONT_WORKER_PROTOCOL;
  id: number;
  result: FontResult<FontFaceInfo | GlyphRun | string | Uint8Array>;
}
export interface FontWorkerEndpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}
export type FontWorker = Pick<Worker,'postMessage'|'addEventListener'|'removeEventListener'|'terminate'>;
