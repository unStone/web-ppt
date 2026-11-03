# Agent 任务评测

固定同一 Codex CLI、请求 model/effort、提示、工具及预算，比较成功提交自动附带 lint 与移除该字段两种配置。显式 `ppt_lint` 始终保留；模型结果不作为发布门禁。

## 运行命令

先安装仓库依赖。下列自测和重判命令会自动构建 SDK；只有明确的 `eval:agent:run` 才调用模型。

| 命令 | 作用 |
|---|---|
| `npm run fixtures:agent-eval` | 重新生成八类输入与参考文稿及哈希清单；统一 `npm run fixtures` 也包含该步骤 |
| `npm run test:agent-eval` | 运行固件、真实字体、独立判定、生产 MCP 可达性及进程/证据契约，不调用模型 |
| `npm run eval:agent` | 离线重判 `tooling/agent-eval/records/latest.json` 指向的已记录证据，无需模型认证 |
| `npm run eval:agent -- <证据目录>` | 离线重判指定证据目录 |
| `npm run eval:agent:run -- --output out/agent-eval/<新目录> --export tooling/agent-eval/records/<新目录>` | 使用现有 Codex 登录运行真实配对并导出证据；拒绝覆盖已有目录 |

真实运行可指定 `--model`、`--effort`、`--timeout-ms`、`--max-calls`、`--repetitions`，或重复 `--task case-01` 选择任务。未指定 model/effort 时读取现有 Codex 配置并明确记录请求值；原配置及认证材料不复制到证据。

每个任务每轮各运行两种配置，先后顺序交替。默认每次墙钟预算 240 秒、MCP 调用预算 64；这些参数在整个实验中保持一致。运行中 helper、SDK 或指令发生变化时，停止尚未启动的试验并保留记录。

## 证据与判定

| 文件 | 内容 |
|---|---|
| `manifest.json` | 计划、受控参数、源码/依赖、CLI、任务/提示/字体哈希及环境 |
| `runs/<id>/run.json` | 实际启动、退出、超时/取消和预算；未启动也保留 |
| `agent.jsonl` / `agent.stderr.log` | 真实 CLI 输出和错误；CLI 未公开的实际 model 标签明确记为未知 |
| `protocol.jsonl` | 原始和交付 MCP 消息、自动 lint 变换、真实成功保存的文件哈希 |
| `input.pptx` / `result.pptx` | 实际输入和存在时的输出；输出必须对应成功保存调用 |
| `results.json` | 独立重开、完整七项检查、任务/协议/基础设施失败和配对统计 |
| `evidence-manifest.json` | 可移植证据逐文件字节数与哈希，额外文件或篡改都会拒绝 |

仓库证据仅映射宿主绝对路径，原始本机日志仍保存在忽略的 `out/agent-eval/`。离线判定保留记录时和当前判定实现的标识，源码或依赖不同必须明确呈现，不能宣称重现了同一实现。

完成率以计划样本为分母，同时报告已启动、未启动、可评估样本。资源上限、基础设施、协议和任务终止分类互斥，逐原因诊断可能重叠；资源上限必须有 runner 计时或 host 调用计数证据，不把关闭后的次生错误另算平台故障。

另报最终文件语义完成率：它只表示真实保存字节通过正文、可见性、媒体和设计资源保护及完整七项检查，不豁免预算、协议或进程失败。成功执行禁止的增删、隐藏或替换操作同样使完整流程失败。

## 能力边界

本数据集使用固定 OFL Latin 字体和实色背景。测量通过真实 HarfBuzz，字体缺失案例覆盖未注册的 EA 备用声明；未知首选、斜体、缺字和复杂背景采样均显式拒绝，不估算字宽。生产 MCP 外层可能把采样错误映射为 `contrast-resolver-failed`，原始返回不改写。

真实模型前的连接预检只做打开、检查和关闭，日志独立保留，不进入编辑配对样本。正式试验保留全部尝试，不挑选重跑成功数据。有限受控样本只能说明当前配置下的观察结果，不能证明普遍因果收益；[实现决策](../design/agent-task-eval.md)与[任务票据](../wayfinder/ppt-agent-interface/tickets/008-agent-task-eval.md)记录边界和结论。
