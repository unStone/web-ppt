# 本地开发

给贡献者的操作指南（how-to）：启动、构建、对照与基准命令，以及调试页。门禁顺序与约束见 [AGENTS.md](../../AGENTS.md)，测试套件见 [testing.md](testing.md)。

## 命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动 viewer（`?file=/showcase.pptx` 指定文件） |
| `npm run dev:site` | 启动官网（含浏览器内实时 Demo 与编辑器） |
| `npm run check` | 全仓 TypeScript 类型检查（走源码，不需要先构建） |
| `npm test` | 全部功能测试，分套件命令见 [testing.md §8](testing.md#8-测试套件) |
| `npm run build` | 构建全部发布包 |
| `npm run build:site` | 构建官网静态产物 |
| `npm run verify` | 跨产物一致性：许可证 / 版本 / 链接 / 文档数字与实测比对（`-- --net` 另查外链可达） |
| `npm run fixtures` | 重新生成全部测试文件（确定性输出） |
| `npm run schema:describe` | 从 TypeScript 输出类型重新生成 Agent describe 的发布 Schema |
| `npm run schema:lint` / `npm run test:lint` | 生成布局报告 Schema / 验证七项检查、字体服务、实际像素采样和全固件环境对照 |
| `npm run test:describe` / `npm run test:describe:dist` | 结构化读出源码 / 发布入口、Schema 与全部固件跨进程一致性验证 |
| `npm run ppt-samples` | 用 LibreOffice 把 pptx 测试文件转成 `.ppt` 样本（pptx 固件变更后需重跑） |
| `npm run compare public/showcase.pptx` | 用 LibreOffice 生成参考图做并排 / 叠加对比，产出 SSIM / MAE / 热力图 |
| `npm run diff:pptx -- before.pptx after.pptx` | 报告两个 PPTX 新增、删除与变化的 part |
| `npm run bench` | 大文件只读性能基准；追加 `-- --edit` 测编辑投影 |
| `npm run bench:edit` | 210 页独立进程对照，强制检查只读零状态、编辑内存与提交重渲预算 |
| `npm run bench:pdf` | 矢量 PDF 长文稿耗时与内存基准 |
| `npm run demo-gif` | 录 README 用的演示 GIF（需要 Chrome 与 ffmpeg） |

## 调试页

| 页面 | 用途 |
|---|---|
| `/` | 查看器：缩略图（虚拟化）/ 缩放 / 搜索 / 备注 / 演示模式 / 导出 |
| `/shapes.html` | 几何调试：全部预设形状实时渲染，可调调节值与宽高比 |

演示模式（工具栏「演示」或 `F`）下才播放切换与动画：`→` 依次推进动画批次，播完再翻页；`Esc` 退出。
