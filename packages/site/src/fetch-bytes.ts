/**
 * 带进度的字节下载，首页与样本页共用。
 *
 * 远程样本有好几 MB，走的是别人的网络，跟引擎快慢没有半点关系 ——
 * 只转个圈会让人把等待算到渲染头上，而这恰恰是本项目最不该被误解的地方。
 * 所以下载单独报进度，调用方也单独把耗时列出来。
 */
export interface Fetched {
  bytes: ArrayBuffer;
  /** 下载耗时（毫秒），不含解析 */
  ms: number;
}

export async function fetchBytes(
  src: string,
  onProgress: (got: number, total: number) => void,
): Promise<Fetched> {
  const t0 = performance.now();
  const res = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  // Content-Length 可能没有（分块传输）：那就只报已下载量，不画百分比
  const total = Number(res.headers.get('content-length')) || 0;
  if (!res.body) {
    // 老浏览器没有流，退回一次性读取
    return { bytes: await res.arrayBuffer(), ms: performance.now() - t0 };
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  let painted = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    // 每 64KB 更新一次就够了，每个分块都重排 DOM 反而拖慢下载
    if (got - painted > 65536) {
      painted = got;
      onProgress(got, total);
    }
  }
  const merged = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    merged.set(c, at);
    at += c.length;
  }
  return { bytes: merged.buffer, ms: performance.now() - t0 };
}

/** 下载失败的说法：网络的锅就说网络，别把 HTTP 码甩给用户 */
export const whyFailed = (e: unknown): string =>
  e instanceof TypeError ? '网络不通' : e instanceof Error ? e.message : String(e);
