---
title: 编辑器 WebMCP
status: closed
assignee: codex
priority: P3
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./004-command-tool-surface.md
---

## Question

浏览器内 Agent 怎样直接编辑官网编辑器中当前打开的文稿，且改动进入同一套历史与恢复？

## 范围

| 部分 | 说明 |
|---|---|
| 注册 | 官网 Cordis 插件在浏览器支持 WebMCP 时注册 004 的同一组工具；启动时按当时规范草案核对接口名 |
| 作用域 | 工具绑定当前文稿作用域，切换或关闭文稿时注销 |
| 历史 | 工具编辑进入编辑器历史、崩溃恢复与协同，与手动编辑一致 |
| 降级 | 不支持时不注册、不报错、不加载插件代码 |

## 完成条件

- 在开启 origin trial 的 Chrome 中，端到端完成 005 任务清单中的浏览器适用部分。
- 不支持 WebMCP 的浏览器中，编辑页激活闭包体积与行为不变（现有站点预算与浏览器回归通过）。
- 文稿切换、关闭与重新打开后，工具注册状态正确，有浏览器测试覆盖。
- 发布 SDK 不变。

## 不做

- 不依赖 Chrome 内置模型；不在页面内调用任何模型。

## Answer

官网 Cordis 文稿插件按当前 `document.modelContext` 接口注册八个 `ppt_*` 工具，复用 004 输入 Schema 与当前 Editor；保存走文件任务、序列化及下载后确认保存点。工具串行执行，切换和退出先注销、取消，再等待真实资源使用结束。发布 SDK 不新增接口。[API](../../../api/agent-webmcp.md) · [技术方案](../../../design/agent-webmcp.md)。

## Resolution

| 维度 | 证据 |
|---|---|
| 浏览器契约 | `npm run test:webmcp`：127 项断言，真实编辑、历史、IndexedDB 恢复、协同、保存重开、SVG/PNG、取消与注册边界；注册平台可注入失败，不将替身记为原生验收 |
| 原生接口 | Chrome 156.0.8078.74 启用官方 `--enable-features=WebMCP`，中英文实际官网经原生 `getTools/executeTool` 完成改标题、全稿改字、换图、新建页、溢出修复、撤销重做、渲染与真实下载；下载字节一致且官网重开语义一致。`out/webmcp/native-browser.json`、`native-editor-{zh-CN,en}.png` |
| 外部读取 | 中英文三页原生下载产物均由 LibreOffice 打开并导出 PDF，Quick Look 分别生成有效缩略图；`out/webmcp/native-{zh-CN,en}-libreoffice.log`、`out/webmcp/quicklook/`。Windows PowerPoint 真机继续暂缓，未计为通过 |
| 不支持路径 | 契约验证无注册、手动编辑及撤销可用；metafile 和资源请求验证 WebMCP 分块未加载；禁用注册的独立变异构建触发八工具断言失败 |
| 既有流程 | 生命周期专项验证 OPFS 写入等待、保存重开、应用卸载、未提交导出取消及已提交 PDF/ZIP 交付；`out/webmcp/site-lifecycle-budget-final.log` |
| 默认成本 | 首屏 19014B raw / 6154B gzip，首次激活合计 2372844B raw / 558710B gzip，原预算 2397467B / 558749B 未调整。保存与图片交付按需加载，`out/site-editor-browser/cordis-size.json` |
| 新增按需成本 | 相对已激活应用扣除共享分块，插件新增静态闭包 2552214B raw / 237217B gzip；五个独立 Chrome 开发页面样本：八工具注册中位 3.3ms，首次注册到可发现且 describe 成功 18.1ms，固件打开到可用 316.3ms（含解析、换稿、字体与插件加载），该完整打开过程 GC 后保留堆增量约 32.2MB。不是纯插件内存或生产耗时，见 `out/webmcp/performance.json` |
| 固件 | `sample-agent-webmcp.pptx` 连续生成两次 SHA-256：`59067cc904a5c5a6ef3eca980dd83274319eb9e0f70db176ae9ff705a7d8d4e0` |
| 仓库门禁 | `check → test → build → verify` 全部通过；180 份固件、1206 对编辑等价指纹一致，127 项 WebMCP 浏览器断言，全部发布入口复验通过；`out/webmcp/gates.json` 及 `final-{check,test,build,verify}.log` |

2026-11-02 关闭。前序验收同步修复超链接目标误判、MCP 文件任务交付顺序及写入前清除脏状态；命令工具面 79 项、本机 MCP 57 项回归通过。
