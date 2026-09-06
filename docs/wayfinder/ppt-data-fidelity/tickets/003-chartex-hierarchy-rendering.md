---
title: 原生渲染层级扩展图表
status: open
assignee: /root
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

## 已实现，等待来源验收

独立 `@web-ppt/core/chart-ex`、文稿固定解析配置、层级输入校验、稳定 squarify、分层旭日及图例/点颜色已实现。
与统计实现共享 104 项回归、八页真实 Chrome 屏幕/独立 SVG/PNG/打印和两条保存；原子框架与原始依赖完整保留。
两个方向的全局 hook 切换不改变已打开文稿，主题、母版与补丁保存后的重解析沿用原配置。

本票保持开放：缺原始层级 PPTX 与可原生显示现代图表的 Office oracle。现有 Windows 16.0 Build 4266
把八页固件及真实漏斗都显示为图片，不能据此确认层级方向和几何保真。见[详细边界](../../../chartex-native.md)。
