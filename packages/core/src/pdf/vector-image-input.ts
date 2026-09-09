import {readImageMetadata} from '../image-metadata';
import {PdfImageError} from './vector-error';
import type {VectorPdfImageResult} from './vector-types';

export const imageByteLimit = 32 * 1024 * 1024;
export interface PdfImageInput {width:number; height:number; mimeType:string; reason?:string}
export function imageDimensions(width:number,height:number):void {
  if (![width,height].every(v => Number.isSafeInteger(v) && v > 0)) throw new PdfImageError('image-data-invalid');
  if (width * height > 16_000_000) throw new PdfImageError('image-pixel-limit');
}
const ascii = (bytes:Uint8Array,at:number,text:string):boolean => [...text].every((c,i) => bytes[at + i] === c.charCodeAt(0));

function pngReason(bytes:Uint8Array):string | undefined {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let color = false, layout = false, data = false, ended = false;
  for (let at = 8; at < bytes.length;) {
    if (at + 12 > bytes.length) throw new PdfImageError('image-data-invalid');
    const length = view.getUint32(at), type = String.fromCharCode(...bytes.subarray(at + 4,at + 8));
    if (length > bytes.length - at - 12 || (at === 8 && (type !== 'IHDR' || length !== 13))) throw new PdfImageError('image-data-invalid');
    if (type === 'IHDR') {
      if (at !== 8 || length !== 13) throw new PdfImageError('image-data-invalid');
      const depth = bytes[at + 16], mode = bytes[at + 17];
      const valid:Record<number,number[]> = {0:[1,2,4,8,16],2:[8,16],3:[1,2,4,8],4:[8,16],6:[8,16]};
      if (!valid[mode]?.includes(depth) || bytes[at + 18] || bytes[at + 19] || bytes[at + 20] > 1) throw new PdfImageError('image-data-invalid');
      layout ||= depth !== 8 || mode === 3 || bytes[at + 20] !== 0;
    } else if (type === 'IDAT') data = true;
    else if (type === 'IEND') {
      if (length || at + 12 !== bytes.length) throw new PdfImageError('image-data-invalid');
      ended = true;
    } else if (['gAMA','cHRM','iCCP','cICP','eXIf','mDCv','cLLi','sBIT'].includes(type)) color = true;
    else if (['PLTE','tRNS','acTL','fcTL','fdAT'].includes(type)) layout = true;
    else if (!(bytes[at + 4] & 32)) throw new PdfImageError('image-format-unsupported');
    at += length + 12;
  }
  if (!data || !ended) throw new PdfImageError('image-data-invalid');
  return color ? 'image-png-color' : layout ? 'image-png-layout' : undefined;
}

function jpegReason(bytes:Uint8Array):string | undefined {
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let metadata = false, layout = false, scan = false, ended = false, entropy = false;
  for (let at = 2; at < bytes.length;) {
    if (entropy) {while (at < bytes.length && bytes[at] !== 0xff) at++;}
    if (bytes[at++] !== 0xff) throw new PdfImageError('image-data-invalid');
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (entropy && (marker === 0 || (marker >= 0xd0 && marker <= 0xd7))) continue;
    entropy = false;
    if (marker === 0xd9) {ended = at === bytes.length; break;}
    if (at + 2 > bytes.length) throw new PdfImageError('image-data-invalid');
    const length = view.getUint16(at);
    if (length < 2 || length > bytes.length - at) throw new PdfImageError('image-data-invalid');
    metadata ||= [0xe1,0xe2,0xee].includes(marker);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4,0xc8,0xcc].includes(marker)) {
      if (length < 8) throw new PdfImageError('image-data-invalid');
      layout ||= ![0xc0,0xc1,0xc2].includes(marker) || bytes[at + 2] !== 8 || ![1,3].includes(bytes[at + 7]);
    }
    at += length;
    if (marker === 0xda) {scan = true; entropy = true;}
  }
  if (!scan || !ended) throw new PdfImageError('image-data-invalid');
  return metadata ? 'image-jpeg-metadata' : layout ? 'image-jpeg-format' : undefined;
}

/** 魔数与编码尺寸先于解码；不能用 URL 后缀、响应 MIME 或解码后的缩略尺寸绕过预算。 */
export function inspectPdfImage(bytes:Uint8Array):PdfImageInput {
  if (!(bytes instanceof Uint8Array)) throw new PdfImageError('image-data-invalid');
  if (bytes.length > imageByteLimit) throw new PdfImageError('image-byte-limit');
  const mimeType = [137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v) ? 'image/png'
    : bytes[0] === 255 && bytes[1] === 216 ? 'image/jpeg'
    : ascii(bytes,0,'BM') ? 'image/bmp'
    : ascii(bytes,0,'GIF87a') || ascii(bytes,0,'GIF89a') ? 'image/gif'
    : ascii(bytes,0,'RIFF') && ascii(bytes,8,'WEBP') ? 'image/webp' : undefined;
  if (!mimeType) throw new PdfImageError('image-format-unsupported');
  const metadata = readImageMetadata(bytes);
  if (!metadata) throw new PdfImageError('image-data-invalid');
  const {width,height} = metadata; imageDimensions(width,height);
  const reason = mimeType === 'image/png' ? pngReason(bytes) : mimeType === 'image/jpeg' ? jpegReason(bytes) : `image-${mimeType.slice(6)}-format`;
  return {width,height,mimeType,reason};
}

export function validateNormalizedImage(result:VectorPdfImageResult,input:PdfImageInput):void {
  if (!result || !(result.rgba instanceof Uint8Array)) throw new PdfImageError('image-normalizer-result');
  imageDimensions(result.width,result.height);
  if (result.rgba.length !== result.width * result.height * 4 ||
    !((result.width === input.width && result.height === input.height) || (result.width === input.height && result.height === input.width))) {
    throw new PdfImageError('image-normalizer-result');
  }
}
