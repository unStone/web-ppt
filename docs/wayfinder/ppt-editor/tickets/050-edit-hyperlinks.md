---
title: 编辑元素与文字超链接
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./006-preserving-xml-tree.md
  - ./008-command-patch-history.md
  - ./014-editor-session-static-view.md
  - ./030-basic-text-editing.md
  - ./044-move-slide.md
---

## Question

如何让任意 UI 框架通过公开纯数据命令和查询，为形状、图片及文字选区设置/移除外部链接或内部页面跳转，
同时让 edit 模式保持 PowerPoint 的“先选择、显式跟随链接”体验，view 模式安全路由，并让保存、撤销、页重排、
复制粘贴和跨实例迁移保持同一语义？

公开链接目标使用稳定领域类型，而不是把 OOXML action 或当前页码泄漏给 UI：外链只接受规范化的
`http:`、`https:`、`mailto:`，拒绝凭据、控制字符、危险 scheme 与超限输入；内链持有稳定 `SlideId`，
投影时才解析为当前 `slide:<index>`。元素命令沿用 `SetLink { id, target }`，文字选区沿用
`SetRunProps` 的 link 字段；必须能区分“显式移除”与“恢复来源”，并提供 mixed/source/override 感知的
`queryElementLink`、`queryRunLink`，工具栏不得读取 `src/ovr`。已有 next/previous/first/last、无法安全编辑的
action 或未知关系必须保留并可查询为只读来源，不能因为打开链接面板而被摊平。

编辑模式单击链接元素仍只负责选择；Ctrl/Cmd+Enter 或公开 `followLink` seam 才跟随，避免拖动/改字时误开页面。
查看模式内部链接交给 `viewer-core` 的稳定页路由，外链先经过调用方回调，默认打开时必须使用
`noopener noreferrer`；`javascript:`、`data:` 等内容即使来自畸形源文件也不能成为可点击 DOM。多 view
共享文档但各自持有交互状态，view 不安装编辑事件，销毁后不得残留监听器。React、Vue、Svelte、Web Component
和原生 UI 只绑定同一命令、查询、链接目标目录与 follow seam，不引入框架运行时依赖。

保存时元素链接写入非视觉属性的 `a:hlinkClick`，文字链接写入目标 `a:rPr/a:hlinkClick`；外链关系使用
`TargetMode="External"`，内链关系指向目标 slide part 并写 `ppaction://hlinksldjump`。同一 slide part 内相同
目标应复用关系，移除/替换时只有最后引用消失才清理旧关系；`a:hlinkMouseOver`、未知属性/子节点、相邻 run、
未触碰关系和其它 OPC part 保持原始字节。页面重排不改变内部目标，复制页/元素和跨文档粘贴必须把内部目标
映射到目标文档稳定身份；目标不存在时显式返回不可跟随状态，不能跳到错误页或产生悬空 OPC 关系。

确定性固件覆盖形状/图片/run 的外链、内部链接、动态相对动作、共享关系、未知扩展、混合文字选区、
重排与删除目标页。Node 从发布入口验证命令边界、三态查询、原子批量、历史、复制与最小保存；独立进程比较
HTML/原生 SVG；真实 Chrome 验证 edit/view 点击语义、多 view 增量 DOM、键盘可达性和危险 scheme 不可点击，
60 元素提交 p95 不超过 16ms、点击路由 p95 不超过 8ms。LibreOffice 必须无修复打开并验证外链关系、内部跳转
及显示文本；产物加入既有 PowerPoint 清单，等待外部真机门禁取证。本票不实现 mouse-over action、声音动作、
自定义放映、程序/宏链接、链接预览抓取或服务器安全扫描。

## Resolution

- 公开 `LinkTarget` 只含规范化安全外链或稳定 `SlideId`；元素走 `SetLink`，文字走
  `SetRunProps.link`，`null` 恢复来源、`none` 显式移除。`queryElementLink` / `queryRunLink` 统一返回
  effective/source/mixed/direct/readonly/followable，动态 action 与未知来源不会被面板摊平。
- core、edit-core 与渲染层共用单一外链安全边界。edit 单击只选择，`Ctrl/Cmd+Enter` / `followLink`
  显式跟随；editor view 与独立 `Viewer` 都支持鼠标和 `Tab`/`Enter`，内部跳页保持 view 本地稳定身份，
  外链回调与默认新窗口均隔离 opener，危险来源没有浏览器导航能力。
- 保存按 slide part 去重外链/内链关系，最小补丁元素 `cNvPr` 与文字 `rPr`；关系 GC 只回收本次退休且已无
  引用的关系。删除目标页会清理来源点击/悬停节点与悬空关系，未触碰关系、未知扩展和 hover 保持原样；
  页面重排及同文档/跨文档元素和文字复制粘贴均按稳定页面身份映射。
- 确定性固件连续生成 SHA-256 均为
  `edec6544ed73bad68e2779e308fe6f570ba483e07b21f5a393d25d1d795ab9e7`，覆盖共享/孤立关系、危险来源、
  形状/图片/run、相对动作与三页跳转。最终门禁为 core 2125、edit-core 661、保存 253、editor 283 项，
  57 份固件 / 172 页 / 344 对 HTML+SVG 独立指纹完全一致；真实 Chrome 超链接 60 元素提交/路由 p95
  为 2.7/0.1ms，完整 27 份 LibreOffice 工件无修复打开，其中 `hyperlinks.pptx` 验证外链、第三页内跳与文字。
- `hyperlinks.pptx` 已加入 27 份 PowerPoint 单一清单；当前环境没有 Windows PowerPoint，不能伪造真机成功
  报告。外部门禁仍由 [M1 真机票据](010-prove-m1-save.md) 保持 open，等待 runner 留存 27/27 证据。
