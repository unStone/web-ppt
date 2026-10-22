---
title: MCP server 与 Agent Skill
status: open
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
