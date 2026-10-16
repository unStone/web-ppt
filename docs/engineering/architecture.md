# 架构总览

纯浏览器端 PPT 引擎：`.pptx` / `.ppt` → 统一 JSON Schema → SVG。零服务端，基础包零框架，`@web-ppt/core` 唯一运行时依赖是 fflate。编辑器产品层（`site`）使用 Cordis，但不进入任何发布包。

## 1. 包与依赖

```mermaid
flowchart TD
  subgraph published["发布包（八个，版本联动）"]
    core["@web-ppt/core<br/>解析 / 渲染 / 导出"]
    editcore["@web-ppt/edit-core<br/>编辑文档模型 + 投影"]
    viewercore["@web-ppt/viewer-core<br/>headless 状态机 + 播放"]
    editor["@web-ppt/editor<br/>编辑会话 + 三层 DOM 视图"]
    react["@web-ppt/react"]
    vue["@web-ppt/vue"]
    fonts["@web-ppt/fonts"]
    collab["@web-ppt/collab"]
  end
  subgraph private["私有包（不走 npm）"]
    viewer["viewer<br/>开箱即用查看器"]
    site["site<br/>官网 + 编辑器产品"]
  end
  editcore --> core
  viewercore --> core
  editor --> core & editcore & viewercore
  react --> editor
  vue --> editor
  fonts --> core
  collab --> editcore
  viewer --> core & viewercore
  site --> core & editcore & editor & fonts & viewercore
```

| 包 | 职责 | 依赖方式 | 运行时依赖 |
|---|---|---|---|
| `core` | 四条链路解析 → 统一 Schema → SVG / PNG / PDF 导出；无 DOM 依赖，可整包进 Worker | — | fflate |
| `edit-core` | 编辑文档（源值 + 覆盖）、命令与历史、有效投影、补丁/生成保存；无 DOM 依赖 | peer `core` | fflate |
| `viewer-core` | 纯状态机 `PresentationState` + 播放（动画/切换/墨迹/视频），DOM 耦合仅 Viewer 一处 | peer `core` | — |
| `editor` | 编辑会话、三层增量 DOM 视图、手势/键盘/吸附、文本编辑面、IndexedDB 恢复存储 | peer `core` + `edit-core` + `viewer-core` | — |
| `react` / `vue` | 组件 + hook 薄适配，只包 `editor` 公开 seam | peer `editor` + 对应框架 | — |
| `fonts` | 字体替换表、按需加载、字形子集 | peer `core` | — |
| `collab` | 字段级 LWW 协同：原子补丁、BroadcastChannel 传输、冲突解决与检查点 | peer `edit-core` | — |
| `viewer`（私有） | 工具栏 / 缩略图虚拟化 / 批注面板 / 导出的完整查看器页面 | 直接依赖 | — |
| `site`（私有） | 官网、浏览器内 Demo、Cordis 编辑器应用 | 直接依赖（按包名消费） | cordis、harfbuzzjs、mtx-decompressor 等 |

`viewer` 与 `site` 通过**包名**消费上游，与外部用户走同一条路径，边界被破坏会立刻编译失败。发布顺序：`core` → `edit-core` → `viewer-core` → `editor` → `react` → `vue` → `fonts` → `collab`。

**为什么 viewer-core 是独立包**：`Viewer` 里真正耦合 DOM 的只有约 24 行（塞 SVG、设可见性、调播放），其余 200 多行是纯状态推进。拆开后 React / Vue / Svelte 可直接驱动 `PresentationState`；状态逻辑不需要 jsdom 就能在 Node 里测；`core` 完全不碰 `document`，可整包进 Worker。抽出当天就测出一个 939 项断言从没碰到的真 bug：`skipHidden` 下若后续全是隐藏页，`next()` 会落在最后一张隐藏页上——当时的固件里没有一张隐藏页，此后补上了 `sample-hidden.pptx` / `.ppt`。

