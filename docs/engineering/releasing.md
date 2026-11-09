# 发布与 CI 运维

给维护者的操作指南（how-to）：GitHub workflow 的行为、发版 checklist、已知的坑。日常命令约定见 [AGENTS.md](../../AGENTS.md)。

## 1. 流水线

| workflow | 触发 | 职责 |
|---|---|---|
| `ci.yml` | push 到 master / main、PR 或手动 | 从唯一门禁入口（`test:functional` / `verify` / `test:ci:external`）展开源码、发布产物与外部读取器分组并按数据依赖并行：类型 / 固件 / 构建、独立进程等价分片、功能分组、LibreOffice 与 OOXML 合法性门禁；`node-minimum` 在 `engines` 声明的最低 Node 上复验 MCP、Node 渲染与 ZIP 安全发布产物；`check` 汇总核对覆盖与报告完整性 |
| `performance.yml` | 每周一定时或手动 | 在 master 上采样编辑器性能与编辑预算，只观察趋势，见 [testing.md §7](testing.md#7-性能门禁的现状) |
| `release.yml` | 推 `v*` tag 或手动 | 见 §2，发布九个包到 npm |
| `powerpoint.yml` | 仅 `workflow_dispatch`，限 master / tag | 装有桌面 Office 的自托管 Windows 机器执行真机门禁（不跑 PR 代码），运行手册见 [powerpoint-runner.md](powerpoint-runner.md) |
| `pages.yml` | master / main 的成功 push CI 完成，或手动指定 CI run_id | 下载该次 CI 已验证的站点产物后部署；不重复安装依赖、构建和测试；纯文档及过期自动部署跳过 |

PR 连续推送通过 `cancel-in-progress` 取消旧运行；master / main 的 CI 使用每次运行独立的并发组，逐提交完整执行。路径过滤只跳过文档提交的重任务，始终生成 `check` 结论。

官网只接受本仓库 master / main 上由 `ci.yml` 触发且成功完成的 push 运行。自动部署还要求该提交仍为分支 HEAD，避免较旧 CI 晚完成后覆盖新站点；手动指定 `run_id` 可以重部署仍未过期的历史产物，没有 `site-dist` 或产物已过期时明确失败。

## 2. 发版 checklist

| # | 动作 | 说明 |
|---|---|---|
| 1 | `npm run release:version -- X.Y.Z` | 九个包的版本、包之间的精确 peer 版本与 `package-lock.json` 一次改齐；verify 拒绝版本不一致或 peer 不是精确当前版本。MCP 握手软件版本自动读取包清单，回归校验一致；流水线逐包校验 tag 与版本一致 |
| 2 | 把 `CHANGELOG.md` 的「未发布」改成版本条目，新建或续写 `docs/releases/X.Y.Z.md` | 预发布版并入同一版本线的记录；verify 审计当前版本线记录（如 collab 的双体积口径：发布入口 KB gzip + 测试薄包 B gzip，两者缺一 verify 红） |
| 3 | 本地过四门禁 `npm run check && npm test && npm run build && npm run verify`，再跑 `npm run test:ooxml` | verify 必须在 build 之后（读 dist 体积）且在 test 之后（读 `out/verify/counts.json` 断言数）；OOXML 门禁读 `npm test` 落盘的保存产物，本机需要 xmllint 与 .NET SDK 8，CI 与发布流水线自带 |
| 4 | `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z` | OIDC Trusted Publishing，**Secrets 里不存任何 npm 凭据** |
| 5 | 等待发布流水线成功，逐包查询官方 registry 的版本与 dist-tag，并完成安装验证 | beta 使用 `next`，稳定版使用 `latest`；tag、提交或文档条目不代表 npm 已发布。新包首发与发布授权未完成时，保留待发布状态 |

流水线内部顺序：**门禁信任判定** → `npm ci` → Python / 中文字体与 .NET 环境准备 → [LibreOffice / xmllint 安装] → tag 版本校验 → [`check`] → npm 首发引导校验 → `fixtures` → [`test:functional`] → `build` → [OOXML 门禁] → `verify` → 按 `core → edit-core → viewer-core → editor → react → vue → fonts → collab → agent-mcp` 顺序发布（peer 依赖序，不能反）。

方括号里的步骤只在**门禁信任判定**拿不到绿色时执行。判定逻辑（`tooling/check-ci-green.mjs`）：查询 tag 指向的 commit 上可信 `push` CI 的完整门禁证据；纯文档跳过的绿色运行不作为全量通过证据。查无完整运行、run 未完成、结论非 success 或 API 请求失败一律全量跑，安全级别与没有信任链时一致；判定用 `git rev-parse "<ref>^{commit}"` 解引用 annotated tag，CI run 按 commit SHA 索引。

跳过 `test:functional` 时 verify 的断言数核对会黄字跳过（`out/verify/counts.json` 不存在）；该核对已由同 commit 的 CI verify 覆盖，不构成发布盲区。`fixtures` 生成不可跳：verify 的 `--dist` 测试要读固件。verify 链对测试落盘依赖的两处降级（`measure-expanded` 的套件计数、`verify-consistency` 的 counts）在快路径下黄字跳过、全量路径行为不变——完整性均由同 commit 的 CI 覆盖。

`verify` 按 npm 实际打包清单拒绝公开包夹带演示稿或模板二进制，私有评测文稿不属于 SDK 交付。审计调用锁定的 npm workspace、Arborist 与 packlist 正式 API，不执行包生命周期或创建 tarball；正式发布仍按原有 `prepack` 同步文档。

## 3. Trusted Publishing（OIDC）的环境要求

| 要求 | 原因 |
|---|---|
| Node ≥ 22.14.0，npm ≥ 11.5.1 且**钉在 11.x** | npm 12.0.2 实测在环境完全达标时仍报 ENEEDAUTH，不发起 OIDC 交换 |
| `permissions.id-token: write` | 换取短期发布令牌，缺了会退回要 NPM_TOKEN |
| setup-node **不设 `registry-url`** | 它会写带空 `NODE_AUTH_TOKEN` 的 .npmrc；npm 拿空凭据发布时，scoped 包返回 404 而非 401，极难排查 |
| 新包第一版**走不了 OIDC** | npm 只允许已存在的包配置 Trusted Publishing；先本地 `npm publish` 发一版，再去 npm 包设置配 trusted publisher。流水线有「首发引导校验」步骤会提前报出缺的包 |

### GitHub 触发与包授权

推送 `v*` tag 会触发发布；也可在 GitHub Actions 的「发布」页面选择 Run workflow，或运行 `gh workflow run release.yml --repo unStone/web-ppt --ref <已验证的tag或分支>`。工作流使用 OIDC，不添加 `NPM_TOKEN` secret。

新包首发公开后，用 npm 官方 CLI 配置关系；维护端要求 npm ≥ 11.15，发布 runner 仍使用已验证的 11.5.1：

```bash
npm trust github @web-ppt/agent-mcp --repo unStone/web-ppt --file release.yml --allow-publish --yes --registry=https://registry.npmjs.org/
npm trust list @web-ppt/agent-mcp --json --registry=https://registry.npmjs.org/
```

`--file` 只填 `release.yml`；当前 workflow 没有 environment，因此不传 `--env`。创建和读取可能要求 npm 网页认证，认证期间保持 CLI 进程运行；回读应匹配仓库、文件及 `createPackage` 权限，记录 registry 实际返回的权限列表。

新配置须在创建后两天内完成首次成功发布，才能验证并绑定仓库不可变身份；超过期限须删除后重建。`trust list` 仅证明配置可读取，已有版本的跳过运行或 dry-run 不能代替这次激活，见 [npm 配置有效期](https://docs.npmjs.com/trusted-publishers/#trusted-publisher-configuration-expiry)。

已有版本会被逐包跳过，手动重跑可验证触发与幂等性，但不能把跳过当作实际 OIDC 发布证据。[0.8.0-beta.2 实际发布](https://github.com/unStone/web-ppt/actions/runs/41736895205)的九个包均实际发布并生成 GitHub provenance，MCP 由此完成首次成功 OIDC 发布激活；[此前的手动重跑](https://github.com/unStone/web-ppt/actions/runs/41686583749)只验证了触发与逐包跳过。

[0.8.0-beta.3 实际发布](https://github.com/unStone/web-ppt/actions/runs/41746792166)再次完成九包 OIDC 发布。匿名 registry 下载的实际 SRI、九包隔离安装、SDK 入口及 fill Schema 均通过，Node 20 / 24 的实际 CLI 握手均报告 `beta.3` 并提供十个工具。

发布前必须用真实 stdio Client 校验 `serverInfo.version` 等于包清单版本；MCP 服务通过自身公开的 `package.json` 读取该值，不维护第二份版本常量。安装验收继续独立检查实际发布 CLI 的握手版本。

## 4. 重跑与跳过的语义

- 发布用 `tooling/publish-if-new.sh`：registry 已有该版本就跳过。九步串行发布中间挂掉后整个 job 重跑，没有这层守卫，前面已成功的包会以 EPUBLISHCONFLICT 再次弄红，埋掉真正的失败原因。
- release 在根 `build` 和 `verify` 完成后使用 `--verified-build`：运行真实 `npm pack` 保留 `prepack` 的文档同步，校验包身份、完整性及发布文件清单，再从当前包目录发布明确的 `.tgz`，保持 `next` / `latest` 标签。默认调用 helper 及普通本地 `npm publish` 仍执行 `prepublishOnly` 构建；未知或重复参数立即失败。生命周期由本地真实 tarball dry-run 验证，OIDC 交换仍须以正式发布结果为准。
- 门禁信任判定（§2）只在目标 commit 的 push CI 绿时跳过重复门禁；rerun 失败的 release 时若 CI 也红了，会自动回退全量路径，不需要人工干预。
- LibreOffice 缺席时图元测试合法跳过 22 项，但 verify 按文档声明的完整 130 项拒绝发布；发布全量路径显式安装 `libreoffice-impress`，快路径复用同提交完整 CI 的证据。中文字体与 PDF 读取依赖始终安装，保持发布产物复验环境一致。
- 发布流水线不跑性能采样：受宿主负载干扰的 p95 不阻断发布，趋势由 `performance.yml` 观察（见 [testing.md](testing.md#7-性能门禁的现状)）。

## 5. 常见失败速查

| 症状 | 定位 |
|---|---|
| tag 与包版本不一致 | 第一步校验红，改齐九个 package.json 重打 tag |
| scoped 包发布报 404（不是 401） | OIDC 没配上或包不存在：新包先本地首发 + 配 trusted publisher。已有包也要**逐包**在 npm 包设置里配 Trusted Publisher（GitHub Actions · `unStone/web-ppt` · `release.yml`，允许直接 publish）——每个包单独配置、互相不继承，0.5.0-beta.7 的 7 个包曾因此全部 404。配完 2 天内须完成一次成功发布，否则配置过期 |
| verify 报体积 / 断言数漂移 | 数字声明与实测不符：先本地实测（`npm test` 后 `npm run build` 再 `npm run verify`），不要照抄旧值 |
| verify 跳过体积核对 | 没先 `npm run build`，dist 不存在时体积组整体跳过——「跳过」不等于「通过」 |
| CLI 显示成功或 processing，但精确版本尚不可读 | 等待官方 registry 的目标版本与 tarball 可读并比对 integrity，再做全新安装；`0.0.0-stage` 占位版本不计作目标版本发布完成，不据此猜测或执行审批 |
| `npm whoami` 返回 401 | 当前登录凭据无效，先通过 `npm login --registry=https://registry.npmjs.org/` 刷新身份；`PUT 404` 本身不能判定是身份、scope 还是发布状态问题 |
