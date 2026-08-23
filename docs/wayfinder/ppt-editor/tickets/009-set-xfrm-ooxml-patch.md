---
title: 把 SetXfrm 精确补丁写回 OOXML
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./006-preserving-xml-tree.md
  - ./007-zip-passthrough.md
  - ./008-command-patch-history.md
---

## Question

如何利用元素溯源把位置、尺寸、旋转与翻转只写到目标 `a:xfrm`，正确处理普通形状、组内元素和 frame-editable 对象，且不摊平继承或触碰内部内容？

## Resolution

- 节点以 `origin.part + spid` 定点定位；宿主、非视觉容器和 `cNvPr` 均按展开名校验，支持
  PresentationML 形状/组/graphicFrame 与 `p14:contentPart` 墨迹，并拒绝缺失、重复和扩展区外来同名节点。
- `SetXfrm` 写 `x/y/w/h/rot`，`SetFlip{h,v}` 映射到 `flipH/flipV`；长度按 `px × 9525` 舍入为 EMU，角度按
  `deg × 60000` 写入。frame 只允许位置/尺寸，组的 `chOff/chExt` 和 frame 内部内容保持逐字不变。
- 首次触碰 part 时保存可结构化克隆的原始 XML 基线；后续保存从基线重建当前覆盖，因而保存后的
  undo/redo 能恢复继承而不摊平。包与基线原子刷新，被替换的自有包立即释放。
- 确定性固件覆盖异名前缀、组内元素、继承占位符、frame、外来同名节点和真实墨迹；五元素同页只改
  `ppt/slides/slide1.xml`。243 项编辑断言、25 份固件 206 对 SVG 指纹、LibreOffice 14,087-byte PDF 均通过。
- 210 页 / 50.6MB 真正执行三页命令、XML 序列化与 ZIP 保存为 107.6ms，436 条目直通；编辑内存增量
  +7.9%。发布入口实测初始 9.67KB gzip，保存能力首次按需增加 13.74KB。
