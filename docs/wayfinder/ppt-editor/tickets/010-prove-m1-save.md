---
title: 证明 M1 最小写回与真实软件兼容
status: open
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./009-set-xfrm-ooxml-patch.md
---

## Question

如何自动证明无编辑保存逐字节相同、移动单个形状只改变目标 XML 的 `a:off`、重复保存幂等，并让 LibreOffice 与 PowerPoint 打开时无修复提示？

## Resolution

- 已自动证明 17/17 份可编辑 PPTX 无编辑保存逐字节同一；单形状移动只改变
  `ppt/slides/slide1.xml` 的目标 `a:off@x`，其余 ZIP 本地头、extra 与压缩流逐字节直通。
- 保存产物重解析后与 EditDoc 有效投影逐字段一致；HTML 与原生 SVG 两条路径分别在干净进程中取指纹并完全相同；相同状态再次保存复用同一包与 ZIP 字节。
- `npm run test:edit:m1` 已让 LibreOffice 无修复/恢复诊断地打开同一产物并导出 13,999-byte PDF；全仓 `check`、`test`、`build` 与编辑性能门禁均通过。
- PowerPoint COM 验收器已实现：`DisplayAlerts = ppAlertsAll`，并以
  `Open2007(..., OpenAndRepair = msoFalse)` 打开。当前环境没有 Windows 桌面 PowerPoint，仍需在真机运行
  `npm run test:edit:powerpoint` 并保留成功输出；完成前票据保持 open。
