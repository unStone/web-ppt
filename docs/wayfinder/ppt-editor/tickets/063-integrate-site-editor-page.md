---
title: 官网独立接入可保存编辑器页面
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by: []
---

## Question

如何在不改变官网首页查看 Demo、也不把产品 UI 塞进无框架包的前提下，提供一个用户打开即可理解和操作的
独立编辑页面？页面需要继续走外部用户使用的包名边界，支持本地 `.pptx` 打开、选择、拖动、文字编辑、插入、
撤销重做、view/edit 切换、动画预览和保存下载；大对象页、窄屏与 GitHub Pages 子路径不能让画布消失或资源
404。尚不能安全保存的输入不得让用户先编辑再在最后一步失败。

## Resolution

- 新增 `editor.html` 独立入口，官网首页和样本库只增加导航链接，原查看 Demo 的启动、状态与资源生命周期不变。
  页面直接消费 `@web-ppt/editor` 的 `EditorSession`、`SlideEditor` 与 `SelectionPane`，没有复制编辑模型或播放层。
- 内置 `showcase.pptx` 打开即用，同时支持文件选择与整页拖放；工具栏接通 view/edit、撤销重做、形状/图片/
  表格插入、元素动画预览、适应/手动缩放和 PPTX 保存，左侧页导航与右侧对象窗格共享稳定身份。
- `.ppt` 的 headless 模型虽可临时接收命令，但生成式 PPTX writer 尚未实现；产品层因此强制进入 view、禁用编辑与
  保存并解释原因，避免用户完成修改后才发现无法带走结果。缺少安全写回上下文的 PPTX 使用同一边界。
- 当前页对象窗格保持自己的滚动容器；显式 `min-height: 0` 防止 144 形状页面把主网格撑到 9388px、把画布推到
  首屏之外。1050px 以下隐藏对象窗格，680px 以下压缩页栏与工具栏，390×844 和 1280×720 均实际截图检查。
- 真实 Chromium 已走通：默认 7 页载入、插入形状、脏状态、撤销/重做、view 模式禁用写入、跳到动画页播放、
  保存下载 `showcase-edited.pptx`；`.ppt` 只读边界与零 console warning 通过。`/web-ppt/editor.html` 生产子路径
  实际加载成功；干净提交构建的 HTML / 专用 CSS 分别为 2.10KB / 2.52KB gzip，编辑入口 chunk 为
  151.22KB gzip，三者都只在独立编辑页下载。
- 全仓 `npm run check && npm test && npm run build` 通过：2145 项 core、874 项 edit-core、370 项保存、9 项
  PowerPoint 证据契约、360 项 editor、9 项框架适配、478 对编辑等价指纹及 130 项图元文件断言均为绿色，
  七个发布包全部构建成功。
