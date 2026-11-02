# GitHub Actions 耗时实测

## 优化前

通过 `gh run list --limit 50` 和分页 jobs API 采集 2026-10-31 至 2026-11-02 的最近 50 次运行，共 71 个 job，包含全部重跑 attempt。统计只取每次运行最新 attempt 中成功完成的 job；[逐 job 数据](ci-jobs-before.csv)保留排队、准备、执行与收尾明细。

| 成功 CI（16 次） | 中位数 | p90 |
|---|---:|---:|
| runner 排队 | 2 秒 | 2 秒 |
| 环境准备及固件生成 | 53 秒 | 63 秒 |
| 执行校验 | 39 分 34 秒 | 40 分 28 秒 |
| job 总耗时 | 40 分 30 秒 | 41 分 39 秒 |

排队采用 job.created_at → started_at；人工重跑前等待和 needs 等待另列，不能当成 runner 排队。运行 `41285530721` 在全部 step 结束后额外等待约一小时才完成，单列收尾，不计入测试时间。

## 真实运行对比

| 运行 | 触发至最终 check 完成 | 结果 |
|---|---:|---|
| [优化前同一源码版本](https://github.com/unStone/web-ppt/actions/runs/41370894820) | 41 分 42 秒 | 成功 |
| [第一轮并行](https://github.com/unStone/web-ppt/actions/runs/41385870740) | 11 分 44 秒 | 21 个 job 成功，墙钟减少 71.9% |
| [第二轮依赖优化](https://github.com/unStone/web-ppt/actions/runs/41387561178) | 8 分 46 秒 | 22 个 job 成功，墙钟减少 79.0% |
| [第三轮关键路径优化](https://github.com/unStone/web-ppt/actions/runs/41389087919) | 7 分 34 秒 | 23 个 job 成功，墙钟减少 81.9% |

第一轮关键路径为 changes → editing → browser → office → check：编辑组准备 32 秒、执行 4 分 47 秒；浏览器组准备 30 秒、执行 2 分 50 秒；外部软件组准备 42 秒、执行 1 分 39 秒。全部 runner 合计 46 分 58 秒，其中准备 8 分 48 秒、执行 36 分 35 秒；并行增加了短环境准备，减少了等待结果的时间。

第二轮依据真实路径独立执行 2 分 11 秒的保存契约，让编辑、浏览器、官网和模型外部打开同时消费产物；官网产物在浏览器 job 结束时立即执行外部打开。OLE 计数也纳入按提交和 run ID 绑定的严格汇总，保证官网总数和 OLE 文档声明都实际参与核对。

第二轮包含连续推送后等待旧运行取消的 31 秒；runner 总耗时 46 分 25 秒。真实汇总核对 53 个计数、OLE 11 项及 959 项一致性检查，最终 check 验证 17 个分组，官网总数及 OLE 声明均未跳过；[逐 job 第二轮数据](ci-jobs-after-round2.csv)保留各阶段耗时。

最终复审进一步把浏览器前 15 条独立测试（45.59 秒）提前并行，只有依赖保存产物的真实官网浏览器测试等待 saving；dist/base 只需 Node 和 jsdom，不再安装字体，减少约 10 秒准备时间。

第三轮的最后完成分支为 build → dist/charts → check，其中图表复验执行 4 分 29 秒。继续把迁移的 45 个独立顶层用例拆为形状矩阵和其余用例两组，源码及产物分别执行；汇总从唯一 cases 对象核对完整用例集合、结果及提交身份，减少图表复验串行等待。

发布的九步显式使用 `--verified-build`，从根构建及 verify 已验证的产物执行真实 prepack、完整性检查后发布 tarball，避免每包重复构建。精确 npm 11.5.1 的九包打包与离线发布 dry-run 校验 898 个 dist 文件的字节及 mtime 未变；没有真实发布或 OIDC 交换。

## 本地构建

| 连续构建 | 优化前 | 完整任务缓存 |
|---|---:|---:|
| 第一次 | 29.56 秒 | 29.25 秒 |
| 第二次 | 29.40 秒 | 0.38 秒 |
| 篡改 core 产物、添加过期 chunk/声明、删除 MCP dist 和入口证明后恢复 | 无缓存 | 0.39 秒，全部文件 SHA-256 一致且无多余输出 |

缓存测试还检查源码输入完整性、Node / 平台 / 架构 / NODE_OPTIONS 等运行环境变化失效，以及 dry/help/未知参数不改变产物。恢复前仅清理九包 dist 和三份明确声明的证明，保留其他 out 文件；仅使用 worktree 本地 Turbo 缓存，Actions 保持 setup-node npm 和 setup-python pip 下载缓存，采样时仓库占用 489 MiB / 10 GiB。

## 约束与验证口径

| 项目 | 保证 |
|---|---|
| 必要套件 | 原功能入口、pre/post 生命周期和产物复验自动展开，新增命令默认进入 editing/base；模型、官网、0.7 与 OLE 的真实软件校验全部保留 |
| 等价指纹 | 四台机器按固件索引分片，每份恰好一次，保留独立进程隔离 |
| 文档提交 | 路径过滤跳过重任务，始终生成原名 check 结论 |
| 连续推送 | PR 按编号取消旧运行，master/main 按 run ID 独立完整执行 |
| 产物复用 | 每次 CI 仅构建一次九包，消费者下载同次运行产物；Pages 仅部署可信 push CI 已验证站点 |
| 发布 | 同 SHA 最新可信 push CI 必须有完整 job/step 证据；文档绿色或证据不完整不能跳过发布门禁 |
| 系统与工具 | 全部通用任务使用 Ubuntu；仓库无 macOS、Go、Rust 或 Docker 构建；审计工具 actionlint 使用官方预编译包并校验 SHA-256 |

本地 `npm run check`、`npm test`、`npm run build`、`npm run verify`、构建缓存恢复验证和新增编排/信任边界测试通过。macOS LibreOffice 的模型全清单在列表文字几何断言处失败，保留原阈值；Ubuntu Actions 的完整清单已通过。官网独立打开、OLE 及 0.7 清单在本机也通过。

纯文档测试 [PR 40](https://github.com/unStone/web-ppt/pull/40) 的 [真实运行](https://github.com/unStone/web-ppt/actions/runs/41387742820)仅 changes/check 成功，其余重任务全部 skipped，验证后已关闭并删除测试分支。连续推送时[旧运行](https://github.com/unStone/web-ppt/actions/runs/41387469738)自动取消，[最新运行](https://github.com/unStone/web-ppt/actions/runs/41387561178)完整通过。
