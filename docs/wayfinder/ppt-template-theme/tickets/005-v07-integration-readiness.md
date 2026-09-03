---
title: 完成 0.7 集成验收
status: closed
assignee: /root
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./001-theme-editing.md
  - ./002-layout-editing.md
  - ./003-master-editing.md
  - ./004-builtin-templates.md
---

## Question

主题、版式、母版和内置模板各自关闭后，如何证明它们组成同一条“选模板 → 改主题 → 改版式 → 改母版 →
编辑普通页面 → 保存交付”的产品路径，而不是四组只能单测调用的能力？

审计全部公开导出、设计画布 seam、普通页面权限隔离、editor/React/Vue adapter、官网入口、键盘/触屏路由、历史、
恢复与协同协议、补丁/生成保存、`.ppt` 另存、包边界、tree-shaking、错误文案和中英文文档。新增跨能力用户旅程，
从每套内置模板新建文稿，混合修改主题、母版、版式和页面直设，撤销/恢复后新增页面并保存重开；验证继承传播、
直接覆盖、占位符身份和未依赖分支的 DOM 身份都准确。

全部 0.7 Office 工件进入单一机器可读清单并逐件通过 LibreOffice；Windows PowerPoint 工作流只消费当前提交绑定的
同一清单。按实测更新 CHANGELOG、路线图、能力矩阵、断言数与八包体积，不创建 tag、不推送、不发布 npm。

验收：固件重生成两次字节一致，跨能力旅程在真实 Chrome 和 LibreOffice 通过，默认入口没有模板数据，八包 API、
版本与 README 一致；`npm run check && npm test && npm run build && npm run verify` 全绿且独立规格/标准审查归零，
才能关闭本票与地图。

## Outcome

- 极光、刊页、夜幕三套模板统一走完“模板 → 主题 → 母版 → 版式 → 普通页面 → 保存重开”；主题继承、设计
  画布、页面直设、占位符身份、撤销重做、恢复、补丁保存、生成保存与 `.ppt` 另存均从公开 seam 验证。
- 普通 `exec` / `transaction` 不能修改设计来源，`execDesign` 只接受匹配的版式或母版目标；纯命令校验发生在读取
  类型之前，嵌套粘贴也不能借设计画布中的组绕过权限边界。
- 真实 Chrome 完成三套模板的跨能力旅程，字段级协同 134 项断言覆盖同一组主题、母版、版式与页面修改；
  83 份固件连续重生成两次逐字节一致。
- 0.7 只保留一份 11 件 Office 清单，LibreOffice 逐件无修复打开；Windows PowerPoint 工作流消费同一清单，
  并校验提交、清单和产物哈希，不伪造当前非 Windows 环境的运行结果。
- `npm run check && npm test && npm run build && npm run verify` 全绿：4,628 项断言、186 个快照、524 对编辑
  等价指纹及 0.7 发布面审计通过；独立规格审查与标准审查均为零发现。
