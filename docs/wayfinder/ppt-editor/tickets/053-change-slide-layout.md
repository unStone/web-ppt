---
title: 为既有页面切换版式并保持内容
status: open
labels:
  - wayfinder:task
parent: ../map.md
blocked_by:
  - ./006-preserving-xml-tree.md
  - ./008-command-patch-history.md
  - ./014-editor-session-static-view.md
  - ./041-add-slide-from-layout.md
  - ./044-move-slide.md
  - ./051-edit-slide-background-hidden.md
---

## Question

如何用公开纯数据命令 `SetLayout { id, layoutId }` 为既有页面切换到当前文档中的另一真实版式，同时保留用户内容、普通元素、页面身份、备注和编辑历史，并让编辑预览与 PowerPoint 保存后的继承结果一致？

命令必须按稳定 `SlideId` 工作，只接受 `doc.layoutOrder` 中的目标版式。非占位符元素保持原位置、层级、内容和 OPC 锚点；占位符按 OOXML 的 `idx`、类型与回退规则重新绑定目标版式，保留页面上的文字、图片和用户直接覆盖，但有效几何、默认文字样式与缺省外观立即来自新版式。目标版式新增但页面尚无对应内容的占位符只能出现在编辑交互层，不能凭空写入业务内容；目标版式缺失的旧占位符不得静默丢字。无效版式、只读文档、跨文档版式和批量中途失败都必须在分配身份或改模型前原子拒绝。

`SlideRecord`、有效投影和缓存失效需要表达“来源页面内容不变、继承版式改变”这一本质，不能复制另一页，也不能把版式全部摊平成直接格式。所有挂载目标页的 edit/view 视图只重建该页；其它页 DOM 身份保持。撤销重做恢复同一页面、元素、选区与版式身份；移动、复制、删除、新增后仍按稳定页身份工作。React、Vue、Web Component 或原生导航只读取版式目录、查询结果和事务事件，不解析 OOXML。

保存只改目标 slide 的 slideLayout 关系目标；关系 id 尽量保持，关系不存在或会话中新页才按确定规则创建。页面 XML、notes、媒体、动画、未知扩展和未触碰 part 保持；连续保存幂等，保存重开后的有效元素、占位符继承、背景和动态字段与保存前一致。

确定性固件至少覆盖：同 `idx` 不同几何、按类型回退、目标缺少旧占位符、目标新增占位符、用户移动过的占位符、标题/正文文字、图片占位符、普通元素、主题背景、隐藏页、notes、动态页码与未知关系。Node 验证命令、查询、历史、最小 XML 与独立渲染指纹；真实 Chrome 验证双视图和 200 页单页换版式完整上屏 p95 小于 16ms；LibreOffice 打开、重存关系和渲染 oracle 通过，产物加入统一 PowerPoint 清单。
