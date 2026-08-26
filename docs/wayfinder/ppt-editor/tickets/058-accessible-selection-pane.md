---
title: 实现可访问的选择窗格与对象锁定
status: done
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by: []
---

## Question

如何让被遮挡、隐藏或锁定的对象仍能通过一个框架无关、键盘可达的选择窗格被找到和管理，并让对象重命名、会话锁定/隐藏、层级顺序、画布选区和 React/Vue 宿主始终使用同一状态，而不把临时交互状态错误写入 `.pptx` 或拖慢文字输入与只读预览？

选择窗格必须按当前页真实可交互绘制序自顶向下展示完整元素树，保留稳定 `ElementId`、组层级、元素类型、有效名称、可编辑性、当前选中、锁定和隐藏状态；版式/母版中没有页面级身份的静态投影不伪造 `ElementId`。普通行可从窗格单选并进入正确组；锁定或隐藏行仍可聚焦、解锁或显示，但不能借窗格绕过画布的交互限制。树使用 `role=tree/treeitem`、正确的 `aria-level/selected/expanded`，支持上下/Home/End/左右、Enter/Space 和 F2；宿主可自定义样式而无需复制状态机。

`SetName { id, name }` 使用稀疏覆盖，`null` 恢复来源，写回对应宿主的 `p:cNvPr@name`，支持 shape、pic、group、graphicFrame 与会话新增对象；空白、控制字符、超长名称和不可写来源必须在落模前原子拒绝。撤销、重做、恢复日志、连续保存、恢复来源和未知相邻 XML 必须保持精确。

`SetLocked` 与 `SetElementHidden` 是会话交互状态：生成纯 JSON Patch、进入历史并在文稿本身仍脏时随崩溃日志恢复，但不改变 `Editor.isDirty()`、不改任何 OPC part。锁定/隐藏选中对象或其祖先时清理失效选区；锁定阻止画布选择与内容/变换命令，隐藏只改变编辑会话中对应 SVG 分区的 `visibility`。显示后必须清空自身声明，不能给后代写 `visible` 而顶掉隐藏祖先。

`@web-ppt/editor` 提供唯一 DOM 控制器并由 adapter 同步文档、页、edit/view 模式和销毁；React/Vue 只提供薄挂载组件或 ref。默认预览、独立 SVG/PNG、保存产物和只读解析不得携带会话隐藏/锁定状态。确定性固件覆盖两层组、同名对象、特殊 XML 名称、frame 与跨页。

Node 契约验证命令严格性、查询顺序、历史/dirty 分离、恢复和最小 XML；真实 Chromium 验证无障碍树、键盘、改名、锁定/隐藏、组继承、多视图与 adapter/React/Vue 生命周期。60 元素页的窗格操作到完整 DOM 反馈 p95 不超过 16ms；未涉及目录状态的文字或几何提交不得重建窗格 DOM；只读路径体积和性能门禁继续通过。

## Resolution

- `edit-core` 以当前可交互投影树提供稳定目录查询；名称使用稀疏覆盖和最小 `cNvPr@name` 写回，锁定/隐藏仅进入会话历史与恢复日志。祖先锁定由命令分发表统一执行，读取查询不受影响，版式切换不会留下旧继承幽灵对象。
- `editor` 提供唯一的可访问 DOM 树控制器，完成键盘导航、组合折叠、选择、重命名、锁定/隐藏和 SVG 可见性同步；框架无关 adapter 统一页、模式与销毁，React/Vue 仅薄挂载。
- 确定性固件重跑字节一致。`npm run check && npm test && npm run build` 全绿：core 2135、edit-core 794、保存 313、PowerPoint 证据契约 9、editor 331、adapter 8、渲染等价 376 对、图元文件 130 项；真实 Chrome 的 60 元素锁定往返 p95 0.4ms。
- 保存产物 `selection-pane.pptx` 已进入统一 Office 清单，LibreOffice 实际打开并导出 2 页 PDF；真实 Windows PowerPoint 打开验证仍由既有外部阻塞任务 010 承担，不以清单覆盖冒充实测。
