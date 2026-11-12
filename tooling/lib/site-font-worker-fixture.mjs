import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'vite';

/**
 * esbuild 不改写 new Worker(new URL(...))；源码页面也必须提供生产 Worker 与真实 WASM。
 * HarfBuzz 初始化含顶层 await，而 Oxc 不支持按特性放行，目标版本只能取首个含顶层 await 的 ES2022。
 */
export async function siteFontWorkerFixture(root, out, aliases) {
  const directory = join(out, 'font-worker');
  await build({
    configFile: false,
    root,
    logLevel: 'error',
    resolve: { alias: [...aliases].sort(([a], [b]) => b.length - a.length).map(([find, replacement]) => ({ find, replacement })) },
    build: {
      outDir: directory,
      emptyOutDir: true,
      target: 'es2022',
      lib: { entry: join(root, 'packages/site/src/editor-font-worker.ts'), formats: ['es'], fileName: () => 'editor-font-worker.js' },
    },
  });
  return readdirSync(directory).map((name) => [
    name === 'editor-font-worker.js' ? '/editor-font-worker.ts' : '/' + name,
    [name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', readFileSync(join(directory, name))],
  ]);
}
