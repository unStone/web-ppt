# 更新日志

本文件记录对使用者可见的变化。版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## 未发布

### 新增

- `renderSlideToSvg` 新增 `RenderOptions.idPrefix`。指定后，同一页与同一前缀会生成
  逐字节相同的 SVG，供编辑器增量更新和确定性比较使用；省略时仍维持全局唯一 id，
  主视图与缩略图同时挂载不会发生 defs 冲突。
- 新增 `renderElementToSvg(element, options) → { markup, defs }`。编辑器可用每元素唯一的
  稳定 `idPrefix` 只重渲脏元素，并在同一次 DOM 更新中替换它自己的节点与 defs；
  整页与元素入口复用同一分发和两条文本路径，不存在第二套近似渲染器。
- 新增无 DOM 的 `renderTextBodyToHtml(text, width, height, options)`。屏幕预览和后续
  contenteditable 覆盖层共用同一份段落、run、CJK 标点、分栏与 autofit 排版；默认输出
  可反解的编辑标记，并隔离危险链接协议，原生 SVG 文本导出路径保持独立。
- 新增纯函数 `layoutText(text, width, height, options)`。它与原生 `<text>` 输出共用断行、
  CJK 挤压、分栏、行距及 autofit，并公开段落/run 身份、UTF-16 字符区间与光标停靠点，
  供 Safari engine 模式命中选区；竖排返回仿射变换，公式保持原子，测量器可注入。
- `parse` 新增完全可选的 `edit` / `keepPackage`：前者保留页与元素的 OOXML 回写锚点、
  占位符身份，后者通过 `Presentation.package` 保留原始 ZIP 与解压 part。默认解析的
  对象形状和资源生命周期不变；`dispose()` 会同时释放保留的原包。
- `.pptx` 与 `.ppt` 的编辑解析会额外保留预设形状的 `preset + adj` 语义（OOXML 含
  版式/母版继承），并新增纯函数 `resolveGeomPath`；编辑投影改变宽高后可重新求值路径，
  不再复用解析期烘焙的几何。
- 新增无 DOM、无框架的 `@web-ppt/edit-core`：把解析结果转换为带稳定身份与分数 z 序的
  扁平 `EditDoc`，以 `src` / `ovr` 分离源值和用户改动，并通过 `toSlide` 投影回现有
  渲染 Schema。元素、组祖先和页面缓存按修改路径精确失效；图表、SmartArt、OLE、
  墨迹与媒体只开放框架级变换，内部派生节点不可误编辑。
- `@web-ppt/edit-core` 新增无 DOM 的 `Editor`、可 JSON 序列化的 `SetXfrm` 与双向 patch。
  事务失败整体回滚；撤销/重做恢复选区，同路径改动按 500ms 分组，远端 origin 不进入本地历史，
  默认保留 200 组 / 8MB。固定种子 200 条命令通过撤销、重做与 JSON 回放全等，500 条非法命令
  不污染文档；210 页实测 200 组撤销/重做含脏页重渲均约 0.5ms/次，历史约 64KB。
- 新增按需入口 `@web-ppt/edit-core/xml`：无 DOM 的保留型 XML 树支持 UTF-8 / UTF-16
  字节回环、限定名与 namespace URI 查询、属性最小改写和 OOXML sequence 有序插入；声明、
  注释、PI、前缀、属性顺序、自闭合形态及 `AlternateContent` 不被重建。默认编辑模型入口为
  8.28KB gzip，保存期 XML 入口独立为 7.14KB gzip。
- 新增按需入口 `@web-ppt/edit-core/opc`：无修改保存复用原始字节；脏 part 定点重压，净条目的
  本地头、extra field 与压缩流逐字直通。新增/删除 part、重复保存和确定性输出均有契约；zip64、
  数据描述符、存档注释、加密条目、未知压缩与多磁盘格式会给出原因并整包重压。入口为 4.27KB gzip，
  210 页 / 50.6MB 修改并序列化 3 页后的实测保存为 84.0ms；保存结果可随文档或独立释放。
- 新增 M0 自动门禁：23 份固件（含加密 OOXML、RC4 `.ppt` 与 hardcases）的只读链路和
  编辑投影分别在独立进程渲染，两条文本路径共 200 对原始 SVG 指纹必须完全一致；
  210 页基准同时强制检查默认路径零编辑状态、编辑常驻内存增量、文本行盒与提交重渲预算。

## 0.4.5

### 修复

- **`@web-ppt/viewer-core` 与 `@web-ppt/fonts` 的 npm 页面在 0.4.4 里仍是中文**。
  包内容是对的（tarball 里躺着英文版），错的是 npm 用来渲染页面的那份元数据。

  原因是 npm 认哪个文件当 README 并不看「是不是叫 README.md」：
  `@npmcli/package-json` 用 `{README,README.*}` 去 glob 再取第一个像 markdown
  的命中，而 0.4.4 引入的 `README.zh-CN.md` 同样匹配 `README.*`，实测还排在
  `README.md` 前面。`files` 只挡住了 tarball，挡不住元数据。

  本地化 README 改用连字符（`README-zh-CN.md`），并在 `sync-package-docs.mjs`
  里加了守卫：包目录里出现 `README.*` 旁支就直接让发布失败。

