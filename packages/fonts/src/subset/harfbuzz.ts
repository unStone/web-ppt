import type { FontSubsetter } from '@web-ppt/core';

/**
 * hb-subset wasm 的最小 ABI 面。harfbuzzjs 只随包分发 wasm（`dist/harfbuzz-subset.wasm`），
 * 没有子集化的 JS 胶水，这里手工绑定用到的符号；符号集已在 1.6.1 上核对闭环。
 */
interface SubsetModule {
  memory: WebAssembly.Memory;
  malloc(size: number): number;
  free(ptr: number): void;
  /** standalone 构建；调用其余导出前必须先初始化 */
  _initialize?(): void;
  hb_blob_create(data: number, length: number, mode: number, user_data: number, destroy: number): number;
  hb_blob_destroy(blob: number): void;
  hb_blob_get_length(blob: number): number;
  hb_blob_get_data(blob: number, length: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(face: number): void;
  hb_face_reference_blob(face: number): number;
  hb_set_add(set: number, codepoint: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(input: number): void;
  hb_subset_input_unicode_set(input: number): number;
  /** 变量字体钉到默认实例；不钉的话 hb-subset 按轴范围实例化，结果不是常规体 */
  hb_subset_input_pin_all_axes_to_default(input: number, face: number): void;
  hb_subset_or_fail(face: number, input: number): number;
}

/** hb_memory_mode_t：READONLY 表示 hb 不复制不接管，内存由本适配器 free */
const HB_MEMORY_MODE_READONLY = 1;

const FAIL = { ok: false as const, reason: 'subset-failed' as const };

/**
 * 用 harfbuzzjs 的 `harfbuzz-subset.wasm` 构造导出子集化引擎。
 *
 * 与 `glyphs/harfbuzz` 的整形适配器同一形态：wasm 字节由宿主提供（vite 里
 * `import wasmUrl from 'harfbuzzjs/dist/harfbuzz-subset.wasm?url'` 后 fetch），
 * 本包不携带、不下载任何字体字节或 WASM。
 *
 * 确定性：hb-subset 对同输入同参数输出相同字节；本函数不引入时间戳与随机数，
 * 满足 `FontSubsetter` 的快照要求。
 */
export function createHarfBuzzSubsetter(wasm: BufferSource): Promise<FontSubsetter> {
  return WebAssembly.instantiate(wasm, {}).then(({ instance }) => {
    const hb = instance.exports as unknown as SubsetModule;
    if (typeof hb.hb_subset_or_fail !== 'function' || !hb.memory || typeof hb.malloc !== 'function') {
      throw new Error('传入的 wasm 不是 harfbuzz-subset 构建：缺少 hb_subset_or_fail / memory / malloc 导出');
    }
    hb._initialize?.();
    let disposed = false;

    const subset = async (input: Parameters<FontSubsetter['subset']>[0]) => {
      if (disposed) throw new Error('subsetter 已释放，不能继续子集化');
      // hb-subset 只认 sfnt；WOFF/WOFF2 容器交给调用方按 reason 回退整字体
      if (input.mime !== 'font/ttf' && input.mime !== 'font/otf') return FAIL;
      const { bytes } = input;

      // malloc 可能扩容线性内存，之后必须取新的视图再写入
      const src = hb.malloc(bytes.length);
      if (!src) return FAIL;
      let blob = 0;
      try {
        new Uint8Array(hb.memory.buffer).set(bytes, src);
        blob = hb.hb_blob_create(src, bytes.length, HB_MEMORY_MODE_READONLY, 0, 0);
        if (!blob) return FAIL;
        const face = hb.hb_face_create(blob, 0);
        if (!face) return FAIL;
        try {
          const subsetInput = hb.hb_subset_input_create_or_fail();
          if (!subsetInput) return FAIL;
          try {
            const unicodes = hb.hb_subset_input_unicode_set(subsetInput);
            for (const ch of input.chars) hb.hb_set_add(unicodes, ch.codePointAt(0) ?? 0);
            hb.hb_subset_input_pin_all_axes_to_default(subsetInput, face);
            const subsetFace = hb.hb_subset_or_fail(face, subsetInput);
            if (!subsetFace) return FAIL;
            try {
              const outBlob = hb.hb_face_reference_blob(subsetFace);
              if (!outBlob) return FAIL;
              try {
                const length = hb.hb_blob_get_length(outBlob);
                const data = hb.hb_blob_get_data(outBlob, 0);
                if (!length || !data) return FAIL;
                // 子集化过程可能再次扩容内存；读取时取最新视图，并拷出独立缓冲
                const copy = new Uint8Array(hb.memory.buffer).slice(data, data + length);
                return { ok: true as const, bytes: copy, mime: input.mime };
              } finally {
                hb.hb_blob_destroy(outBlob);
              }
            } finally {
              hb.hb_face_destroy(subsetFace);
            }
          } finally {
            hb.hb_subset_input_destroy(subsetInput);
          }
        } finally {
          hb.hb_face_destroy(face);
        }
      } finally {
        if (blob) hb.hb_blob_destroy(blob);
        hb.free(src);
      }
    };

    return {
      subset,
      dispose() {
        // wasm 实例与线性内存没有显式释放接口；解除引用交给 GC，标记防止后续误用
        disposed = true;
      },
    };
  });
}
