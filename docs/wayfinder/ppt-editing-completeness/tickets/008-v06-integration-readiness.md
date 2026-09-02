---
title: 完成 0.6 集成验收
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./001-table-structure-editing.md
  - ./002-bullets-and-numbering.md
  - ./003-preset-shape-adjustments.md
  - ./004-advanced-run-formatting.md
  - ./005-common-object-and-slide-commands.md
  - ./006-touch-editing-gestures.md
  - ./007-batch-image-export.md
---

## Question

七条 0.6 能力各自关闭后，如何证明它们共同形成一致、可发现、可发布的产品面，而不是七组彼此割裂的命令？

对全部公开导出、editor/adapter seam、官网工具栏、快捷键/触屏冲突、恢复与协同协议、补丁/生成保存、包边界、
tree-shaking、错误文案和中英文文档做交叉审计；新增一份跨能力用户旅程，从新建文稿开始混合编辑表格、列表、
形状和页面，撤销/恢复后批量导出并保存重开。按实际构建更新 CHANGELOG、能力矩阵、断言数与体积，但不创建
tag、不推送也不发布 npm。

验收：固件连续生成两次字节一致，跨能力旅程在真实 Chrome 与 LibreOffice 通过，全部 Office 工件进入清单，
八包 API/版本/README 一致，`npm run check && npm test && npm run build && npm run verify` 全绿；审计确认地图
Destination 每项都有直接证据，才能关闭本票与地图。

## Answer

0.6 的产品面收敛为一条公开、可组合的路径：`createBlankPptx()` 新建文稿，`openEditor()` 进入同一
`EditorSession`，七类命令共享历史、恢复和协同协议；`session.toPresentation()` 提供不会保存、不会清空
dirty 状态的当前编辑投影，官网据此按需加载 `@web-ppt/core/image-zip` 批量导图，最后仍可选择补丁保存或
生成保存。React/Vue 只透传同一个会话，没有形成第二套能力模型。

跨能力旅程与独立审查暴露并修复了三个生成保存根因：动态页码字段此前被当成不支持的高级文字，替代文字此前
没有物化，生成字段的空 `rPr` 还会让保存分支丢掉完整字符外观。形状字段现在使用由 part、SPID、段落和 run
决定的稳定 ID，缺少来源样式时物化全部有效字符格式；表格字段仍显式拒绝，避免无来源节点时静默降级；生成
形状同时写入当前替代文字。editor 根入口补齐表格、段落、字符和预设几何查询，官网工具栏补齐当前编辑态图片
ZIP、触屏导航和长按请求，因而 API、产品入口和文档指向同一条路径。

默认查看链路没有吸收可选实现：图片 ZIP、生成保存、预设调节柄继续是独立入口，发布包保持 `sideEffects: false`；
editor 主入口只为必要的当前投影 seam 增加 428B gzip。图片透明度/灰度/双色调进入后续数据与保真地图，画布
AT 语义进入后续可访问性产品地图，File System Access 保持产品增强项；它们没有证据应改变本地图的 0.6 范围。

## Evidence

- `npm run test:fixtures:determinism`：80 份确定性固件连续生成两次逐字节一致。
- `npm test`：4460 项断言、186 个渲染快照、78 份固件 256 页的 512 对独立进程 SVG 指纹全绿；其中
  core 2230、edit-core 1050、保存 490、PowerPoint 证据契约 9、editor 420、adapter 9、collab 122、
  metafile 130。
- 真实 Chrome 覆盖同一跨能力旅程、三层 DOM、恢复、当前编辑投影与两页图片 ZIP；210 页压力样本保持
  并发上限 3，并释放 210 张位图。官网真实浏览器构建验证 image-zip 不在初始依赖图而由唯一动态块加载；
  人为延迟该分块时，新建/打开/重复文件任务均被隔离，最终下载 9098B ZIP 且 dirty 状态不变。
- 保存工件清单精确登记 68 份 PPTX，CI 直接消费该清单而不维护手写子集；`v06-integration-patch.pptx` 与
  `v06-integration-generated.pptx` 均保存重开并由 LibreOffice 导出两页 PDF。完整清单逐件通过 LibreOffice；
  Windows PowerPoint 只校验当前提交、工件字节和页数绑定的 9 项证据契约，没有伪造本机成功报告。
- `npm run build`：八个发布包均为 `0.5.0-beta.3`，README、许可证、公开入口完整；core 图片 ZIP、
  edit-core 生成保存、editor 顶点/调节柄继续按需。默认入口实测 core 91.01KB、edit-core 75.45KB、
  editor 67.34KB、viewer-core 8.10KB、React 1.12KB、Vue 1.34KB、fonts 2.69KB、collab 11.70KB gzip。
- `npm run verify`：290 项跨产物一致性检查与 28 项 0.6 发布面审计通过；中英文 README、CHANGELOG、
  官网能力入口、八包边界以及本地图的八张票都由静态门禁直接覆盖。
