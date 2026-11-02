# 发布与 CI 运维

给维护者的操作指南（how-to）：四条 GitHub workflow 的行为、发版 checklist、已知的坑。日常命令约定见 [AGENTS.md](../../AGENTS.md)。

## 1. 四条流水线

| workflow | 触发 | 职责 |
|---|---|---|
| `ci.yml` | push 到 master / main、PR 或手动 | 从唯一功能入口展开源码和发布产物分组；类型 / 固件、独立进程等价、功能和性能采样并行，汇总检查核对覆盖与报告完整性 |
| `release.yml` | 推 `v*` tag 或手动 | 见 §2，发布九个包到 npm |
| `powerpoint.yml` | 仅 `workflow_dispatch`，限 master / tag | 装有桌面 Office 的自托管 Windows 机器执行真机门禁（不跑 PR 代码），运行手册见 [powerpoint-runner.md](powerpoint-runner.md) |
| `pages.yml` | master / main 的成功 push CI 完成，或手动指定 CI run_id | 下载该次 CI 已验证的站点产物后部署；不重复安装依赖、构建和测试；纯文档及过期自动部署跳过 |

PR 连续推送通过 `cancel-in-progress` 取消旧运行；master / main 的 CI 使用每次运行独立的并发组，逐提交完整执行。路径过滤只跳过文档提交的重任务，始终生成 `check` 结论。

官网只接受本仓库 master / main 上由 `ci.yml` 触发且成功完成的 push 运行。自动部署还要求该提交仍为分支 HEAD，避免较旧 CI 晚完成后覆盖新站点；手动指定 `run_id` 可以重部署仍未过期的历史产物，没有 `site-dist` 或产物已过期时明确失败。

## 2. 发版 checklist

| # | 动作 | 说明 |
|---|---|---|
| 1 | 九个包 `package.json` 版本改成同一个值 | 流水线第一步逐包校验 tag 与版本一致，不一致直接失败 |
| 2 | 更新 `CHANGELOG.md` | 当前版本条目会被 verify 审计（如 collab 的双体积口径：发布入口 KB gzip + 测试薄包 B gzip，两者缺一 verify 红） |
| 3 | 本地过四门禁 `npm run check && npm test && npm run build && npm run verify` | verify 必须在 build 之后（读 dist 体积）且在 test 之后（读 `out/verify/counts.json` 断言数） |
| 4 | `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z` | OIDC Trusted Publishing，**Secrets 里不存任何 npm 凭据** |

流水线内部顺序：**门禁信任判定** → `npm ci` → Python / 中文字体及必要的 LibreOffice 环境准备 → tag 版本校验 → [`check`] → npm 首发引导校验 → `fixtures` → [`test:functional` → 性能采样（不阻断）→ 编辑性能预算] → `build` → `verify` → 按 `core → edit-core → viewer-core → editor → react → vue → fonts → collab → agent-mcp` 顺序发布（peer 依赖序，不能反）。

方括号里的四步及 LibreOffice 安装只在**门禁信任判定**拿不到绿色时执行。判定逻辑（`tooling/check-ci-green.mjs`）：查询 tag 指向的 commit 上可信 `push` CI 的完整门禁证据；纯文档跳过的绿色运行不作为全量通过证据。查无完整运行、run 未完成、结论非 success 或 API 请求失败一律全量跑；判定用 `git rev-parse "<ref>^{commit}"` 解引用 annotated tag，CI run 按 commit SHA 索引。

跳过 `test:functional` 时 verify 的断言数核对会黄字跳过（`out/verify/counts.json` 不存在）；该核对已由同 commit 的 CI verify 覆盖，不构成发布盲区。`fixtures` 生成不可跳：verify 的 `--dist` 测试要读固件。verify 链对测试落盘依赖的三处降级（`verify-v08-readiness` 的产物检查、`measure-expanded` 的套件计数、`verify-consistency` 的 counts）在快路径下黄字跳过、全量路径行为不变——完整性均由同 commit 的 CI 覆盖。

## 3. Trusted Publishing（OIDC）的环境要求

| 要求 | 原因 |
|---|---|
| Node ≥ 22.14.0，npm ≥ 11.5.1 且**钉在 11.x** | npm 12.0.2 实测在环境完全达标时仍报 ENEEDAUTH，不发起 OIDC 交换 |
| `permissions.id-token: write` | 换取短期发布令牌，缺了会退回要 NPM_TOKEN |
| setup-node **不设 `registry-url`** | 它会写带空 `NODE_AUTH_TOKEN` 的 .npmrc；npm 拿空凭据发布时，scoped 包返回 404 而非 401，极难排查 |
| 新包第一版**走不了 OIDC** | npm 只允许已存在的包配置 Trusted Publishing；先本地 `npm publish` 发一版，再去 npm 包设置配 trusted publisher。流水线有「首发引导校验」步骤会提前报出缺的包 |

## 4. 重跑与跳过的语义

- 发布用 `tooling/publish-if-new.sh`：registry 已有该版本就跳过。九步串行发布中间挂掉后整个 job 重跑，没有这层守卫，前面已成功的包会以 EPUBLISHCONFLICT 再次弄红，埋掉真正的失败原因。
- 门禁信任判定（§2）只在目标 commit 的 push CI 绿时跳过重复门禁；rerun 失败的 release 时若 CI 也红了，会自动回退全量路径，不需要人工干预。
- LibreOffice 缺席时图元测试合法跳过 22 项，但 verify 按文档声明的完整 130 项拒绝发布；发布全量路径显式安装 `libreoffice-impress`，快路径复用同提交完整 CI 的证据。中文字体与 PDF 读取依赖始终安装，保持发布产物复验环境一致。
- 性能采样与编辑性能预算在 beta 阶段 `continue-on-error`：保留红灯证据但不让受宿主负载干扰的 p95 阻断发布（见 [testing.md](testing.md#7-性能门禁的现状)）。

## 5. 常见失败速查

| 症状 | 定位 |
|---|---|
| tag 与包版本不一致 | 第一步校验红，改齐九个 package.json 重打 tag |
| scoped 包发布报 404（不是 401） | OIDC 没配上或包不存在：新包先本地首发 + 配 trusted publisher。已有包也要**逐包**在 npm 包设置里配 Trusted Publisher（GitHub Actions · `unStone/web-ppt` · `release.yml`，允许直接 publish）——每个包单独配置、互相不继承，0.5.0-beta.7 的 7 个包曾因此全部 404。配完 2 天内须完成一次成功发布，否则配置过期 |
| verify 报体积 / 断言数漂移 | 数字声明与实测不符：先本地实测（`npm test` 后 `npm run build` 再 `npm run verify`），不要照抄旧值 |
| verify 跳过体积核对 | 没先 `npm run build`，dist 不存在时体积组整体跳过——「跳过」不等于「通过」 |
