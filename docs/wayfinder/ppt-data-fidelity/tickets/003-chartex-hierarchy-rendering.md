---
title: 原生渲染层级扩展图表
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./002-chartex-fallback-corpus.md
---

## Question

如何把 `cx:chartSpace` 的层级数据解析成格式无关 Schema，并原生渲染树状图和旭日图，同时保持未知扩展、
fallback 和默认经典图表路径不受影响？

新增独立 chartex 解析入口与 hook，解析系列、层级标签、父子关系、颜色、标签和布局属性；树状图使用稳定
squarify，旭日图使用按层极坐标堆叠，零值、负值、空值、单子树、深层级和极窄区域都有确定退化规则。
输出只包含现有 `SlideElement[]`，`render/` 不认识 cx；解析失败逐对象回退到 Office 预览图。

验收以真实语料和确定性缩减固件交叉证明，覆盖两条文本路径、主题色、标签裁剪、DOM 身份、tree-shaking、
浏览器性能与 LibreOffice 对照；默认 core 入口不携带 chartex 代码或样本数据。
