# 参与贡献 · Contributing

感谢参与 Web-PPT。本文只覆盖提交 Issue 与 PR 的流程；仓库约束、已知陷阱与门禁命令统一在 [AGENTS.md](AGENTS.md)，测试规范在 [docs/engineering/testing.md](docs/engineering/testing.md)。

English speakers: issues and PRs in English are welcome. The summary at the end of this file covers the essentials.

## 报告问题

| 类型 | 入口 |
|---|---|
| 渲染 / 动画与 PowerPoint 不一致 | [渲染差异模板](https://github.com/unStone/web-ppt/issues/new?template=rendering.yml)，附样本文件和对照截图 |
| 解析失败、异常、编辑保存错误 | [缺陷模板](https://github.com/unStone/web-ppt/issues/new?template=bug.yml) |
| 新能力 | [需求模板](https://github.com/unStone/web-ppt/issues/new?template=feature.yml) |
| 安全问题 | 不要公开提交，按 [SECURITY.md](SECURITY.md) 私密报告 |
| 使用咨询 | [GitHub Discussions](https://github.com/unStone/web-ppt/discussions) |

渲染问题能否定位，几乎完全取决于能否拿到触发问题的文件。样本含敏感内容时，删到只剩出问题的那一页、替换文字后再上传。

## 本地环境

| 依赖 | 用途 | 必需 |
|---|---|---|
| Node（版本见 [`.node-version`](.node-version)） | 构建与全部测试 | 是 |
| Chrome | 浏览器套件 | 是 |
| LibreOffice + Noto CJK 字体 | 外部打开测试与保真对照 | 改动解析、渲染、保存时需要 |
| Python 3.11 + `tooling/font-glyph-requirements.txt` | 字体与 PDF 独立读取 | 改动字体、PDF 时需要 |
| .NET SDK 8 + xmllint | OOXML 合法性门禁 | 改动保存链路时需要 |

```bash
npm ci
```

`npm ci` 会通过 `prepare` 把 `core.hooksPath` 指向 `.githooks/`，提交时检查文档同步，规则见 [AGENTS.md](AGENTS.md) 的「约定」。

依赖一律从官方 registry 安装，不要用镜像源，原因见 AGENTS.md 已知陷阱。

## 提交 PR

1. 从 `master` 拉分支，一个 PR 只做一件事。
2. 新能力必须同时新增固件（`tooling/make-*.mjs` 确定性生成）和断言，见 [测试规范](docs/engineering/testing.md)。
3. 本地通过门禁：

   ```bash
   npm run check && npm test && npm run build && npm run verify
   ```

4. 提交信息使用 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/)，破坏性变更加 `!`；注释和提交信息使用中文。
5. 用户可见的变化在 [CHANGELOG.md](CHANGELOG.md) 顶部的「未发布」条目中记录。
6. 文档里的断言数、体积、版本号不要手抄，先跑 `npm run verify` 拿实测值。
7. 改动了公开导出时，构建后运行 `npm run api:report`，把 `packages/*/api/*.api.md` 的变化一并提交；verify 会拒绝与报告不一致的公开 API。

渲染改动会让快照失败。确认是预期变化后，按 [测试规范 §5](docs/engineering/testing.md#5-渲染快照基线) 更新基线，并在 PR 描述里说明为什么变。快照只能证明「变了」，保真度要用 `npm run compare <file>` 对照 LibreOffice。

## 架构约束

提交前确认没有违反 [AGENTS.md](AGENTS.md) 的「不可破坏的约束」，最常见的三条：

| 约束 | 检查方式 |
|---|---|
| `render/` 只依赖 `types.ts` | `npm run build` 中的边界审计 |
| `core` 不访问 `document`，能在 Worker 中运行 | 同上 |
| 发布包只 import 声明的 dependencies / peerDependencies | 同上 |

## Summary in English

- Report rendering differences with the sample file and a PowerPoint screenshot; use the issue templates.
- Report security issues privately via [SECURITY.md](SECURITY.md).
- Before opening a PR, run `npm run check && npm test && npm run build && npm run verify`.
- New capabilities need deterministic fixtures (`tooling/make-*.mjs`) and assertions.
- Use Conventional Commits; add user-visible changes to the "Unreleased" section of `CHANGELOG.md`.
- Architecture rules and known pitfalls live in [AGENTS.md](AGENTS.md).
