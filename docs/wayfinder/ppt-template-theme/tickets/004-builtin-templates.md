---
title: 提供按需确定性内置模板
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./001-theme-editing.md
  - ./002-layout-editing.md
  - ./003-master-editing.md
---

## Question

现有 `createBlankPptx()` 只有一套最小骨架，不能称为模板选择。如何在不把固定二进制、字体字节或远程资源塞进
默认包的前提下，提供真正可选、可继续编辑的内置模板？

新增独立按需入口，公开稳定模板 id、名称、轻量预览 token 和 `createPptxFromTemplate(id, options)`；至少提供三套
视觉明显不同、业务中性的确定性配方，每套包含自洽主题、母版以及标题页、标题和内容、双内容、章节页、空白等
常用版式。模板由结构化配方复用生成保存物化，连续生成逐字节一致，不允许把生成结果 `.pptx` 反向提交为资产。
`createBlankPptx()` 保持字节与行为兼容，作为现有最小模板的快捷入口。

模板不能依赖网络、系统外字体、随机数或时间戳；自带预览只使用内联 SVG/纯数据并遵守两条文本渲染路径。新建后
全部主题、母版和版式都能经前三张票的公开 seam 编辑，新增页面、保存重开和 `.ppt` 另存路径不形成第二套模型。
官网新建入口和 React/Vue adapter 只消费同一模板目录。

验收覆盖确定性生成、全部版式可新增、主题切换后传播、母版/版式继续编辑、恢复与保存重开、LibreOffice 无修复
打开和真实 Chrome 模板选择；构建守卫证明模板目录及配方只存在于独立动态块，默认 core/edit-core/editor/site
初始依赖图与体积不增长。最终四段仓库门禁全绿。

## Outcome

- `@web-ppt/edit-core/templates` 公开冻结目录与 `createPptxFromTemplate()`；极光、刊页、夜幕三套结构化配方
  各自物化主题、母版、五种常用版式和可编辑标题页，连续生成逐字节一致，原有 `createBlankPptx()` 哈希不变。
- editor / React / Vue 只转发同一按需入口；官网选择器连 DOM、CSS 与配方一起延迟加载，初始入口实测
  215,418B gzip，不超过本票前 215,467B 基线；edit-core 默认入口为 82,500B gzip，不超过 82,503B 基线，
  默认发布入口均无配方泄漏。
- 新建文稿直接进入既有 `EditDoc`：主题、母版、版式、新增页、撤销重做、恢复、字段级协同与保存重开全部通过；
  两条文字路径的独立进程指纹一致，真实 Chrome 完成模板选择，LibreOffice 无修复打开三套模板及编辑产物。
- `npm run check && npm test && npm run build && npm run verify` 全绿：4,593 项断言、186 个快照、524 对编辑
  等价指纹及 311 项跨产物一致性检查通过。
