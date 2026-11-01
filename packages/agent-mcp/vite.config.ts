import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    copyPublicDir: false, target: 'node22',
    lib: { entry: { 'agent-mcp': 'src/index.ts', cli: 'src/cli.ts' }, formats: ['es'] },
    rollupOptions: {
      external: [
        /^node:/, /^@modelcontextprotocol\/sdk\//, 'zod', '@cfworker/json-schema',
        '@web-ppt/core', '@web-ppt/core/node', '@web-ppt/edit-core', '@web-ppt/edit-core/agent',
      ],
    },
  },
});
