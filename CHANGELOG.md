# 更新日志

本文件记录对使用者可见的变化。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 0.3.0

本版把 ECMA-376 的几处主要缺口补齐，并首次拿 **Apache POI 的 242 个公开测试文件**跑批验证：
排除 22 个故意损坏的模糊测试样本后，真实文件成功率 **210/220 = 95.5%**。

### 新增

- **预设几何补齐到规范全集**：163 → **187 个**。此前缺的 24 个走的是
  `PRESETS[name] ?? PRESETS.rect`，会**静默画成矩形**，不报错也不进 `unsupported`——
  `accentCallout*` 这类常见形状出现即无声画错
- **运动路径动画**：`p:animMotion@path` 此前从未被读取，`presetClass="path"` 一律退化成淡入。
  现按弧长等距重采样成位移点，播放层走 linear 缓动（PowerPoint 的路径动画是匀速）
- **切换效果 21 → 41 种**：补上 PowerPoint 2010+ 的全部 19 种 p14 扩展，以及 p159 的
  **morph**——按形状 id 在前后两页之间配对做几何补间，不是淡入淡出
- **数学公式 OMML 真排版**：此前只把 `m:t` 拼成一行文字（分式变成 `a+b/2c`）。
  现做完整箱模型排版，覆盖分式 / 根式 / 上下标 / 大算符 / 定界符 / 矩阵 / 重音 / 极限等 12 类结构
- **加密文档**：
  - `.pptx` 标准加密（AES-ECB）与敏捷加密（AES-CBC 分段）
  - `.ppt` 老式 RC4 CryptoAPI（40 / 56 / 128 位）
  - 用法 `parse(input, { password })`；密码错误抛 `WrongPasswordError`，与「文件损坏」区分开
- **PICT（Apple QuickDraw）解码器**：Mac 版 PowerPoint 存的 OLE 预览与图片此前只能是裂图
- **SmartArt 无缓存 drawing part 时自行排布**：python-pptx / Google Slides 导出的文件
  常常只写数据与版式定义，此前只能得到灰色占位框。现支持线性 / 循环 / 金字塔 / 层级 /
  蛇形 / 辐射六种布局族

### 修复

- `borderCallout2` 的引线是三点**开放**子路径，会被 `fill` 补成实心楔形——引线画成了黑三角
- 后台标签页的 `document.timeline` 是暂停的，`Animation.finished` 永不 resolve，
  切换的收尾逻辑（移除旧图层）就永远不执行，配合自动换片会让图层持续堆积
- OLE 预览优先读 `p:oleObj` 内嵌的 `p:pic`（Office 2010+ 的主要写法），旧式 VML 快照作为后备

### 其它

- `@web-ppt/core` gzip 68KB → 84KB（新增的解码器与公式排版；加密与 PICT 走 hook 注入，可 tree-shake）
- 测试：1298 → **1689 项断言**，快照 142 → 158 个
- `@web-ppt/viewer-core` 的 peer 依赖同步升到 `^0.3.0`

## 0.2.0 及更早

见 [提交历史](https://github.com/unStone/web-ppt/commits/master)。