## 2. 数据流：从文件到画面

```mermaid
flowchart LR
  subgraph parse["core：四条解析链路"]
    PPTX[".pptx<br/>Zip + OOXML"]
    PPT[".ppt<br/>CFB + Escher"]
    META["EMF / WMF / PICT<br/>GDI 解释器"]
    CHART["chart XML<br/>c: 与 cx:chartSpace"]
  end
  SCHEMA["统一 Schema<br/>core/src/types.ts"]
  PPTX & PPT & META & CHART --> SCHEMA
  SCHEMA --> HTML["foreignObject + HTML 排版<br/>屏幕预览 · PNG"]
  SCHEMA --> NATIVE["原生 text + 自实现断行<br/>独立 SVG · 打印 HTML · 矢量 PDF"]
```

格式按魔数识别（`PK` → pptx，`D0CF11E0` → ppt），不看扩展名。两条文本渲染路径**不可合并**：`foreignObject` 只有浏览器认，交出去的文件必须自包含；WebKit 十五年未修的缩放 bug 由 `viewer-core` 运行时探测降级。图表 / 图元解码 / 解密 / 3D / MTX 字体解压经 hook 注入，可 tree-shake。

### core 内部模块

| 模块 | 职责 |
|---|---|
| `pptx/` | OOXML 解析：包读取、主题、母版/版式继承、动画、表格样式、批注、SmartArt、OMML |
| `ppt/` | 二进制格式：自研 CFB、Escher 记录流、主题、timing |
| `image/` | EMF / WMF / PICT 图元文件解码 |
| `chart/` | 经典图表 XML → `SlideElement[]`（是解析链路，不是渲染插件；hook 为打破模块环） |
| `chart-ex/` | Office 2016+ `cx:chartSpace` 扩展图表 |
| `geometry/` | 格式无关的 ECMA-376 全部 187 个预设形状求值，零 import |
| `render/` | SVG 渲染：只依赖 `types.ts`；填充、效果、CJK 标点挤压、文本测量与断行 |
| `pdf/` | 矢量 PDF 导出：路径、渐变、图案、字体资源 |
| `crypto/` | 加密文档解密（hook 注入） |
| `font/` | 嵌入字体 EOT 容器剥离（MTX 解压走 `setFontDecoder` hook） |
| `ink/` `three-d/` | 墨迹、3D 效果 |
| 顶层 | `types.ts`（Schema）、`xml.ts` / `xml-lite.ts`（Worker 里无 DOMParser 的回退）、`browser-export.ts`、`canvas-png.ts`（光栅导出共用的同步 PNG 编码，避开 `toBlob` 的空闲调度）、`worker.ts`、`anim-steps.ts`、`transition.ts` |

## 3. 数据流：编辑闭环

领域概念（源值 / 覆盖 / 有效投影 / 补丁保存 / 生成保存）定义见 [CONTEXT.md](../../CONTEXT.md)。

```mermaid
flowchart LR
  SRC["源文件解析<br/>只读 Presentation"] --> SESSION["Editor 会话<br/>edit-core"]
  UI["手势 / 键盘 / 检查器<br/>editor 包"] --> CMD["commands + history<br/>事务与撤销"]
  CMD --> SESSION
  SESSION -->|"源值 + 覆盖 合成"| PROJ["有效投影<br/>只读 Slide 视图"]
  PROJ --> RENDER["core render"]
  RENDER --> DOM["三层 DOM 视图"]
  SESSION -->|"原包可写"| PATCH["补丁保存 .pptx"]
  SESSION -->|"无原包"| GEN["生成保存 .pptx / .ppt"]
  COLLAB["collab<br/>LWW 补丁"] <--> SESSION
```

