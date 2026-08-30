---
title: 建立跨产物一致性闸门
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

源码行为已通过测试，但许可证、发布包版本与清单、站内链接、HTML id、文档断言数、快照数和发布入口体积
仍分散在 README、官网、CHANGELOG、包元数据与工作流中；这些事实漂移时既有单测不会失败。如何建立秒级、
无网络的跨产物一致性闸门，让 CI 与发布流程在交付前发现这类“代码正确、交出去的信息错误”的问题？

验收：测试套件只在全绿后落盘本轮实测；`npm run verify` 复用实际包元数据和构建产物核对全部声明，
README 与官网完整列出八个发布包，协同包的发布入口与测试薄包体积口径明确分离；CI / release 在构建后执行
闸门；`npm run check && npm test && npm run build && npm run verify` 全绿。

## Resolution

新增秒级 `npm run verify`，以 LICENSE、package metadata、Git 跟踪的 Markdown、站点 HTML、测试落盘计量和
实际 `dist` 入口为事实源，统一检查许可证、八包版本与清单、内部/npm 链接、重复 id、当前稳定版、断言数、
178 个快照、490 对等价指纹及 gzip 体积。发布包体积表现在必须完整覆盖八包，不能再只校准已有行而漏掉新包。

所有测试套件只在全绿后写入本轮规模；协同包另记录 12,160B 的排除 peer 测试薄包，和 10.04KB 发布入口
分开核对。中英 README、官网、CHANGELOG、稳定版清单与历史坏链接已校准；站点构建和静态闸门复用同一份
页面/id 规则，CI 与 release 均在构建后执行验证。

最终 `npm run check && npm test && npm run build && npm run verify` 全绿：4,178 项断言、178 个快照、
71 份固件 / 490 对独立进程 SVG 指纹、八个发布包，全部跨产物检查通过。真实浏览器测试首次在文件系统
沙箱内因禁止监听 `127.0.0.1` 被拒，按原命令在获准环境完整重跑后通过，未跳过任何契约。
