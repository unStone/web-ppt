# 本机 MCP server 与 Agent Skill

`@web-ppt/agent-mcp` 提供本地 stdio MCP server 和 `web-ppt` Agent Skill。它复用 [命令工具面](agent-command-tools.md)，不包含模型、HTTP 服务、远程传输、字体字节或光栅化器。文稿只在调用方指定的本地路径读写，工具调用不发起网络请求。

## 启动与配置

```bash
npm i @web-ppt/core@next @web-ppt/edit-core@next @web-ppt/agent-mcp@next
web-ppt-agent
```

无配置启动时，结构化编辑、几何 lint 和保存可用。文字检查与 SVG 需要真实 `measureText`，PNG 还需要 `rasterize`。通过本地 JSON 配置注入：

```json
{
  "measureModule": "/absolute/path/runtime.mjs",
  "rasterizerModule": "/absolute/path/runtime.mjs"
}
```

模块分别导出同名函数。路径只指向调用方明确选择的本地文件，不下载模块。stdout 只传 JSON-RPC；启动日志写 stderr。stdin EOF、SIGINT、SIGTERM 和 `ppt_close` 都会释放文档资源。

编程宿主可用 `createAgentMcpServer(options)` 注入同一组选项，或直接创建 `AgentMcpSessionManager`。

## 工具

| 工具 | 必要输入 | 结果 |
|---|---|---|
| `ppt_open` | 本地 `path` | `sessionId` 与解析后的绝对路径 |
| `ppt_describe` | `sessionId` | 当前页面与元素结构 |
| `ppt_element` | `sessionId`、`id`、`query` | 单元素 describe 或当前样式 |
| `ppt_lint` | `sessionId`，可选检查项与阈值 | 当前布局报告 |
| `ppt_render` | `sessionId`、`slideNumber`、`format`，可选输出 `path` | SVG / PNG 数据及可选输出路径 |
| `ppt_edit` | `sessionId`、非空 `commands`，可选 lint | 原子编辑、受影响 ID 与页内 lint |
| `ppt_undo` / `ppt_redo` | `sessionId` | 历史结果与编辑后观察 |
| `ppt_save` | `sessionId`、输出 `path` | 保存模式、OPC 统计与路径；不返回整份 Base64 |
| `ppt_close` | `sessionId` | 关闭确认 |

工具的根输入 Schema 展开到顶层 `properties`，避免客户端把数组或数字强制转换为字符串。命令字段和失败 reason 与 004 一致。`ppt_save` 先原子写入目标，再返回结果；底层需要字节时仍由 `AgentMcpSessionManager.save()` 提供。

## 会话与文件边界

- 同一 `sessionId` 的操作串行执行；并发调用不会交叉编辑、lint 或保存。
- 会话在打开成功后才公开。关闭时先取消活动 lint / render，再释放文档；后续调用返回 `session-disposed` 或 `target-not-found`。
- URL 不作为文件路径接受。打开、保存和渲染只使用调用方给出的本地路径。
- 保存使用同目录临时文件、同步关闭和 rename；失败删除临时文件，不留下半份 PPTX。
- `ppt_save` 根据包状态自动选择补丁或生成保存，不另造保存语义。

错误以 `isError` 返回，JSON 包含 `reason`、`message`、`commandIndex`、`elementId`、`slideNumber`。编辑失败不修改文稿或历史；lint 观察失败与已提交编辑分开表示。

## Agent Skill

`skills/web-ppt/SKILL.md` 遵循 Agent Skills 规范，可用 `skills-ref validate` 校验。它指导 Agent 使用「打开 → describe → 编辑 → lint → render → 保存 → 关闭」循环，并说明稳定 ID、Base64 图片字节、常见 reason 和保存边界。宿主允许 shell 时，可用本地 `base64` 工具取得图片字节，不能用猜测内容替代。
