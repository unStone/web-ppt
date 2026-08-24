---
title: 节流 normAutofit 文字输入重排
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./035-table-cell-text-editing.md
---

## Question

如何让带裸 `a:normAutofit` 的形状或表格单元格在连续输入时立即提交纯 JSON 文字模型，
但最多每 100ms 重算一次有效 `fontScale`，从而避免每个按键都执行多轮测量与字号跳动，
同时保证 browser/engine 编辑面、退出后静态预览与保存重开的排版语义一致？

本票沿三个已发布 seam 做 TDD：`Editor.exec(EditText)` 必须在同步输入事件内更新文本与
历史；`renderTextBodyToHtml(..., { scale })` 接受已解决的有效比例，两种行盒生产者都不再重复解
autofit；`openEditor(...).mount(...)` 的文字控制器在输入突发期沿用上一个有效比例，定时到点后
重排一次并恢复 DOM Range。定时器必须归当前视图所有，切格、退出文字、切页、切 view 或
`destroy()` 都不得留下延迟 DOM 写入。

有效比例是派生排版状态，不得写入 `src`、通用文字覆盖或历史 Patch；用户未显式设置
`fontScale` 时，保存仍保留 `a:normAutofit` 继承/缺省语义。撤销、重做、远端模型更新、IME 组词结束和
字符/段落格式改变都必须进入同一节流重排路径，不得另立 browser 特例。

确定性 engine/autofit 固件覆盖从当前比例跨过新断行阈值的连续输入。Node DOM 合约必须观测到
100ms 窗口内比例稳定、窗口后一次收敛，且销毁后不再触发。真实 Chrome 对 browser/engine 各测
80 次连续输入：单键模型到 DOM p95 不超过 30ms，100ms 窗口内无字号抖动，到点后比例与
`layoutText` 的有效比例一致。保存后 core 重开文字逐字符相等，未触碰 XML 和两条预览指纹不变，
LibreOffice 打开不得修复。

本票不实现 `spAutoFit` 改高；它会改元素几何、选择框与 `a:xfrm/a:ext`，必须由后续独立命令和
写回任务承担。

## Resolution

`renderTextBodyToHtml(..., { scale })` 现在允许视图传入已解决的有效比例；公共
`layoutText` 求解、browser/engine 编辑面与原生 SVG 静态预览统一使用实际
`insets/vert` 内容盒。编辑视图以结构化形状/单元格身份持有上一个比例，
`EditText` 仍同步提交模型，持续输入期间最多每 100ms 求解并恢复 Range；该比例不进入
文档、历史或保存 XML。

可观测假时钟证明切格、退出文字、切页、切查看模式、切共享视图和销毁均会
取消待执行任务；Node DOM 225 项、edit-core 420 项、保存 41 项均通过。
真实 Chrome 以跨多个节流窗口的 80 次连续输入证明不是 debounce，browser/engine/
自定义边距 `vert270` 单元格 p95 分别为 2.600/3.500/2.600ms，最终比例与
`layoutText` 一致。

表格固件连续生成哈希均为
`9cc7f8bbdf23d406a0c5c7da6cca3786f44ec978594a42a1b855fcab38dbfa0d`；41 份固件 /
137 页 / 274 对独立进程原始 SVG 指纹完全一致。保存产物由 LibreOffice 无修复打开，
engine/表格分别导出 125140/107052-byte PDF；CI 已显式纳入两份产物。
Spec/Standards 双轴终审均为 0 findings。`spAutoFit` 改高仍留给独立结构命令。
