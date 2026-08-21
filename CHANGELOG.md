# 更新日志

本文件记录对使用者可见的变化。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 0.4.0

本版围绕**字体**：嵌入字体此前从来没有真正生效过，替换字体则完全没有。
顺带修掉一个让静态画面把动画的几帧叠在一起的问题。

### 新增

- **嵌入字体真的能用了**。PowerPoint 的 `ppt/fonts/*.fntdata` 不是裸 TTF，是 EOT 容器，
  而且实测**全部**开着 MTX 压缩（POI 语料 6/6、ORCID 样本 10/10）。此前把这段字节
  原样当 `font/ttf` 塞进 `@font-face`，浏览器一个都不认，只在控制台留一行
  `invalid sfntVersion`。现在 core 自己剥容器（含异或混淆），MTX 解压走
  `setFontDecoder()` 注入——官网接的是 [`mtx-decompressor`](https://www.npmjs.com/package/mtx-decompressor) 的 `eotToTtf`，
  core 本身仍然只依赖 fflate。解不出来就跳过这个字体，不再塞浏览器注定拒绝的字节
- **`collectFonts(slides)`**：统计若干页用到哪些字体、每个字体要渲染哪些字。
  纯函数、只依赖 `types.ts`，`.ppt` 链路同样适用，Worker 里能跑
- **新包 [`@web-ppt/fonts`](packages/fonts)**（gzip 2.8KB，**包里零字节字体**）：
  文件没带字体、本机也没装时的兜底。拉丁换**度量兼容**的免费字体
  （Calibri→Carlito、Arial→Arimo 等，前进宽度逐字相等，断行与 PowerPoint 对齐），
  中文换思源系 / 霞鹜文楷。切片指向钉死版本的 fontsource，按 `unicode-range` 只下用到的那几片
- **`Viewer.refresh()`**：重渲当前页而不动页码与动画进度。网络字体到货后必须重渲——
  排版是同步的、加载是异步的，首帧一定是按回退字体断的行

### 修复

- **静态渲染取动画终态，而不是「全部可见」**。一页里入场与退场的元素属于不同时刻，
  全画出来等于把几帧叠在一起：ORCID 那份样本的第 7 页三段文字本该逐条替换，
  叠起来一个字都读不出。终态会清空整页时（全员退场的收尾页）退回全部可见
- **run 没写 `a:latin` 时落到主题的 minorFont**。ECMA-376 的继承链最后一站就是
  `fontScheme/minorFont`，此前直接当「没有字体」，渲染掉到 CSS 通用回退上，
  字宽与 PowerPoint 对不齐。真实文件大多在母版 txStyles 里写了 `+mn-lt` 所以少见，
  但这是「断行对不齐」的一个隐藏来源
- 字体栈去重：主题的 ea 字体常常正好是回退列表里的 `PingFang SC`，之前会拼出重复项

### 其它

- 测试：1689 → **1848 项断言**，快照 158 → 160 个；新增 `sample-embedfont.pptx`
  覆盖嵌入字体的四种容器形态（未压缩 EOT / 未压缩+异或 / MTX 压缩 / 裸 TTF）
- `@web-ppt/core` gzip 84KB 不变；`@web-ppt/viewer-core` 6.8KB → 7.4KB
- 两个既有包的 peer 依赖同步升到 `^0.4.0`

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
