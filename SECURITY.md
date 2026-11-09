# 安全策略 · Security Policy

Web-PPT 在用户浏览器与本机进程里解析不可信的 `.pptx` / `.ppt` / EMF / WMF 文件，并把结果输出为 SVG / HTML。解析与输出链路上的缺陷可能直接被恶意文件利用，因此请**不要在公开 Issue 里报告安全问题**。

Web-PPT parses untrusted presentation and metafile input in the browser and in local Node processes. Please **do not report security issues in public issues**.

## 支持的版本 · Supported versions

| 版本 | 安全修复 |
|---|---|
| 最新稳定版（npm `latest`） | ✅ |
| 当前预发布线（npm `next`） | ✅ |
| 更早的版本 | ❌，请升级 |

九个 `@web-ppt/*` 包同版本发布，修复会同时发布到全部包。

## 报告方式 · How to report

通过 GitHub 私密漏洞报告提交：[Report a vulnerability](https://github.com/unStone/web-ppt/security/advisories/new)。

Use GitHub private vulnerability reporting: [Report a vulnerability](https://github.com/unStone/web-ppt/security/advisories/new).

报告请包含：

| 项 | 说明 |
|---|---|
| 受影响的包与版本 | 例如 `@web-ppt/core@0.8.0` |
| 运行环境 | 浏览器 / Node 版本、是否在 Worker 中解析 |
| 复现样本 | 能触发问题的最小文件；样本含敏感内容时请先替换 |
| 影响 | 例如脚本执行、内存耗尽、读取宿主文件 |

维护者确认后会在私密 advisory 中同步修复进度，修复版本发布后公开 advisory 并致谢报告者（报告者要求匿名时除外）。

## 范围 · Scope

| 属于范围 | 示例 |
|---|---|
| 解析资源耗尽 | ZIP 炸弹、超大声明尺寸、递归结构绕过 `ZipSafetyError` 上限 |
| 路径与包结构 | ZIP 路径穿越、重复条目、伪造中央目录 |
| 输出注入 | 文件内容经 SVG / HTML / `foreignObject` 输出后执行脚本或加载外部资源 |
| 保存产物 | 编辑保存把不可信内容写成可执行的 OOXML 结构 |
| `@web-ppt/agent-mcp` | 越过声明的文件会话访问本机其他路径、发起网络请求 |

不属于范围：渲染保真度差异、宿主应用自身的 CSP / 鉴权配置、依赖已公开且已有补丁版本的漏洞（请直接提 PR 升级）。
