---
title: 建立 EditDoc 与有效投影
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by:
  - ./002-editable-parse-provenance.md
  - ./003-editable-geometry.md
---

## Question

如何建立无 DOM 的 `@web-ppt/edit-core`、稳定身份、`src/ovr` 双层记录与缓存失效模型，并把任一页投影回现有 `Slide` 而不复制渲染逻辑？

## Resolution

答案是新增独立发布、无 DOM 的 `@web-ppt/edit-core`，让编辑状态只负责身份、差异和投影，继续把唯一渲染实现留在 core：

- `createDoc` 把已解析页面固化成纯数据 `EditDoc`：页与组内元素统一扁平记录，`src` 保持解析值，`ovr` 只保存用户改动，`parent` / `children` 保留树关系。身份前缀与自增游标也进入文档，因此 structured clone 或恢复后不会复用旧 id；省略前缀时用 Web Crypto 生成会话身份。
- 兄弟元素使用普通字符串即可比较的分数序。`initialFractionalIndex` 为导入元素预留插槽，`fractionalIndexBetween` 可无限向头尾或相邻项插入；协同时第三个参数接新元素 ULID，把同一区间并发插入确定性地区分开。
- `effectiveElement` / `toSlide` 把 `src + ovr` 投影回现有 `SlideElement` / `Slide`，形状与图片在宽高变化后调用 core 的 `resolveGeomPath` 重算派生路径，组按子 id 重建。渲染器完全未复制，也不认识 `EditDoc`。
- 投影缓存存在 `WeakMap<EditDoc, ...>`，不污染可序列化模型。`invalidateElement` 只清除目标、组祖先和所属页，`invalidateSlide` / `invalidateAll` 处理页属性和批量变化；无关页保持引用命中。
- `editable` 在解析边界分成 `full | frame | none`：表格仍是完整编辑对象；图表、SmartArt、OLE、墨迹、媒体与不支持对象只允许框架变换，其派生子节点不可独立编辑。缺少 OOXML 回写锚点的节点降为 `none`；缺少原包或页锚点的 `.pptx` 文档整体显式 `readonly`，`.ppt` 保留后续生成式 `.pptx` 路径。
- 公开 API 还包括 `createEmptyDoc`、身份分配、页面归属查询、精确失效与 `disposeDoc`。后者接管并幂等释放解析器保留的 OPC 包；运行时代码只外部依赖 `@web-ppt/core/geometry`。

测试覆盖 5000 次固定种子乱序插入、协同同位插入、默认/确定性身份、父链与 z 序、纯数据克隆、源值不变、几何重算、组级失效、无关页缓存、无 `document` 运行、只读降级、`.ppt` 转换模型，以及图表/SmartArt/OLE 的框架保护。`showcase.pptx` 全 7 页的直接渲染与 `EditDoc → toSlide` 渲染在相同 `idPrefix` 下逐字节一致。

验证证据：`npm run check && npm test && npm run build` 全绿（core 1913、edit-core 42、metafile 130、162 个快照）；210 页 / 12810 元素实测建模 10.9ms、冷投影 36.3ms、缓存命中 0.04ms，单元素失效并重投影 10000 次平均 0.024ms（预算 16ms），编辑常驻 634MB 对只读 630MB，约 +0.6%（预算 +40%）。发布 JS 为 2.92KB gzip，`npm pack --dry-run` 仅 10 个文件、14.0KB tarball，dist 入口也通过真实导入冒烟。
