# @web-ppt/viewer-core

[Web-PPT](https://github.com/unStone/web-ppt) 查看器的 headless 层。

`PresentationState` 是零 DOM 的纯状态机——导航 / 缩放 / 搜索 / 动画批次 / 自动换片，
可被原生 DOM、React、Vue、Svelte 任意 UI 驱动，也能在 Node 里直接跑测试。
`Viewer` 是它之上最薄的一层 DOM 绑定（塞 SVG、设可见性、调播放，约 24 行）。

```bash
npm i web-ppt @web-ppt/viewer-core
```

## 开箱即用

```ts
import { parse } from 'web-ppt';
import { Viewer } from '@web-ppt/viewer-core';

const pres = await parse(file);
const v = new Viewer(container, pres, { animate: true, autoAdvance: true });

v.next();              // 有待播动画时先播动画，否则翻页
v.finishAnimations();  // 跳到本页动画终态
v.setZoom(1.5);
v.search('关键词');     // → 命中的页索引数组
await v.exportPng(2);  // → Blob
```

## 接自己的 UI

```ts
import { PresentationState, playGroup, playTransition } from '@web-ppt/viewer-core';

const st = new PresentationState(pres, { skipHidden: true, animate: true });

st.subscribe((change) => {
  if (change.type === 'slide') {
    render(change.index);
    if (change.transition) playTransition(prevEl, nextEl, change.transition);
  } else if (change.type === 'animation' && change.group) {
    playGroup(container, change.group);
  }
});

st.next();
st.hiddenElementIds;   // 当前批次下应隐藏的元素 id
st.resolveLink(href);  // 'slide:3' → 2，外链 → null
```

状态机只决定「该显示什么」，实际播放由 UI 层调 `playGroup` / `playTransition` 完成——
所以换框架时不需要重写任何逻辑。

MIT
