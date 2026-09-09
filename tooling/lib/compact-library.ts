import type { Plugin } from 'vite';
import { minify } from 'terser';

/** Vite 库模式保留的空白可压缩，但纯调用注解必须交给使用方继续 tree-shake。 */
export function compactLibrary(): Plugin {
  return {
    name: 'compact-library',
    async generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') {
        const result = await minify(chunk.code, {
          module: true, compress: false, mangle: true, format: { preserve_annotations: true },
        });
        if (!result.code) throw new Error('库压缩没有产出代码');
        chunk.code = result.code;
      }
    },
  };
}
