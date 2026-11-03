# 发布与 CI 运维

给维护者的操作指南（how-to）：四条 GitHub workflow 的行为、发版 checklist、已知的坑。日常命令约定见 [AGENTS.md](../../AGENTS.md)。

## 1. 四条流水线

| workflow | 触发 | 职责 |
|---|---|---|
| `ci.yml` | push 到 master / PR | 类型检查 → 重生成固件并 `git diff` 验证确定性 → `test:functional` → 性能采样（不阻断）→ LibreOffice / 统一清单外部打开测试 |
| `release.yml` | 推 `v*` tag 或手动 | 见 §2，发布九个包到 npm |
| `powerpoint.yml` | 仅 `workflow_dispatch`，限 master / tag | 装有桌面 Office 的自托管 Windows 机器执行真机门禁（不跑 PR 代码），运行手册见 [powerpoint-runner.md](powerpoint-runner.md) |
| `pages.yml` | push 到 master | 部署官网，单实例并发（新推送取消排队旧任务） |

## 2. 发版 checklist

| # | 动作 | 说明 |
|---|---|---|
| 1 | 九个包 `package.json` 版本改成同一个值 | 同步内部 peer 范围、`package-lock.json` 和 MCP 协议版本；预发布 peer 范围必须包含当前 beta。流水线逐包校验 tag 与版本一致 |
| 2 | 更新 `CHANGELOG.md` | 当前版本条目会被 verify 审计（如 collab 的双体积口径：发布入口 KB gzip + 测试薄包 B gzip，两者缺一 verify 红） |
| 3 | 本地过四门禁 `npm run check && npm test && npm run build && npm run verify` | verify 必须在 build 之后（读 dist 体积）且在 test 之后（读 `out/verify/counts.json` 断言数） |
| 4 | `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z` | OIDC Trusted Publishing，**Secrets 里不存任何 npm 凭据** |
| 5 | 等待发布流水线成功，逐包查询官方 registry 的版本与 dist-tag，并完成安装验证 | beta 使用 `next`，稳定版使用 `latest`；tag、提交或文档条目不代表 npm 已发布。新包首发与发布授权未完成时，保留待发布状态 |

流水线内部顺序：`npm ci` → Python / LibreOffice 环境准备 → tag 版本校验 → npm 首发引导校验 → **门禁信任判定** → `fixtures` → [`check` → `test:functional` → 性能采样（不阻断）→ 编辑性能预算] → `build` → `verify` → 按 `core → edit-core → viewer-core → editor → react → vue → fonts → collab → agent-mcp` 顺序发布（peer 依赖序，不能反）。

方括号里的四步只在**门禁信任判定**拿不到绿色时执行。判定逻辑（`tooling/check-ci-green.mjs`）：查询 tag 指向的 commit 上 `push` 事件的 CI workflow 结论——绿色则这四步已由 CI 在同一 commit、同样干净的环境里全量跑过，release 跳过它们（**实测 2026-11-01：42.5 → 10.3 分钟，-76%**）；查无 run、run 未完成、结论非 success 或 API 请求失败一律全量跑，安全级别与没有信任链时一致。判定用 `git rev-parse "<ref>^{commit}"` 解引用 annotated tag：tag 触发时 `GITHUB_SHA` 是 tag 对象的 SHA，而 CI run 按 commit SHA 索引。

跳过 `test:functional` 时 verify 的断言数核对会黄字跳过（`out/verify/counts.json` 不存在）；该核对已由同 commit 的 CI verify 覆盖，不构成发布盲区。`fixtures` 生成不可跳：verify 的 `--dist` 测试要读固件。verify 链对测试落盘依赖的三处降级（`verify-v08-readiness` 的产物检查、`measure-expanded` 的套件计数、`verify-consistency` 的 counts）在快路径下黄字跳过、全量路径行为不变——完整性均由同 commit 的 CI 覆盖。

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

已有版本会被逐包跳过，手动重跑可验证触发与幂等性，但不能把跳过当作实际 OIDC 发布证据。[0.8.0-beta.1 实际发布](https://github.com/unStone/web-ppt/actions/runs/41680224362)的八个既有包通过 OIDC 发布，MCP 首发使用本机账号，其 GitHub 关系已创建并回读；[手动重跑](https://github.com/unStone/web-ppt/actions/runs/41686583749)验证了触发与逐包跳过。后续未发布版本使用同一工作流。

## 4. 重跑与跳过的语义

- 发布用 `tooling/publish-if-new.sh`：registry 已有该版本就跳过。九步串行发布中间挂掉后整个 job 重跑，没有这层守卫，前面已成功的包会以 EPUBLISHCONFLICT 再次弄红，埋掉真正的失败原因。
- 门禁信任判定（§2）只在目标 commit 的 push CI 绿时跳过重复门禁；rerun 失败的 release 时若 CI 也红了，会自动回退全量路径，不需要人工干预。
- LibreOffice 缺席时图元测试合法跳过 22 项，但 verify 按文档声明的完整 130 项拒绝发布——发布流水线因此显式安装 `libreoffice-impress fonts-noto-cjk`；本地补跑相关验证前先确认环境等价。
- 性能采样与编辑性能预算在 beta 阶段 `continue-on-error`：保留红灯证据但不让受宿主负载干扰的 p95 阻断发布（见 [testing.md](testing.md#7-性能门禁的现状)）。

## 5. 常见失败速查

| 症状 | 定位 |
|---|---|
| tag 与包版本不一致 | 第一步校验红，改齐九个 package.json 重打 tag |
| scoped 包发布报 404（不是 401） | OIDC 没配上或包不存在：新包先本地首发 + 配 trusted publisher。已有包也要**逐包**在 npm 包设置里配 Trusted Publisher（GitHub Actions · `unStone/web-ppt` · `release.yml`，允许直接 publish）——每个包单独配置、互相不继承，0.5.0-beta.7 的 7 个包曾因此全部 404。配完 2 天内须完成一次成功发布，否则配置过期 |
| verify 报体积 / 断言数漂移 | 数字声明与实测不符：先本地实测（`npm test` 后 `npm run build` 再 `npm run verify`），不要照抄旧值 |
| verify 跳过体积核对 | 没先 `npm run build`，dist 不存在时体积组整体跳过——「跳过」不等于「通过」 |
| CLI 显示成功或 processing，但精确版本尚不可读 | 等待官方 registry 的目标版本与 tarball 可读并比对 integrity，再做全新安装；`0.0.0-stage` 占位版本不计作目标版本发布完成，不据此猜测或执行审批 |
| `npm whoami` 返回 401 | 当前登录凭据无效，先通过 `npm login --registry=https://registry.npmjs.org/` 刷新身份；`PUT 404` 本身不能判定是身份、scope 还是发布状态问题 |
