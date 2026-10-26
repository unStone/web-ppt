# 格式限制

本页列出会影响使用决策的已知限制；能力全景见[格式能力矩阵](format-capabilities.md)，按需扩展入口的边界见[扩展能力矩阵](expanded-capabilities.md)。

| 项 | 说明 |
|---|---|
| .ppt 的发光 / 柔化 / 倒影 | **格式本身没有这些属性**——它们是 DrawingML(2007+) 的概念，OfficeArt 二进制里无从表达（外阴影已支持） |
| .ppt 的 3D | OfficeArt 有挤出属性（`c3DExtrude*`/`c3DBooleans`），但缺可信样本：LibreOffice 转换会把 3D 烘进 cube 预设几何又保留 3D 属性，照此实现会双重叠加 |
| .ppt SmartArt | 未实现（自动编号与嵌套组均已支持） |
| OMML 公式 | 分式、根式、脚标、大算符与矩阵已做结构化 SVG 排版；复杂细节的保真度依赖可用字体 |
| 艺术字包络型预设 | `textPath` 只能弯曲基线，`textInflate` 等不会按位置缩放字形 |
| 3D | 真实相机投影（XYZ 矩阵、正交 / 透视、挤出、曲线斜角）；材质、光照与纹理网格为近似 |
| EMF+ | 按需入口 `@web-ppt/core/emf-plus` 支持常见绘图（路径、渐变、图片、文字、裁剪等）；未知记录按格式回退，纯 EMF+ 文件仍无样本 |
| 光栅操作码 | SVG/CSS 没有 XOR/AND 位运算混合，`mix-blend-mode` 不等价 |
| chartex 新图表 | 独立 `@web-ppt/core/chart-ex` 已实现除地图外的原生布局，宿主显式启用；默认使用 Office 回退。真实漏斗、两条保存和浏览器已验证，其他类型真实 PPTX 与 Office 原生布局验收待补。见[能力与边界](chartex-native.md) |
| Region 的 OR / XOR / DIFF 组合 | 需要区域布尔运算，SVG 裁剪表达不了；COPY 与 AND 已支持 |
| MTX 压缩的嵌入字体 | PowerPoint 的 `fntdata` 是 EOT 容器，绝大多数还开着 MTX 压缩。未压缩的容器 core 自己剥（含异或混淆），压缩的需要注入解码器：`setFontDecoder(eotToTtf)`（来自 [`mtx-decompressor`](https://www.npmjs.com/package/mtx-decompressor)）。不注入就跳过这些字体，回退到替换字体，而不是塞一份浏览器注定拒绝的字节 |
| 字体缺失导致的断行差异 | 断行由**实际字体的度量**决定：缺原字体时，字宽变化会改变换行。装原字体、使用文件自带的嵌入字体，或接 [`@web-ppt/fonts`](../../packages/fonts) 加载替代字体。Calibri→Carlito 度量兼容；缺等线时西文用 Arial 度量族合成（按需加载时用 Arimo）：按 PowerPoint 导出图实测，粗体整体缩到 95.4%、下划线缩到 74.6%，断行与填空线长度与 PowerPoint 一致；代价是粗体字形略小，空格仍比等线宽约 0.03em |
| CJK 标点挤压 | 完整规则：行放不下时全量挤压保断行；成行后无条件收连续标点对的相邻侧、行首起始标点左半格与行尾句读右半格。断行判定始终按全角，与 PowerPoint 一致 |
| 网络字体到达前的断行 | 字体异步加载期间，原生 `<text>` 先按回退字体测量；`foreignObject` 先由浏览器按回退字体排版。字体到齐后宿主需要刷新当前页，官网查看器会自动执行 |
| 加密文件 | 设了打开密码的文件可解析：`parse(bytes, { password })`。未传密码抛 `PasswordRequiredError`，密码错误抛 `WrongPasswordError`，支持敏捷 AES-CBC / 标准 AES-ECB（.pptx）与 RC4 CryptoAPI（.ppt） |
| OLE 嵌入对象 | 渲染 PowerPoint 存的预览图（经 VML 部件解析），不解析内部文档；预览为 PICT 等无法解码的格式时退回占位框 |

> 各能力的完整支持范围与边界以[扩展能力矩阵](expanded-capabilities.md)为权威源，本表只列对使用决策有影响的条目。
