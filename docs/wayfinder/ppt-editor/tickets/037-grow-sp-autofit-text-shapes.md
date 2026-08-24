---
title: 让 spAutoFit 文字形状随内容改高
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./036-throttle-normal-autofit-text-input.md
---

## Question

如何让含 `a:spAutoFit` 的可写文字形状在文字、字符格式或段落格式提交后立即把
形状高度调整到实际行盒所需高度，并依 `anchor=top/middle/bottom` 在形状局部垂直轴上
分别保持顶、中或底锚点，同时保证旋转、翻转、嵌套组、选择框、撤销重做与
`a:xfrm/a:off + a:ext` 保留型写回都不跳变？

本票沿四个已稳定的公开 seam 做竖切 TDD：core 新增无 DOM 的
`fitTextShapeHeight(text, width, options)`，与 `layoutText` 共用换行、行距、内边距、分栏、
竖排与注入字体测量；edit-core 新增纯数据 `FitTextShape{ id }` 命令；
`Editor.exec(EditText/SetRunProps/SetParaProps)` 只要实际产生文字 patch，就在同一原子历史中
每个目标最多执行一次派生 `FitTextShape`；`openEditor(...).mount(...)` 只消费同一有效投影，
不在 DOM 控制器里暗改几何。以上 seam 由方案 §4.3、§6、§9.6 和§10.3 确定。

`FitTextShape` 只接受 `kind=shape && text.autoFitShape` 的完全可编辑对象；表格单元格、
`normAutofit`、无 autofit 和 frame-only 对象不得改几何。有效宽度与旋转保持不变，
新高度向上取整到 1 EMU，局部文字锚点在父坐标中的位置前后误差不超过 1 EMU；
`flipV` 要翻转顶/底的物理锚点。几何是由文字行为导出的显式覆盖 patch，与文字一起进入
撤销、重做、合并输入历史和远端未记录 patch rebase，但不改 `src`、`fontScale` 或 `a:spAutoFit`。

新的确定性固件覆盖 top/middle/bottom、90° 旋转、`flipV`、嵌套组、分栏与竖排；
Node 必须证明输入、字号、行距、撤销/重做、合并历史、非记录写入和非目标不受影响。
真实 Chrome 对 browser/engine 各连续输入 80 次，文字、编辑面、静态形状、选择框在每次同步提交后
使用同一高度，p95 不超过 30ms。保存后只改目标页，core 重开的文字逐字符、
`autoFitShape`、几何和两条预览指纹都等于有效投影，LibreOffice 打开不得修复。

本票不实现 `SetBodyProps` 面板、表格行高自适应、文字框手动缩放时自动切换 autofit 模式，
也不把测量出的行盒写入 OOXML。

## Resolution

以共享行盒求解器闭合 `spAutoFit`：core 公开无 DOM 的 `fitTextShapeHeight`，edit-core 以
`FitTextShape` 生成向上取整到 EMU 的显式几何 patch；top/middle/bottom、`flipV`、旋转与
嵌套组均在父坐标保持物理锚点，文字和本次实际派生的 x/y/h 通过 entry 级因果链接进入同一
撤销、合并及远端 rebase。DOM 层同步替换静态形状并保持文字选择框，不另藏几何状态。

确定性固件覆盖三种锚点、90°、翻转、组、分栏、竖排和非目标，连续生成哈希均为
`493f9ee356e19a48da7824ea29dc71335f19e1e48fe4497038e76d70c2476c14`。Chrome 80 次连续输入
browser/engine p95 为 4.2/4.1ms、选择框误差 0；保存重开 46 项通过，42 份固件 139 页的
278 对独立进程指纹一致。LibreOffice 无修复导出 PDF，独立 SVG 几何 oracle 最大偏差
2.293 unit（小于 0.1px）。两轮独立规格/工程审查均为 clean；最终
`npm run check && npm test && npm run build` 全绿。
