---
title: 修复未知扩展对象阻断兼容回退
status: open
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by: []
---

## Question

如何在不支持 ChartEx 的默认解析路径上选择 Office 提供的兼容内容，同时保留已支持的墨迹、数学、媒体和
经典图表行为，且不把未知扩展对象当成可完整编辑的普通图片？

真实漏斗 PPTX 已证明：`parseOneShape` 把未知 graphicFrame 的 `unsupported` 占位视为非空解析结果，阻断
`mc:Fallback/p:pic`。移除内存副本的 Choice 后，同一图片字节立即进入公开解析和两条 SVG 输出。
来源、哈希和复现命令见[回退与真实语料调查](002-chartex-fallback-corpus.md)。

选择语义应以解析能力和 `Requires` 命名空间为依据，不能只检查数组长度，也不能假设第一个 Choice 可用。
明确首个可用分支、未知命名空间、多个要求、组内对象、缺失/损坏 fallback 的退化规则；不要为了 ChartEx
单独硬编码一个 `cx2` 前缀，因为前缀只是别名。调用可选解析 hook 后仍不能可靠解析的对象，要有明确回退契约。

| 边界 | 验收 |
|---|---|
| 真实来源 | 原漏斗 PPTX 的回退图片哈希不变，公开 `parse` 不再输出同 ID 的 unsupported |
| 确定性固件 | 从真实 envelope 提炼结构，图片和业务数据由本仓库生成；保留来源哈希，明确不是 Office 新产出的文件 |
| 两条显示路径 | 真实 Chrome 屏幕预览和独立 SVG 文件均实际解码显示图片；只检查 `<image>` 字符串不够 |
| 原生能力 | 墨迹等既有 Choice 不误退化；未知要求不能因内部含可识别普通形状就被当成已支持 |
| 编辑与保存 | fallback 只是源对象投影：框架级身份/权限一致，移动、撤销、恢复和两条保存保留原 ChartEx/关系/工作簿 |
| 成本与回归 | 默认入口不携带新 ChartEx 绘图实现；旧体积/性能阈值不变，四项仓库门禁和独立进程指纹通过 |

本票不实现六类 ChartEx 原生几何，也不声称所有生产者都含图片回退。新版 `chartSpace/@fallbackImg` 尚缺真实
样本，必须独立登记，不能拿 MC 固件冒充覆盖。

## Progress（2026-09-05）

| 验收层 | 当前结果 |
|---|---|
| 选择 | 形状与切换共用 MC 选择器，各自声明能力；覆盖前缀别名/遮蔽、多 Choice、多 Requires、空分支、嵌套兼容外壳和缺失图片；原生墨迹仍可用 |
| 显示 | 真实漏斗与自制固件均通过 Chrome 屏幕与独立 SVG 实际解码；四条路径抽样像素 MAE 均为 0，原图哈希不变 |
| 框架编辑 | 移动/改名/替代文字同步全部表示；整壳复制、层级、删除、撤销、恢复和补丁保存保留 ChartEx、关系、工作簿与图片 |
| 身份 | 复制、外部结构补丁、恢复和连续整页复制均越过未选分支 ID；拒绝未建模身份与可删除孩子重叠及重复目标映射 |
| 所有权 | OPC 中央目录改写与 part 快照不再共享 Node Buffer 的可变切片；保存不污染输入包 |
| 回归 | 93 项专项已接入 `npm test` / `test:v08`；生成器接入 `npm run fixtures`，86 个文件重生成两次字节一致；原快照未更新 |
| 门禁 | 最终四项仓库门禁全绿，含原 Chrome 性能预算、八包构建和 546 对独立进程指纹；默认 edit-core 为 82500B gzip，原 82503B 上限未变 |
| 尚未完成 | 丢失原包时，生成保存现在明确拒绝，不能还原 ChartEx 原始数据；这不是“两条保存均保留”的完成态，票据保持 open |

可复验入口：

```bash
fnm exec --using=v24.3.0 node tooling/test-chartex-fallback.mjs
fnm exec --using=v24.3.0 node tooling/test-site-editor-browser.mjs
fnm exec --using=v24.3.0 node tooling/probe-chartex.mjs --expect-fallback corpus/chartex/libreoffice-funnel-pp1.pptx
```

浏览器报告在忽略目录 `out/site-editor-browser/chartex-visual-report.json`，包含源文件哈希、回退图哈希、截图和
抽样误差；独立 SVG 同目录输出。自制图片每路径 247 个非白像素点，真实漏斗每路径 94 点，不将抽样误差冒充
全图逐像素相同。上游原文件、截图和导出 SVG 不纳入版本控制。探针仍明确把自身未执行的视觉检查标为未测。
