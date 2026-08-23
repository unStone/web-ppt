---
title: 公开共用 HTML 文本渲染
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./005-prove-m0-equivalence.md
---

## Question

如何从 `foreignObject` 预览路径提取无 DOM 的 `renderTextBodyToHtml`，让预览和后续 contenteditable 覆盖层复用完全相同的段落、run、CJK 标点、分栏与 autofit 标记，同时不合并可移植 SVG 文本路径？

## Resolution

答案是把原先埋在 `svg.ts` 的整段 HTML 排版抽成独立、无 DOM 的 `render/text-html.ts`，并从 `@web-ppt/core` 公开：

```ts
renderTextBodyToHtml(
  text: TextBody,
  width: number,
  height: number,
  options?: {
    insets?: readonly [number, number, number, number];
    anchor?: TextBody['anchor'];
    vert?: TextVert;
    includeEditMarkers?: boolean;
  },
): string
```

返回值是带 XHTML 命名空间的根 `<div>`，不含 `foreignObject`，也不设置 `contenteditable`：core 只负责确定性排版，DOM 适配层拥有焦点、IME、选区与销毁生命周期。形状和表格单元格的 `foreignObject` 预览都调用这个入口并关闭编辑标记，因此原有 SVG 字节不变；编辑覆盖层使用默认标记，直接把同一个根节点放在 SVG 外并用 CSS 变换贴到元素上。

编辑标记的边界已经落定：每个段落带 `data-p="段序"`，每个 run 带 `data-r="段序.run序"`；根节点带有效的 `data-font-scale` 与 `data-autofit`，空 run 用 `data-empty` 区分为了撑行高而输出的 NBSP，项目符号用 `data-bullet` 标出并设为不可直接编辑。公式 run 的身份落在其原子 SVG 根上，不增加会改变行盒的 wrapper。`includeEditMarkers: false` 只移除这些语义属性，排版 HTML/CSS 与编辑版一致。

自动缩放、段落、run、数学公式、超链接、项目符号、CJK 标点挤压、RTL、竖排和分栏逻辑全部只保留一份。裸 `normAutofit` 在公共入口内部计算有效比例且不修改输入；艺术字静态预览仍按原约束走原生 SVG，公共 HTML 返回未变形编辑形态，提交后再恢复变形预览。原生 `<text>` 导出路径没有合并或改写。

HTML 安全边界也在公共入口统一：文本、属性和 CSS 属性边界均转义，字体名额外做 CSS 字符串编码；`http`、`https`、`mailto`、`tel` 与相对链接可点击，`javascript:`、`file:` 等协议只保留为 `data-unsafe-href`，不生成 `href`。调用方传入的颜色、渐变和阴影仍应是 core Schema 的规范化 CSS 值；编辑器反解 DOM 时只接受技术方案规定的白名单节点。

Safari 约束没有被掩盖：编辑器不得把静态 `foreignObject` 直接变成 contenteditable，而应把此函数的输出挂在 SVG 外。Safari 探测切到原生 SVG 文本后，逐行绝对定位的 `engine` 覆盖层仍需要 [公开带字符偏移的文本行盒](013-layout-text-api.md)；本票只完成两种模式共用的 HTML 内容与样式边界。

验证覆盖现有全部 17 份核心固件的 1163 个形状/单元格文本体：全部是合法 XHTML，段/run 身份完整；其中 1145 个普通 HTML 预览逐字节包含公共入口的无标记输出。恶意文本、字体、颜色、图片地址和链接协议不能注入节点或事件属性，API 在 `document = undefined` 下运行，输入 `TextBody` 不被修改。162 个快照完全不变；22 份固件、97 页、194 对只读/编辑原始 SVG 指纹仍完全一致。

210 页 / 12810 元素基准中，编辑 HTML 生成 0.004ms/次，生成并替换 DOM 为 0.143ms/次，远低于 8ms / 30ms 预算；编辑常驻内存增量 +0.9%。构建后的 core 为 86.45KB gzip，较上一票 86.14KB 增加约 0.31KB。npm dry-run 包含 ESM、声明与文档，共 52 个文件、187775 字节；构建产物可直接导入新函数。

`npm run check && npm test && npm run build` 全绿（core 1955、edit-core 42、metafile 130、162 个快照、194 对编辑等价指纹），`npm run bench:edit` 通过全部性能预算。
