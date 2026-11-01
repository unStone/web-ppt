---
title: MCP server 与 Agent Skill
status: closed
priority: P2
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./003-node-render.md
  - ./004-command-tool-surface.md
---

## Question

本机 Agent 怎样通过 MCP 打开、读出、检查、渲染、编辑并保存文稿，且文件不离开本机？

## 范围

| 部分 | 说明 |
|---|---|
| MCP server | 独立 Node 包，stdio 传输；工具即 004 的工具面加打开、保存、渲染；只读写调用方指定路径 |
| 依赖 | MCP SDK 只在该包中出现；字体与光栅化通过配置注入 |
| Agent Skill | 说明「读出 → 编辑 → 检查 → 渲染」循环、常见 reason 的处理方式及保存选择 |
| 发布 | 新包首版本地发布后在 npm 配置 Trusted Publishing，之后进入 `release.yml` 的发布顺序 |

## 完成条件

- 固定任务清单（改标题、替换图片、新增页面、修复溢出等，清单写入本票 Answer）在真实 Claude Code 与 Codex 会话中完成，会话记录与产物落盘。
- 保存产物由 LibreOffice 与独立读取器无修复打开。
- 工具调用不发起网络请求，有测试覆盖。
- 包体积与冷启动耗时实测登记；八个既有发布包体积不变。

## 不做

- 不提供 HTTP / 远程传输，不托管文件。

## Answer

采用独立 `@web-ppt/agent-mcp` 包和低层 `Server` + `StdioServerTransport`，提供 `ppt_open / ppt_close / ppt_describe / ppt_element / ppt_lint / ppt_render / ppt_edit / ppt_undo / ppt_redo / ppt_save` 十类工具。004 的根 Schema 解引用后展开到顶层，避免 Claude Code 将数组/数字按字符串发送。会话串行，关闭取消活动检查；保存先写同目录临时文件再 rename，协议只返回路径与统计，不返回整份 Base64。配置仅注入本地测量和光栅化模块。[API](../../../api/agent-mcp.md)，[实施计划与决策](../../../design/agent-mcp.md)。

固定验收任务：改标题正文为“季度汇报 Q4”、用 `replacement.png` 替换指定图片、使用现有版式新增一页并写入“新增页面”、修复指定元素的 `text-overflow`。Claude Code 与 Codex 均在真实会话完成并保存 `final.pptx`；机判检查页数、标题、图片字节哈希和 lint，再由 LibreOffice 与 Quick Look 打开。日志和证据位于 `out/agent-mcp/evaluations/`。

## Resolution

- 真实 Claude Code 与 Codex 的四项固定任务、标题 / 页数 / 图片哈希 / lint 机判、LibreOffice 与 Quick Look 外部读取全部通过；原始会话与证据落盘。
- dist stdio、文件会话串行、关闭取消、原子保存、根 Schema、消费方类型与无网络调用测试通过；`skills-ref` 校验通过。
- 默认入口 2880B gzip；5 个独立进程中位数冷加载 91.63ms、编辑观察 8.19ms、堆增量 19827544B。八个既有包默认闭包逐字节不变。
- `check → test → build → verify` 门禁通过，九包版本统一为 `0.7.0-beta.1`。
