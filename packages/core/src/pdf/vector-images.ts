import {pdfImage} from './png';
import {pdfJpeg} from './jpeg';
import {zlibSync} from 'fflate';
import {PdfImageError} from './vector-error';
import {imageByteLimit,inspectPdfImage,validateNormalizedImage} from './vector-image-input';
import {VectorDocument,pdfNumber as n} from './vector-document';
import type {VectorResources} from './vector-resources';
import type {VectorPdfImageNormalizer} from './vector-types';

interface ImageResource {name:string; object:number}
export class VectorImages {
  private images = new Map<string,ImageResource>();
  private count = 0;
  constructor(private pdf:VectorDocument,private resources:VectorResources,private signal?:AbortSignal,private normalize?:VectorPdfImageNormalizer) {}
  async dataUri(src:string):Promise<string> {
    const bytes = await this.bytes(src);
    const {mimeType} = inspectPdfImage(bytes);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 16384) binary += String.fromCharCode(...bytes.subarray(offset,offset + 16384));
    return `data:${mimeType};base64,${btoa(binary)}`;
  }
  private abort():void {if (this.signal?.aborted) throw new DOMException('PDF 导出已取消','AbortError');}
  private async bytes(src:string):Promise<Uint8Array> {
    try {return await this.read(src);}
    catch (error) {
      this.abort(); if (error instanceof PdfImageError) throw error;
      throw new PdfImageError('image-fetch-failed');
    }
  }
  private async read(src:string):Promise<Uint8Array> {
    this.abort();
    const response = await fetch(src,{signal:this.signal});
    if (!response.ok) {await response.body?.cancel(); throw new PdfImageError('image-fetch-failed');}
    if (Number(response.headers.get('content-length')) > imageByteLimit) {
      await response.body?.cancel(); throw new PdfImageError('image-byte-limit');
    }
    if (!response.body) throw new PdfImageError('image-data-invalid');
    const reader = response.body.getReader(), chunks:Uint8Array[] = []; let size = 0, done = false;
    try {
      for (;;) {
        this.abort(); const next = await reader.read(); this.abort();
        if (next.done) {done = true; break;}
        size += next.value.length;
        if (size > imageByteLimit) throw new PdfImageError('image-byte-limit');
        chunks.push(next.value);
      }
    } finally {if (!done) await reader.cancel().catch(() => {}); reader.releaseLock();}
    const result = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) {result.set(chunk,offset); offset += chunk.length;}
    return result;
  }
  async draw(src:string,x:number,y:number,width:number,height:number):Promise<string> {
    this.abort();
    if (![x,y,width,height].every(Number.isFinite) || width <= 0 || height <= 0) throw new PdfImageError('image-placement-invalid');
    let resource = this.images.get(src);
    if (!resource) {
      resource = await this.resource(await this.bytes(src)); this.images.set(src,resource);
    }
    return this.place(resource,x,y,width,height);
  }
  async drawBytes(bytes:Uint8Array,x:number,y:number,width:number,height:number):Promise<string> {
    this.abort();
    if (![x,y,width,height].every(Number.isFinite) || width <= 0 || height <= 0) throw new PdfImageError('image-placement-invalid');
    return this.place(await this.resource(bytes),x,y,width,height);
  }
  private async resource(bytes:Uint8Array):Promise<ImageResource> {
    if (this.count >= 4096) throw new PdfImageError('image-count-limit');
    const input = inspectPdfImage(bytes);
    let jpeg:ReturnType<typeof pdfJpeg> = null, image:ReturnType<typeof pdfImage>;
    if (input.reason) {
      if (!this.normalize) throw new PdfImageError(input.reason);
      let result;
      try {result = await this.normalize({bytes,mimeType:input.mimeType,signal:this.signal});}
      catch (error) {
        this.abort(); if (error instanceof PdfImageError) throw error;
        if (error instanceof Error && error.name === 'AbortError') throw error;
        throw new PdfImageError('image-normalization-failed');
      }
      this.abort(); validateNormalizedImage(result,input);
      const count = result.width * result.height, rgb = new Uint8Array(count * 3), alpha = new Uint8Array(count);
      let transparent = false;
      for (let i = 0; i < count; i++) {
        rgb[i * 3] = result.rgba[i * 4]; rgb[i * 3 + 1] = result.rgba[i * 4 + 1]; rgb[i * 3 + 2] = result.rgba[i * 4 + 2];
        alpha[i] = result.rgba[i * 4 + 3]; transparent ||= alpha[i] !== 255;
      }
      image = {width:result.width,height:result.height,compressed:zlibSync(rgb,{level:6}),
        ...(transparent ? {softMask:zlibSync(alpha,{level:6})} : {})};
    } else {
      try {jpeg = pdfJpeg(bytes); image = jpeg ?? pdfImage(bytes,true);}
      catch {throw new PdfImageError('image-data-invalid');}
    }
    this.abort();
    const dimensions = `/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /BitsPerComponent 8 /Interpolate true`;
    const softMask = 'softMask' in image ? image.softMask : undefined;
    const mask = softMask ? this.pdf.stream(softMask,`${dimensions} /Filter /FlateDecode /ColorSpace /DeviceGray`) : undefined;
    const object = this.pdf.stream(image.compressed,`${dimensions} /Filter /${jpeg ? 'DCTDecode' : 'FlateDecode'} /ColorSpace /${jpeg?.colorSpace ?? 'DeviceRGB'}${mask ? ` /SMask ${mask} 0 R` : ''}`);
    return {name:`Im${++this.count}`,object};
  }
  private place(resource:ImageResource,x:number,y:number,width:number,height:number):string {
    this.resources.use('XObject',resource);
    // 页面使用向下的 y 轴；图片行从顶部开始，要在图像矩阵内再翻转一次。
    return `q ${[width,0,0,-height,x,y + height].map(n).join(' ')} cm /${resource.name} Do Q`;
  }
}
