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
| `npm run test:zip` / `npm run test:zip:dist` | 验证恶意 ZIP、声明与实际大小、名称安全、真实 parse / 保存 / OLE 边界及内存上限；分别走源码与发布产物 |
| `npm run schema:describe` | 从 TypeScript 输出类型重新生成 Agent describe 的发布 Schema |
| `npm run schema:lint` / `npm run test:lint` | 生成布局报告 Schema / 验证七项检查、字体服务、实际像素采样和全固件环境对照 |
| `npm run test:describe` / `npm run test:describe:dist` | 结构化读出源码 / 发布入口、Schema 与全部固件跨进程一致性验证 |
| `npm run schema:agent` / `npm run test:agent[:dist]` | 重新生成全命令工具 Schema 与校验器 / 验证源码或发布入口的原子编辑、观察、历史和保存；`test:agent:libreoffice` 补充外部读取器 |
| `npm run test:webmcp` | 验证官网文稿工具注册、真实编辑、渲染、保存重开、取消与生命周期，以及不支持路径的按需边界 |
| `npm run test:site:font-gate` | 验证语言测试的字体完成隔离、真实结果/异常传递与方法/脚本清理；主功能门禁与双语生产回归均自动执行 |
| `npm run schema:fill` / `npm run test:fill[:dist]` | 生成大纲 Schema / 验证模板生成、设计调整、七项检查和源码或独立发布入口；`TEMPLATE_FILL_EXTERNAL` 可指定真实外部模板 |
| `npm run measure:fill` | 实测新入口体积、独立进程冷导入及真实浏览器六页完整生成的时间与内存口径 |
| `npm run fixtures:agent-eval` / `npm run test:agent-eval` | 生成八类评测输入/参考固件 / 验证真实测量、独立判定、生产 MCP 路径与进程记录；不调用模型 |
| `npm run eval:agent` | 自动构建 SDK 后，离线重判已保存的完整证据，不调用模型；默认使用评测记录索引 |
| `npm run eval:agent:run -- --output out/agent-eval/<新目录> --export tooling/agent-eval/records/<新目录>` | 显式调用已登录 Codex 的真实配对评测；参数与边界见[运行指南](agent-evaluation.md) |
| `npm run ppt-samples` | 用 LibreOffice 把 pptx 测试文件转成 `.ppt` 样本（pptx 固件变更后需重跑） |
| `npm run compare public/showcase.pptx` | 用 LibreOffice 生成参考图做并排 / 叠加对比，产出 SSIM / MAE / 热力图 |
| `npm run diff:pptx -- before.pptx after.pptx` | 报告两个 PPTX 新增、删除与变化的 part |
| `npm run bench` | 大文件只读性能基准；追加 `-- --edit` 测编辑投影 |
| `npm run bench:edit` | 210 页独立进程对照，强制检查只读零状态、编辑内存与提交重渲预算 |
| `npm run bench:pdf` | 矢量 PDF 长文稿耗时与内存基准 |
| `npm run demo-gif` | 从样本库下载样本并录 README 用的演示 GIF（需要 Chrome 与 ffmpeg）；`-- swiss` 只录一份，`-- --stills eddi` 逐页截图并导出跳页按钮位置，用来挑分镜 |

## 调试页

| 页面 | 用途 |
|---|---|
| `/` | 查看器：缩略图（虚拟化）/ 缩放 / 搜索 / 备注 / 演示模式 / 导出 |
| `/shapes.html` | 几何调试：全部预设形状实时渲染，可调调节值与宽高比 |

演示模式（工具栏「演示」或 `F`）下才播放切换与动画：`→` 依次推进动画批次，播完再翻页；`Esc` 退出。