三层 DOM 视图（定义见 [design/editing-design.md](../design/editing-design.md#10-渲染层改造与三层视图)）：

| 层 | 内容 | 更新粒度 |
|---|---|---|
| ① 静态 | `renderSlideToSvg` 产物 | 事务提交后脏元素级 patch |
| ② 交互 | 选框、手柄、参考线 | 每帧直接改属性 |
| ③ 文本编辑面 | `contenteditable` | 段落级 |

### edit-core 内部分域

| 域 | 代表模块 |
|---|---|
| 文档模型 | `document.ts`、`document-extensions.ts`、`identities.ts`、`element-*` |
| 命令与历史 | `commands/`、`history.ts`、`transaction-validation.ts` |
| 投影 | `projection.ts`、`dynamic-projection.ts`、`layout-projection.ts`、`theme-projection.ts`、`design.ts` |
| 保存 | `save/`（补丁 + 生成）、`ppt/`、`opc/` |
| 设计系统 | `theme.ts`、`master.ts`、`layout.ts`、`templates/`、`design-*` |
| 文本模型 | `text-model.ts`、`text-position.ts`、`text-search.ts`、`paragraph-*` / `run-*` |
| 剪贴板 | `clipboard*.ts`（含富文本可移植包） |
| 恢复 | `recovery*.ts`、`recovery-migrations.ts` |
| 对象域 | `chart/`、`chart-shared/`、`smartart/`、`ole/`、`ink/`、`media/`、表格系列 |
| 协同支撑 | `collaboration-identity.ts`、`change-classification.ts`、`patch-events.ts` |

## 4. 字体体系

嵌入字体是 EOT 容器且普遍开 MTX 压缩，`core/font/eot.ts` 剥容器，MTX 解压经 hook 注入（官网接 `mtx-decompressor`）。`fonts` 包提供替换表与按需加载，`site` 按文稿作用域持有 Provider / Worker / FontFace。SVG 作为 `<img>` 加载时是隔离上下文，非系统字体必须把 `@font-face` 与 base64 字节内联进 SVG。

## 5. 产品层

| 包 | 结构 |
|---|---|
| `viewer` | 单页查看器：缩略图虚拟化、搜索、批注面板、导出 |
| `site` | Vite 多页面：官网（中英双语 + 实时 Demo）+ 编辑器应用。编辑器按 Cordis 插件分层：页面 / 打开 / 恢复 / 文件 / 业务工具为应用级插件，视图 / 字体 / 工具为文稿作用域插件，分层与生命周期约定见 [design/cordis-editor.md](../design/cordis-editor.md) |

## 6. 测试与质量体系

| 组成 | 说明 |
|---|---|
| `fixtures/` | 全部由 `tooling/make-*.mjs` 确定性生成，重跑字节必须一致 |
| `test/snapshots/` | 两条文本路径的归一化快照基线；只发现「变了」，保真度另靠 ground truth |
| LibreOffice 对照 | `npm run compare` 产出 SSIM / MAE / 热力图，用于横向比较与定位整片偏色 |
| 边界审计 | `tooling/check-*-boundary.mjs`：模板、图表数据、媒体、chartex、i18n、字体等模块边界 |
| dist 复验 | 多数测试以 `--dist` 再跑一遍（`npm run verify`），验证发布产物而非仅源码 |
| 交叉进程指纹 | 渲染结果含跨解析累加的 defs id，同进程不可重复比对，见 `tooling/lib/ppt-fingerprint.mjs` |
| 编辑等价 | 全固件只读 / 编辑投影独立进程指纹 + PowerPoint / LibreOffice 真实打开验证 |

门禁关系与测试贡献规范见 [testing.md](testing.md)；断言、快照与体积的实测数字由 `npm run verify` 与 README / AGENTS 比对，不在此重复。

## 7. 约束与发布

不可破坏的约束以 [AGENTS.md](../../AGENTS.md#不可破坏的约束) 为准，分层与依赖细则见 [architecture-rules.md](architecture-rules.md)；版本联动、流水线与发版 checklist 见 [releasing.md](releasing.md)。
