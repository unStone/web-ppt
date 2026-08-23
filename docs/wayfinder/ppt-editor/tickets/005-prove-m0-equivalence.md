---
title: 证明 M0 编辑投影与只读渲染等价
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./001-deterministic-render-identity.md
  - ./004-edit-doc-projection.md
---

## Question

如何用确定性编辑固件、独立进程 SVG 指纹与内存基准证明“解析 → EditDoc → 有效投影 → 渲染”和现有只读链路逐字节等价，并守住只读零成本？

## Resolution

答案是把两条链路放进彼此隔离的进程，比较带固定命名空间的**原始** SVG 指纹，而不是在同一进程比较或用归一化掩盖差异：

- 新增 `test-edit-equivalence.mjs` 与最小指纹 worker。测试自动发现 `fixtures/` 下全部 `.pptx` / `.ppt`，每个文件分别启动只读与编辑进程；加密 OOXML、40/56 位 RC4 `.ppt` 使用确定性口令解密，hardcases 也不豁免。
- 只读进程走默认惰性 `parse`；编辑进程走 `parse({ edit: true, keepPackage: true, lazy: false }) → createDoc → toSlide`。每页用同一安全 `idPrefix` 分别走 `foreignObject` HTML 与原生 `<text>` 两条路径，记录原始字符串长度与 SHA-256；同时比较画布、格式、页数、隐藏状态和备注。
- 最终覆盖 22 份固件、97 页、194 对原始 SVG。两边逐对完全一致，既包含图表、SmartArt、媒体、OLE、图元文件、嵌入字体和动画，也包含旧 `.ppt` 与四种加密输入。测试已进入 `npm test`、CI 和发布流水线，新加未加密固件会自动进入门禁。
- 固件生成命令连续运行两次：第一次与仓库原字节一致，第二次与第一次的全部 SHA-1 一致，证明本次证据集可复现。

性能证据不复用同一进程：`bench-edit.mjs` 分别启动只读和编辑基准并输出机器可读指标。210 页 / 12810 元素下，默认路径的 slide/element `editInfo` 均为 0 且没有 package；回收后常驻 630.4MB → 634.1MB（+0.6%，预算 +40%）；一次覆盖提交、精确失效、页面投影和 SVG 重渲平均 0.418ms（预算 16ms）；全 210 页冷投影 36.65ms，缓存命中 0.03ms。预算检查已进入 CI 与发布流水线。

验证证据：`npm run check && npm test && npm run build` 全绿（core 1913、edit-core 42、metafile 130、162 个既有快照，加上 194 对编辑等价指纹）；`npm run bench:edit` 单独通过全部四项预算。

关闭前按技术方案 §10.2 复核发现：本票证明的是 M0 的编辑投影完成定义，但 M0 所列 8 个 core 加法中，元素级 SVG、HTML 文本和带字符偏移的行盒 API 尚未公开。已新增三个前置任务并阻断 M1 前沿，不能把本票的绿灯扩大解释为“整个 M0 已完成”。