## 0.4.4

本版没有代码改动，只动文档——但 npm 上看到的东西全变了，所以值得单独发一版。

### 变更

- **npm 页面改英文**。三个包的 README 与 `description` 之前全是中文，
  而 npm 的读者以国际开发者为主，等于最有说服力的能力矩阵对他们不存在。
  现在 `@web-ppt/core` 的 npm 页取仓库的 `README.en.md`，另两个包各自
  维护英文版，中文移到同目录的 `README.zh-CN.md`，两边顶部互链。

  GitHub 首页仍是中文，两个入口各自面向自己的人群。

- **README 首屏补了演示 GIF 与定位段**。GIF 由 `npm run demo-gif` 录制，
  录的是仓库自己生成的 `fixtures/showcase.pptx`，引擎改了重跑即可，
  不是一次性的手工录屏。

## 0.4.3

### 变更

- **静态画面改回动画终态**，撤销 0.4.1 里改成初始态的那次调整。

  对齐 PowerPoint 的模型：普通视图与缩略图看到的是「这一页演完的样子」，
  按 F5 进入演示才从第一步开始建。所以**进全屏时画面跳一次是预期行为**，
  不是 bug —— 0.4.1 当时是把这个跳变当成缺陷去消除的，方向错了。

  「不能简单摊开全画」这条不变：一页里入场与退场的元素属于不同时刻，
  全画出来等于把几帧叠在一起。全员退场的收尾页终态是空白，那种情况仍然
  退回全部可见。

## 0.4.2

### 修复

- **动画目标是「组」时，整组藏不住**。`visibility` 和 `display:none` 不一样：
  它虽然继承，但后代显式写 `visible` 会把祖先的 `hidden` 顶掉。查看器原本给
  隐藏集之外的每个元素都写死 `visible`，于是组藏了、组里每个形状却各自写着
  `visible`，整组照常显示——看着就像「预览显示的还是动画终态」。

  现在不在隐藏集里就清空这条声明，让继承自然生效。之前只在动画目标为叶子形状
  的样本上验过，那种结构没有子元素，所以一直没暴露。

## 0.4.1

全是中文排版的修正。四处都由同一份小学课件暴露出来，每一处都拿 PowerPoint
自己写进文件的 `spAutoFit` 框高做的判据 —— 那个高度是它按实际行数算完存下来的，
等于文件自己作证该排几行。

### 修复

- **CJK 标点挤压**。汉字和全角标点都占一整格，但标点的墨迹只占半格
  （`，` `。` 的墨在左半格，`（` `《` 在右半格）。一行放不下时 PowerPoint 会把
  这些空半格挤掉，我们没做，于是多断出一行。规则取「放不下才挤」：放得下时
  保持全角。两条渲染路径算同一笔账——原生 `<text>` 用逐字符 `dx`，
  HTML 用负边距，都与字体无关，不依赖字体是否提供 `halt` 半角替换字形。

  顺带一句：这类问题**换字体救不了**。所有中文字体的方格一样大，黑体、
  PingFang、思源黑体量出来完全相同
- **量不到字时的中文估宽**。回退估算原本把每个字符都当 0.55em，中文因此窄掉
  将近一半。Node / jsdom 里恒走这条路，于是**自动缩放对中文一直缩不够**——
  autofit 固件实测旧值排出来 204px、框只有 140px，仍然溢出；按全角整格算
  之后是 146px
- **百分比行距的基准**。`lnSpc/spcPct` 是「单倍行距」的百分比，而单倍行距是
  **字体的行高**（≈1.2em），不是字号。把 150% 直接当 CSS `line-height:1.5` 用，
  每行矮两成。中文文档里 1.5 倍行距是标配，影响面不小；行距偏紧还会连累
  自动缩放与居中 / 底对齐文本的位置
- **静态画面改取动画初始态**（原本取终态）。缩略图、主视图、进演示模式后的
  第一帧现在是同一个画面，不再「先把这页演完、再从头演一遍」。
  「不能全部画出来」的理由不变：一页里入场与退场的元素属于不同时刻，摊开画
  等于把几帧叠在一起。例外从「全员退场的收尾页」换成「整页都带入场动画的
  封面页」——那种情况初始态一片空白，退回全部可见

### 其它

- 测试：1848 → **1873 项断言**，快照 160 → 162 个。`sample-autofit.pptx` 补一页
  把百分比行距与绝对行距放在一起对照——之前 17 个固件里没有一个用过
  `spcPct`，这条路径从没被走过
- `@web-ppt/viewer-core` 与 `@web-ppt/fonts` 本版无改动，跟随版本号对齐

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
