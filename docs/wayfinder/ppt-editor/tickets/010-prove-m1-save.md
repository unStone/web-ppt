---
title: 证明 M1 最小写回与真实软件兼容
status: open
labels:
  - wayfinder:task
  - wayfinder:external-blocked
parent: ../map.md
assignee: /root
blocked_by:
  - ./009-set-xfrm-ooxml-patch.md
---

## Question

如何自动证明无编辑保存逐字节相同、移动单个形状只改变目标 XML 的 `a:off`、重复保存幂等，并让 LibreOffice 与 PowerPoint 打开时无修复提示？

## Resolution

- 当前自动证明 48/48 份可编辑 PPTX 无编辑保存逐字节同一；单形状移动只改变
  `ppt/slides/slide1.xml` 的目标 `a:off@x`，其余 ZIP 本地头、extra 与压缩流逐字节直通。保存产物重解析
  等于 EditDoc 有效投影，HTML 与原生 SVG 在干净进程中的指纹一致，相同状态再次保存复用同一包与 ZIP 字节。
- `npm run test:edit:m1` 的保存契约 242 项全绿；单一清单的 26/26 份当前 Office 产物均由
  LibreOffice 无修复/恢复诊断地打开、核对页数并导出 PDF，覆盖移动、删除、层级、剪贴板、文字、表格、
  新增/移动/删除/复制页面、格式、二维效果与图片替换裁剪。
- 新增只允许可信 ref 手动触发的 Windows 自托管工作流，固定 runner 标签
  `[self-hosted, Windows, X64, powerpoint]`，并要求前台交互会话。COM 验收按微软定义设置
  [`DisplayAlerts = ppAlertsAll`](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.application.displayalerts)，
  再以 [`Open2007(..., OpenAndRepair = msoFalse)`](https://learn.microsoft.com/en-us/office/vba/api/powerpoint.presentations.open2007)
  逐份只读打开，禁止静默修复。
- 机器可读报告绑定 Git revision、干净工作树、清单 SHA-256、每份 PPTX SHA-256、预期/实际页数、
  PowerPoint version/build、交互 session 与一小时时效；Node 校验器独立重读磁盘。9 项契约证明篡改字节、漏项、
  失败/过期报告、错误 revision、Session 0、错误页数与脏工作树都不能成为绿灯。运行手册见
  [`docs/powerpoint-runner.md`](../../../powerpoint-runner.md)。
- 修复后精确执行 `npm run check && npm test && npm run build`：core 2120、edit-core 636、保存 242、
  PowerPoint 报告 9、editor 283、56 份固件 / 169 页 / 338 对独立 SVG 指纹、metafile 130 全绿，五个发布包构建成功；
  Spec / Standards 双轴复审均为 0 finding。
- 当前 macOS 环境既无 Windows runner，也没有安装 Mac 桌面 PowerPoint，因而不能产生真实成功报告。
  票据继续保持 `open`；关闭前必须在上述工作流保留 run ID、revision、清单哈希、PowerPoint version/build 与
  26/26 成功结果，不能把“门禁设施已就绪”偷换成“PowerPoint 已验收”。
