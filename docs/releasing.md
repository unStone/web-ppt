# 发布与 CI 运维

给维护者的操作指南（how-to）：四条 GitHub workflow 的行为、发版 checklist、已知的坑。日常命令约定见 [AGENTS.md](../AGENTS.md)。

## 1. 四条流水线

| workflow | 触发 | 职责 |
|---|---|---|
| `ci.yml` | push 到 master / PR | 类型检查 → 重生成固件并 `git diff` 验证确定性 → `test:functional` → 性能采样（不阻断）→ LibreOffice / 统一清单外部打开测试 |
| `release.yml` | 推 `v*` tag 或手动 | 见 §2，发布八个包到 npm |
| `powerpoint.yml` | 仅 `workflow_dispatch`，限 master / tag | 装有桌面 Office 的自托管 Windows 机器执行真机门禁（不跑 PR 代码），运行手册见 [powerpoint-runner.md](powerpoint-runner.md) |
| `pages.yml` | push 到 master | 部署官网，单实例并发（新推送取消排队旧任务） |

## 2. 发版 checklist

| # | 动作 | 说明 |
|---|---|---|
| 1 | 八个包 `package.json` 版本改成同一个值 | 流水线第一步逐包校验 tag 与版本一致，不一致直接失败 |
| 2 | 更新 `CHANGELOG.md` | 当前版本条目会被 verify 审计（如 collab 的双体积口径：发布入口 KB gzip + 测试薄包 B gzip，两者缺一 verify 红） |
| 3 | 本地过四门禁 `npm run check && npm test && npm run build && npm run verify` | verify 必须在 build 之后（读 dist 体积）且在 test 之后（读 `out/verify/counts.json` 断言数） |
| 4 | `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin vX.Y.Z` | OIDC Trusted Publishing，**Secrets 里不存任何 npm 凭据** |

流水线内部顺序：`npm ci` → Python / LibreOffice 环境准备 → tag 版本校验 → `check` → npm 首发引导校验 → `fixtures` → `test:functional` → 性能采样（不阻断）→ `build` → `verify` → 按 `core → edit-core → viewer-core → editor → react → vue → fonts → collab` 顺序发布（peer 依赖序，不能反）。

## 3. Trusted Publishing（OIDC）的环境要求

| 要求 | 原因 |
|---|---|
| Node ≥ 22.14.0，npm ≥ 11.5.1 且**钉在 11.x** | npm 12.0.2 实测在环境完全达标时仍报 ENEEDAUTH，不发起 OIDC 交换 |
| `permissions.id-token: write` | 换取短期发布令牌，缺了会退回要 NPM_TOKEN |
| setup-node **不设 `registry-url`** | 它会写带空 `NODE_AUTH_TOKEN` 的 .npmrc；npm 拿空凭据发布时，scoped 包返回 404 而非 401，极难排查 |
| 新包第一版**走不了 OIDC** | npm 只允许已存在的包配置 Trusted Publishing；先本地 `npm publish` 发一版，再去 npm 包设置配 trusted publisher。流水线有「首发引导校验」步骤会提前报出缺的包 |

## 4. 重跑与跳过的语义

- 发布用 `tooling/publish-if-new.sh`：registry 已有该版本就跳过。八步串行发布中间挂掉后整个 job 重跑，没有这层守卫，前面已成功的包会以 EPUBLISHCONFLICT 再次弄红，埋掉真正的失败原因。
- LibreOffice 缺席时图元测试合法跳过 22 项，但 verify 按文档声明的完整 130 项拒绝发布——发布流水线因此显式安装 `libreoffice-impress fonts-noto-cjk`；本地补跑相关验证前先确认环境等价。
- 性能采样与编辑性能预算在 beta 阶段 `continue-on-error`：保留红灯证据但不让受宿主负载干扰的 p95 阻断发布（见 [testing.md](testing.md#7-性能门禁的现状)）。

## 5. 常见失败速查

| 症状 | 定位 |
|---|---|
| tag 与包版本不一致 | 第一步校验红，改齐八个 package.json 重打 tag |
| scoped 包发布报 404（不是 401） | OIDC 没配上或包不存在：新包先本地首发 + 配 trusted publisher；已有包检查 `id-token: write` 与 npm 版本 |
| verify 报体积 / 断言数漂移 | 数字声明与实测不符：先本地实测（`npm test` 后 `npm run build` 再 `npm run verify`），不要照抄旧值 |
| verify 跳过体积核对 | 没先 `npm run build`，dist 不存在时体积组整体跳过——「跳过」不等于「通过」 |
