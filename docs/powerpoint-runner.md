# PowerPoint 真实软件门禁

这条门禁证明编辑器产出的 `.pptx` 能被桌面 PowerPoint **在禁止修复的情况下**打开。LibreOffice
仍然负责每次 Linux/macOS CI 的高频回归；两者不能互相替代。

## Runner 约束

| 条件 | 原因 |
|---|---|
| Windows x64，已安装并激活桌面 PowerPoint | GitHub 托管 runner 不含 Office |
| runner 标签含 `powerpoint` | 只把含 Office 的专用机器纳入门禁 |
| 用户已登录，使用 `run.cmd` 前台运行 runner | Office COM 不支持 Session 0 服务自动化；脚本会主动拒绝 |
| runner 只归可信仓库使用 | 装有 Office 的机器不能执行 fork / PR 的任意代码 |

不要把 runner 配成 Windows 服务。机器重启后，先登录专用用户，再从 runner 目录执行
`run.cmd`。PowerPoint 必须已经用该用户启动过一次并完成激活、许可和首次启动对话框。

## 运行与证据

在 GitHub Actions 中从 `master`、`main` 或发布 tag 手动运行
`PowerPoint 真实软件门禁`。工作流只接受可信 ref，不监听 `pull_request`。

公开命令同样可在 runner 本机执行：

```powershell
npm ci
npm run test:edit:powerpoint
```

命令先重新生成保存产物，再用 `Presentations.Open2007(..., OpenAndRepair = msoFalse)` 逐份只读
打开。`DisplayAlerts = ppAlertsAll` 让警告以自动化错误返回，避免默认选择把修复提示吞掉。

成功后 `out/edit-save/powerpoint-report.json` 会记录：

| 证据 | 防止的误判 |
|---|---|
| 当前 Git revision | 旧提交的成功结果冒充当前代码 |
| 清单 SHA-256 | 修改验收范围后沿用旧报告 |
| 每份 `.pptx` 的 SHA-256 与实际页数 | PowerPoint 打开后替换文件或漏验产物 |
| PowerPoint version / build | 无法追溯真实软件版本 |
| 交互会话 ID | Session 0 假运行 |
| 生成时间、失败原因 | 过期或失败报告被当成绿灯 |

Node 校验器会独立重读清单和文件字节，只接受一小时内、与当前 HEAD 完全绑定且全部成功的报告。
工作流无论成功失败都会上传清单、报告和对应 `.pptx`，便于复核。
