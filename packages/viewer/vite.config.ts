import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { defineConfig } from 'vite';

const fixtures = resolve(__dirname, '../../fixtures');

export default defineConfig({
  server: { port: 5173 },
  // 测试用的 pptx 样本放在仓库根的 fixtures/，dev server 直接当静态资源服务
  publicDir: '../../fixtures',
  plugins: [
    {
      // 必须在 SPA 回退之前拦截：静态文件没有的 .ppt / .pptx 不能变成首页 HTML。
      name: 'presentation-404',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = decodeURIComponent((req.url ?? '').split('?')[0]);
          if (!/\.(pptx|ppt)$/i.test(path)) {
            next();
            return;
          }
          const file = resolve(fixtures, path.replace(/^\/+/, ''));
          if ((file === fixtures || file.startsWith(fixtures + sep)) && existsSync(file)) {
            next();
            return;
          }
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/plain; charset=utf-8');
          res.end('Not Found');
        });
      },
    },
  ],
});
