# 编辑器 WebMCP

官网编辑器检测到原生 `document.modelContext.registerTool` 时，按需为当前文稿注册工具。浏览器 Agent 与手动编辑共享同一个 Editor、历史、恢复日志及协同补丁；页面不调用模型服务。

当前接口依据 [Chrome Imperative API](https://developer.chrome.com/docs/ai/webmcp/imperative-api) 和 [WebMCP 草案](https://webmachinelearning.github.io/webmcp/)。Chrome 本地验证可启用 `chrome://flags/#enable-webmcp-testing`；部署使用浏览器要求的 origin trial 配置。没有原生接口时不加载插件，既有编辑流程继续工作。

| 工具 | 输入 | 结果 |
|---|---|---|
| `ppt_describe` | 可选字符预算 | 当前页面、元素身份与内容 |
| `ppt_element` | 元素 `id`、`query` | 元素当前样式或文字属性 |
| `ppt_lint` | 检查项与阈值 | 现有布局报告 |
| `ppt_render` | `slideNumber`、`format`，可选 `scale` | 自包含原生文字 SVG 或 Base64 PNG |
| `ppt_edit` | 非空 `commands`，可选 lint | 原子编辑、受影响对象与布局观察 |
| `ppt_undo` / `ppt_redo` | 空对象 | 同一历史中的撤销或重做 |
| `ppt_save` | 空对象 | 下载 PPTX 副本，返回 `fileName` 与字节数 `bytes` |

输入 Schema 与[命令工具面](agent-command-tools.md)相同，并展开根对象。工具绑定当前文稿，不需要 `sessionId`；保存使用产品交付流程，返回结果不包含整份 PPTX 的 Base64。

```js
const tools = await document.modelContext.getTools();
const describe = tools.find(tool => tool.name === 'ppt_describe');
const result = JSON.parse(await document.modelContext.executeTool(describe, {}));
```

| 边界 | 行为 |
|---|---|
| 写入 | 每次重新核对当前文稿、编辑模式、只读状态、旧 PPT 转换确认和文件任务状态 |
| 并发 | 文稿内调用串行；切换和关闭先注销、取消工具，再等待真实资源使用结束 |
| 取消 | 未提交的命令拒绝；已经提交的命令保留，过期观察返回 `lint.status: failed` |
| 保存 | 生成期间文稿变化则拒绝；下载交付成功后才确认保存点，失败保留脏状态 |
| 字体 | 使用浏览器真实测字；系统字体库存无法精确取得时，字体检查返回 `font-inventory-required` |
| 资源 | 图片尺寸与对比度使用真实浏览器解码；无法加载或解码时明确报错 |

调用返回 `{ ok: true, value }` 或 `{ ok: false, error }`，沿用 Agent 的定位字段。额外 reason 包括 `aborted`、`document-unavailable`、`document-not-writable`、`document-busy`、`document-stale`、`document-changed` 与 `canvas-unavailable`；既有命令和 lint 的 reason 原样保留。

`npm run test:webmcp` 覆盖注册边界、真实编辑与资源处理、历史、IndexedDB 恢复、协同、保存重开及生命周期。注册平台边界替身用于确定性取消与失败注入；原生浏览器发现和调用另行验收，不能将替身断言记为 origin trial 验证。
