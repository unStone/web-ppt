import { defineConfig } from 'vite';
export default defineConfig({build:{copyPublicDir:false,emptyOutDir:false,lib:{entry:'src/video.ts',fileName:'video',formats:['es']},rollupOptions:{external:['@web-ppt/core']}}});
