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

运行前 `git status --short` 必须为空。生成端和独立校验端都会拒绝已修改、已暂存或未跟踪的非忽略文件；
否则未提交源码可能借用 HEAD 的 commit ID，产生无法复现的假证据。

命令先从三套内置模板走完主题、母版、版式、普通页面、恢复与保存重开，同时生成 `.ppt` 另存结果；再用
`Presentations.Open2007(..., OpenAndRepair = msoFalse)` 逐份只读打开统一清单中的 11 件产物。
`DisplayAlerts = ppAlertsAll` 让警告以自动化错误返回，避免默认选择把修复提示吞掉。

成功后 `out/v07-integration/powerpoint-report.json` 会记录：

| 证据 | 防止的误判 |
|---|---|
| 当前 Git revision | 旧提交的成功结果冒充当前代码 |
| 清单 SHA-256 | 修改验收范围后沿用旧报告 |
| 每份 `.pptx` 的 SHA-256 与实际页数 | PowerPoint 打开后替换文件或漏验产物 |
| PowerPoint version / build | 无法追溯真实软件版本 |
| 交互会话 ID | Session 0 假运行 |
| 生成时间、失败原因 | 过期或失败报告被当成绿灯 |

Node 校验器会独立重读清单和文件字节，只接受一小时内、与当前 HEAD 完全绑定且全部成功的报告。
LibreOffice 门禁读取同一个 `out/v07-integration/office-artifacts.json`，逐件验证页数与无修复打开；Windows
工作流无论成功失败都会上传这份清单、报告和对应 `.pptx`，便于复核。

## 与 OOXML 合法性门禁的分工

[OOXML 门禁](testing.md#7-6-ooxml-合法性门禁)（`npm run test:ooxml`）用 ECMA-376 XSD 与 Open XML
SDK 在 Linux CI 上拦截结构性非法（sequence 顺序、必填子元素、枚举取值），它在每次推送时运行、
覆盖全部保存产物；本门禁验证的是桌面 PowerPoint 的实际接受度，覆盖 0.7 统一清单的 11 件产物。
两者的关系：XSD / SDK 都不覆盖渲染语义与 PowerPoint 的私有宽容度，**通过校验不等于 PowerPoint
验收通过**；而 LibreOffice 能容忍的顺序错误 PowerPoint 可能要求修复，OOXML 门禁正是为在真机
之前拦下这类差距。真机门禁按 [0.8.0 发布条件](../roadmap.md) 仍是正式发布的独立条件，暂缓期间
由维护者显式决定豁免口径并记录在 roadmap。
