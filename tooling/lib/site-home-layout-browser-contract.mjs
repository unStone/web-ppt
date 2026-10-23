/** 顶栏四个页面级入口，桌面与手机同一份：试用 · 样本库 · 编辑器 · GitHub */
const NAV_HREFS = [
  /^(?:\.\/)?(?:index\.en\.html)?(?:\?lang=zh-CN)?#demo$/,
  /^(?:\.\/)?samples(?:\.en)?\.html(?:\?lang=zh-CN)?$/,
  /^(?:\.\/)?editor(?:\.en)?\.html(?:\?lang=zh-CN)?$/,
  /^https:\/\/github\.com\/unStone\/web-ppt$/,
];

const READ_NAV = `(() => {
  const links = [...document.querySelectorAll('.nav .site-nav > a')];
  return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    others: document.querySelectorAll('.nav nav:not(.site-nav), .nav details').length,
    current: document.querySelector('.site-nav [aria-current="page"]')?.getAttribute('href') ?? null,
    links: links.map((link) => { const r = link.getBoundingClientRect();
      return { href: link.getAttribute('href'), width: r.width, middle: r.top + r.height / 2, visible: r.width > 0 && r.height > 0 }; }) };
})()`;

/** 入口齐全、同一行、不撑出横向滚动；返回出错原因，空串表示通过 */
function navProblem(nav, width, minLinkWidth) {
  if (nav.width !== width || nav.scrollWidth > width) return '页面横向溢出';
  if (nav.others) return '顶栏还有第二套导航或下拉目录';
  if (nav.links.length !== NAV_HREFS.length) return `入口数为 ${nav.links.length}`;
  const wrong = nav.links.findIndex((link, i) => !link.visible || !NAV_HREFS[i].test(link.href));
  if (wrong >= 0) return `第 ${wrong + 1} 个入口不可见或指向错误`;
  // 比竖直中线而不是上沿：带边框的 GitHub 按钮上沿会差 1px
  const middles = nav.links.map((link) => link.middle);
  if (Math.max(...middles) - Math.min(...middles) > 4) return '入口折成了多行';
  if (nav.links.some((link) => link.width < minLinkWidth)) return '入口太窄';
  return '';
}

export async function runSiteHomeLayoutContract({ evaluate, request, waitFor }) {
  const home = await evaluate("new URL('index.html', location.href).href");
  const samples = await evaluate("new URL('samples.html', location.href).href");
  await request('Emulation.setDeviceMetricsOverride', {
    width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
  });

  try {
    await request('Page.navigate', { url: home });
    await waitFor("document.querySelector('#stage svg') && document.querySelector('#demoRoot')", '官网首页示例渲染');
    const desktop = await evaluate(`(() => ({
      width: innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      demoTop: document.querySelector('#demo').getBoundingClientRect().top,
      proofNext: document.querySelector('#demo').nextElementSibling?.id,
      chipCount: document.querySelectorAll('.samples > .chip').length,
    }))()`);
    if (desktop.width !== 1280 || desktop.scrollWidth > desktop.width || desktop.demoTop > 720
      || desktop.proofNext !== 'proof' || desktop.chipCount > 7) {
      throw new Error(`官网桌面首屏或内容顺序错误：${JSON.stringify(desktop)}`);
    }
    const desktopNav = await evaluate(READ_NAV);
    const desktopProblem = navProblem(desktopNav, 1280, 40) || (desktopNav.current ? '首页不该有当前页入口' : '');
    if (desktopProblem) throw new Error(`官网桌面导航：${desktopProblem}：${JSON.stringify(desktopNav)}`);

    for (const width of [390, 320]) {
      await request('Emulation.setDeviceMetricsOverride', {
        width, height: 844, deviceScaleFactor: 1, mobile: true,
      });
      const mobile = await evaluate(READ_NAV);
      const codeWidth = await evaluate("document.querySelector('.card pre').getBoundingClientRect().width");
      const problem = navProblem(mobile, width, 56) || (codeWidth > width - 38 ? `代码块宽 ${codeWidth}` : '');
      if (problem) throw new Error(`官网 ${width}px 布局：${problem}：${JSON.stringify(mobile)}`);
    }

    await request('Page.navigate', { url: samples });
    await waitFor("document.readyState === 'complete' && document.querySelector('.site-nav')", '样本库手机导航');
    const gallery = await evaluate(READ_NAV);
    const galleryProblem = navProblem(gallery, 320, 56)
      || (NAV_HREFS[1].test(gallery.current ?? '') ? '' : '样本库入口没有标成当前页');
    if (galleryProblem) throw new Error(`样本库 320px 导航：${galleryProblem}：${JSON.stringify(gallery)}`);
    console.log('  官网首页与样本库桌面/手机排版通过');
  } finally {
    await request('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
    });
  }
}
