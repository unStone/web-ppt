const PNG_DATA_URL = 'data:image/png;base64,';

/**
 * 同步把画布编码为 PNG 字节。Chromium 的 `toBlob` / `convertToBlob` 把 PNG 编码排进主线程空闲任务：
 * 拿不到空闲周期时先等 1 秒启动超时，启动后被饿住还要等满 5 秒完成超时（可见页面实测 6.7 秒），
 * 而编码本身只要十几毫秒。`toDataURL` 立即在当前任务里编码，主线程开销与强制收尾的 `toBlob` 相同。
 * 污染画布同样抛出 `SecurityError`，调用方据此切换原生文本路径。
 */
export function canvasToPngBytes(canvas: HTMLCanvasElement, label: string): Uint8Array<ArrayBuffer> {
  const url = canvas.toDataURL('image/png');
  // 零尺寸或编码失败时规范返回 "data:,"，不能当作空 PNG 继续交付。
  if (!url.startsWith(PNG_DATA_URL)) throw new Error(`${label}：画布 ${canvas.width}×${canvas.height} 无法编码为 PNG`);
  return Uint8Array.from(atob(url.slice(PNG_DATA_URL.length)), (char) => char.charCodeAt(0));
}
