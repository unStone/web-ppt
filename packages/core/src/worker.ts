/**
 * 解析 Worker 入口。
 *
 * 解析一份 200 页的文件在主线程要 ~380ms，足以让 UI 卡顿一整帧序列。
 * 放进 Worker 后主线程零阻塞。
 *
 * 图片不能在 Worker 里建 blob URL——那样的 URL 主线程用不了。
 * 因此 Worker 输出 `asset:N` 令牌 + 原始字节，由主线程兑现成真实 URL。
 */
import { parsePptxDeferred } from './pptx/parser';

export interface WorkerRequest {
  id: number;
  bytes: ArrayBuffer;
}

export interface WorkerResponse {
  id: number;
  ok: boolean;
  /** 序列化后的 Presentation（图片为 asset:N 令牌） */
  presentation?: unknown;
  assets?: { mime: string; data: ArrayBuffer }[];
  error?: string;
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { id, bytes } = e.data;
  try {
    const view = new Uint8Array(bytes);
    if (!(view[0] === 0x50 && view[1] === 0x4b)) {
      throw new Error('Worker 仅支持 .pptx；.ppt 请在主线程解析');
    }
    const { presentation, assets } = parsePptxDeferred(view);

    // dispose 是函数，无法结构化克隆，剥掉
    const { dispose, ...plain } = presentation;
    void dispose;

    const buffers = assets.map((a) => {
      // 复制一份出来才能作为 transferable，避免动到原 zip 内存
      const copy = a.data.slice();
      return { mime: a.mime, data: copy.buffer as ArrayBuffer };
    });

    const res: WorkerResponse = { id, ok: true, presentation: plain, assets: buffers };
    (self as unknown as Worker).postMessage(res, buffers.map((b) => b.data));
  } catch (err) {
    const res: WorkerResponse = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(res);
  }
};
