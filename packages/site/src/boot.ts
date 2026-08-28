/**
 * 首页入口：只决定「什么时候把引擎拉下来」，自己一行引擎代码都不碰。
 *
 * 引擎那个 chunk 压缩后 125KB，而首屏要显示的东西——标题、说明、能力矩阵——
 * 全在静态 HTML 里，一行 JS 都不需要。让它跟首屏抢带宽，等于用最重的资源去拖
 * 最该快的那一帧：它作为 `<link rel="modulepreload">` 排在样式表前面抢连接，
 * 实测把样式表拖到 2.1s 才到齐，LCP 全程在等这一下。
 *
 * 所以改成按需：demo 快进视口了才加载。深链和一进来就去动 demo 的人不能等
 * 观察器，另开口子立刻加载——晚一点点没关系，点了没反应不行。
 */

/** 提前量：demo 顶边离视口还有这么远就开始拉，滚到时通常已经就绪 */
const MARGIN = '300px';

let started = false;
function start(): void {
  if (started) return;
  started = true;
  void import('./main');
}

const demo = document.querySelector<HTMLElement>('#demoRoot');

// 深链带着要看的样本进来，人就是冲渲染结果来的，别让他等滚动
if (new URLSearchParams(location.search).has('sample')) start();

if (!demo || !('IntersectionObserver' in window)) {
  // 没有观察器的浏览器退回原来的行为。能力可以晚到，不能因此缺失。
  start();
} else {
  const io = new IntersectionObserver(
    (entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        start();
      }
    },
    { rootMargin: MARGIN },
  );
  io.observe(demo);

  // 观察器只认滚动位置。键盘 Tab 进来的、直接去点「打开本地文件」的、
  // 拖着文件飘过来的，都得当场唤醒。
  const wake = (): void => start();
  demo.addEventListener('pointerdown', wake, { capture: true, once: true });
  demo.addEventListener('focusin', wake, { once: true });
  demo.addEventListener('dragenter', wake, { once: true });

  /**
   * 引擎到位前的拖放兜底。
   *
   * 浏览器对没人拦的 drop 的默认行为是**导航到那个文件**——页面直接没了。
   * 这段窗口只有几百毫秒，但代价是用户的操作被吞掉还外加一次跳转，
   * 所以先把默认行为挡住；main.ts 上来后照常接管，这两个监听器什么也不做。
   */
  demo.addEventListener('dragover', (e) => e.preventDefault());
  demo.addEventListener('drop', (e) => e.preventDefault());
}
