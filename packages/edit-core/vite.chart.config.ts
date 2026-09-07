import { defineConfig } from 'vite';
import { minify } from 'terser';

export default defineConfig({
  plugins: [{
    name: 'compact-chart-library',
    async generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) if (chunk.type === 'chunk') {
        // 只压缩排版并保留纯调用注解，使用方仍可继续 tree-shake。
        const result = await minify(chunk.code, {
          module: true, compress: false, mangle: false, format: { preserve_annotations: true },
        });
        if (!result.code) throw new Error('图表库压缩没有产出代码');
        chunk.code = result.code;
      }
    },
  }],
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    lib: { entry: 'src/chart/index.ts', fileName: 'chart', formats: ['es'] },
    rollupOptions: {
      external: [
        '@web-ppt/core', '@web-ppt/core/chart-edit', '@web-ppt/core/geometry',
        '@web-ppt/edit-core', '@web-ppt/edit-core/xml', '@web-ppt/edit-core/opc', 'fflate',
      ],
    },
  },
});
