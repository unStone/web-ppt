# CLAUDE.md

本项目的约定、命令、架构约束与已知陷阱统一维护在 **[AGENTS.md](AGENTS.md)**，请先阅读。

那里的内容对所有编码代理通用，此文件只补充 Claude Code 特有的部分。

## Claude Code 补充

- 浏览器验证走内置的 Browser 工具（`preview_start` → `.claude/launch.json` 里的 `site`），不要用 Bash 起 dev server
- 画架构图 / 流程图用 `archify` skill，产物落在 `out/`（已 gitignore）
