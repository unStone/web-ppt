---
title: 把 SetXfrm 精确补丁写回 OOXML
status: open
labels:
  - wayfinder:task
parent: ../map.md
assignee:
blocked_by:
  - ./006-preserving-xml-tree.md
  - ./007-zip-passthrough.md
  - ./008-command-patch-history.md
---

## Question

如何利用元素溯源把位置、尺寸、旋转与翻转只写到目标 `a:xfrm`，正确处理普通形状、组内元素和 frame-editable 对象，且不摊平继承或触碰内部内容？

## Resolution

<!-- 完成时记录节点定位、单位换算、边界用例与 part 差异。 -->
