---
title: 切换预设形状并拖动调节柄
status: closed
labels:
  - wayfinder:task
parent: ../map.md
assignee: /root
blocked_by: []
---

## Question

模型已保留预设名与 `adj`，公共几何层能求值全部 187 个预设，但编辑器只能新增预设形状或把它永久转换为
自由形状。如何提供严格的预设切换与调节值命令，并从 ECMA-376 预设定义生成可按需加载的 XY/极坐标调节柄，
让用户直接拖动而不把手写元数据或新增体积压到默认渲染路径？

切换预设必须保留 frame、文字、填充、描边、效果与链接，按明确规则处理旧 `adj`/自由形状覆盖；调节柄要
公开位置、约束和命中的无 DOM 描述，拖动时按 min/max 夹逼并形成一个可撤销事务。投影、保存与重开必须
回到规范 `a:prstGeom/a:avLst`，不能物化为近似自定义 path。

验收：生成式句柄表可追溯到同一预设源，至少覆盖 XY、极坐标、多手柄和无手柄形状；187 预设求值无 NaN，
确定性固件、历史/恢复/协同、补丁与生成保存、LibreOffice 几何 oracle、独立进程指纹及真实 Chrome 拖动
精度/帧预算通过；主入口无意外增长，四段仓库门禁全绿。

## Answer

`SetPreset` 与 `SetAdj` 以 `presetGeometry` 稀疏覆盖表达预设真值；预设与自由几何的每次写入都会给对侧
字段发送 tombstone，因此本地历史、恢复和字段级 LWW 协同都不会留下两种覆盖。投影按有效 `preset + adj`
重算路径，两种保存路径统一写回 `a:prstGeom/a:avLst`。

调节柄表由 Apache POI 固定提交的预设定义生成，公开无 DOM 的解析、夹逼、反求与命中 API。全部公式在
DrawingML EMU 坐标中求值，位置输出才换成 CSS px。`core/geometry/handles` 和 `editor/adjustments` 分别
独立构建；拖动期间只替换 interaction 层句柄，结束时把变化的调节值合成一个事务。

## Evidence

- 生成源 commit `6d94ace657249b487959dd654ca9d9b1c6014e4e`，SHA-256
  `4a762444d8d85876881c02a5b1dedf6f73006fcd8acb7b4e393435615b37c780`；187 个预设、120 个含句柄，
  句柄表与固件连续生成哈希一致。
- 187 预设路径/句柄有限值与同点拖拽恒等；覆盖 XY、极坐标、多手柄、无手柄、旋转拖动、命中和约束。
- 1009 项 edit-core、469 项保存、115 项协同与 496 对独立进程指纹通过；LibreOffice 几何 oracle 及
  补丁/生成式产物真实打开通过。
- 官网形状目录与调节柄入口、Chrome 预览不改模型、pointer capture、单历史提交、保存重开和 60 元素
  帧预算通过；批量删除 p95 为 7.2ms。历史条目字节只在内容变化时计量，无补丁订阅时不构造深拷贝事件，
  消除了可选历史/协同接缝的固定成本；core/edit-core/editor 默认入口均由构建守卫证明不含句柄表。
