/** JPEG 的 DCT 数据直接交给 PDF 阅读器，不经过有损重编码。 */
export function pdfJpeg(bytes:Uint8Array):{width:number; height:number; compressed:Uint8Array; colorSpace:string} | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  const view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  let width = 0, height = 0, components = 0, scan = false;
  if (bytes.length < 4 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw new Error('PDF JPEG 数据已截断');
  for (let at = 2; at + 3 < bytes.length;) {
    if (bytes[at++] !== 0xff) throw new Error('PDF JPEG 标记无效');
    while (bytes[at] === 0xff) at++;
    const marker = bytes[at++];
    if (marker === 0xda) {scan = true; break;}
    if (marker === 0xd9) break;
    const length = view.getUint16(at);
    if (length < 2 || length > bytes.length - at) throw new Error('PDF JPEG 标记已截断');
    // 带方向或色彩配置的图片需先规范化；不能把原始 DCT 当作显示后的像素。
    if (marker === 0xe1 || marker === 0xe2 || marker === 0xee) throw new Error('PDF JPEG 元数据需要图片规范化');
    if ([0xc0,0xc1,0xc2].includes(marker)) {
      if (width || length < 8 || bytes[at + 2] !== 8) throw new Error('PDF JPEG 帧无效');
      height = view.getUint16(at + 3); width = view.getUint16(at + 5); components = bytes[at + 7];
      if (length !== 8 + components * 3) throw new Error('PDF JPEG 分量无效');
    } else if (marker >= 0xc0 && marker <= 0xcf && ![0xc4,0xc8,0xcc].includes(marker)) throw new Error('PDF JPEG 编码不支持');
    at += length;
  }
  if (!scan || !width || !height || width * height > 16000000 || ![1,3].includes(components)) throw new Error('PDF JPEG 尺寸或颜色模式不支持');
  return {width,height,compressed:bytes,colorSpace:components === 1 ? 'DeviceGray' : 'DeviceRGB'};
}
