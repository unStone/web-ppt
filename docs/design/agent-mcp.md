# Agent MCP server 与 Skill：实施计划和技术方案

005 在 004 的传输无关工具面之上增加本机 stdio 适配，不新增编辑语义、模型调用、HTTP 服务或远程文件托管。新发布包命名为 `@web-ppt/agent-mcp`，命令为 `web-ppt-agent`；既有八个包不引入 MCP SDK。

## 1. 技术决策

| 主题 | 方案 | 原因与边界 |
|---|---|---|
| SDK | `@modelcontextprotocol/sdk@1.32.2` 的低层 `Server` + `StdioServerTransport` | v1 仍在维护，低层处理器可直接发布 004 的 Draft-07 Schema；不把命令改写为 Zod。工具根对象解引用后展开到顶层 `properties`，避免客户端把 `allOf` 中的数组/数字按字符串发送。v2 是后续稳定路线，1.0 冻结前单独评估迁移，不与本票混做 |
| 工具 | `ppt_open / ppt_close / ppt_describe / ppt_element / ppt_lint / ppt_render / ppt_edit / ppt_undo / ppt_redo / ppt_save` | 004 的八类工具加打开、关闭；保存和渲染支持调用方指定的本地输出路径 |
| 会话 | stdio 进程内 `session-N` 映射；每个会话一条操作队列 | 打开完成前不公开会话；同一文档的编辑、lint、渲染和保存不并发交叉 |
| 路径 | 只接受调用方给出的本地文件路径，统一 `resolve`；URL 与网络路径显式拒绝 | 不设置隐式工作目录白名单，不读取其他文件；输出默认不覆盖，只有 `ppt_save.path` 可指定覆盖目标 |
| 文件写入 | 同目录临时文件 + flush/close + rename；失败删除临时文件 | 避免保存中断留下半份 PPTX；不修改未指定文件 |
| 生命周期 | 加载、成功、失败、取消、过期五态；关闭时取消活动 lint/render，等待队列后释放文档 | stdout 只走 JSON-RPC，日志只走 stderr；stdin EOF、SIGINT、SIGTERM 都释放全部会话 |
| 注入 | 编程接口接受 `measureText` / `rasterize`；CLI 配置只引用调用方明确的本地模块和字体文件 | 缺少测量或光栅化时沿用稳定 reason，不回退估算；模块不下载、不内置字体字节 |
| 无网络 | stdio 和本地文件是唯一 I/O；测试在协议边界拦截 `fetch`、HTTP(S)、net/tls 请求 | 模型自身的网络服务不在本包；MCP 工具调用不得发起网络请求 |
| 发布 | 九个包统一 `0.7.0-beta.1`；agent-mcp 放在 collab 后最后构建和发布 | 新包首版本地发布后配置 Trusted Publishing，再由 release.yml 接管；既有八包默认闭包逐字节不变 |

SDK 依据：[v1 维护线说明](https://github.com/modelcontextprotocol/typescript-sdk/blob/v1.x/README.md)、[stdio 传输与 stderr 约束](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/serving/stdio.md)。Skill 按 [Agent Skills 规范](https://agentskills.io/specification) 和 [Claude Code 发现规则](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) 提供 `SKILL.md`，不复制完整 API 文档。

## 2. 自底向上实施计划

| 阶段 | 内容 | 首个可验证节点 |
|---|---|---|
| 1. 协议与样本 | 新包 manifest、公开输入/输出类型、会话与路径错误 reason；确定性 `sample-agent-mcp.pptx`（标题、可替换图片、溢出文字、可用版式） | 类型检查失败 → 通过；固件两次生成字节一致；Schema 不另起命令定义 |
| 2. 文件会话 | 本地打开/关闭、会话队列、路径解析、取消与释放、原子保存；复用 `openAgentSession` | Node 契约测试：非法路径、重复关闭、迟到操作、保存失败均无半文件；补丁/生成保存可重开 |
| 3. MCP 协议 | 低层 tools/list 与 tools/call、stdio CLI、错误到 `isError` 的映射、输出内容只含 JSON 文本 | SDK 真实 client 连接 dist 进程，列出全部工具并完成 open → describe → edit → lint → render → save → close |
| 4. Skill | `skills/web-ppt/SKILL.md`：读出 → 编辑 → 检查 → 渲染循环、reason 处理、保存选择和资源注入 | `skills-ref validate`；Claude Code 与 Codex 均能发现并按 Skill 调用，而不是解压 XML |
| 5. 验收与发布 | 网络拦截、外部读取器、真实 Agent 固定任务、性能/包边界、文档与发布流水线 | 全部门禁与固定任务通过后才提交、推送、首发和打 tag |

## 3. 固定 Agent 验收任务

Claude Code 与 Codex 分别在全新会话、独立工作目录中完成同一组任务；模型会话日志、工具调用记录和最终 PPTX 全部落盘到 `out/agent-mcp/evaluations/`。

| 任务 | 机判结果 |
|---|---|
| 改标题 | 第一页目标标题改为指定中 English 混合文本；其他段落不变；撤销/重做各一次后最终值正确 |
| 替换图片 | 指定图片元素替换为固件 PNG；保存包内媒体字节哈希与新图一致，关系目标有效 |
| 新增页面 | 使用现有版式新增一页并写入标题；页序、版式引用和稳定 ID 正确 |
| 修复溢出 | 对刻意溢出的文本执行 autofit 或调整文本框后，`text-overflow` 不再报告该元素；保存后检查仍成立 |

每个 Agent 的最终文件由 core 重开做结构断言，再由 LibreOffice 无修复打开并导出 PDF；macOS 另以 Quick Look 读取。网络拦截覆盖同一工具调用序列，模型服务本身的联网不计入 MCP server。

非交互命令固定使用以下形式，JSONL 原始终端输出与最后回复分别保存；配置和技能目录只指向本次验收工作区：

```bash
claude -p --verbose --output-format stream-json --strict-mcp-config --mcp-config <mcp.json> <任务>
codex exec --json --ephemeral --approve-for-me -C <验收工作区> <任务>
```

## 4. 发布门槛

| 维度 | 必须证据 |
|---|---|
| 协议 | dist stdio client 全链路、非法输入稳定 reason、stdout 无非协议文本、EOF/信号资源释放 |
| 数据 | 原子编辑与保存、路径只限调用方、临时文件清理、无网络调用 |
| Agent | 上表四项任务在真实 Claude Code 与 Codex 均通过，日志不得由脚本伪造 |
| 成本 | agent-mcp 冷启动、tools/list、一次真实任务耗时与堆增量实测；八个既有包默认闭包哈希不变 |
| 发布 | `check → test → build → verify`、外部读取器、九包版本一致、首发引导与 release.yml 顺序更新 |

真实 Claude/Codex 账号、npm 首发权限或 Trusted Publishing 配置若不可用，不记为通过；先完成其余全部验证，再明确报告唯一阻塞项。
