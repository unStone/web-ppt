export async function runSiteHomeLayoutContract({ evaluate, request, waitFor, click }) {
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

    for (const width of [390, 320]) {
      await request('Emulation.setDeviceMetricsOverride', {
        width, height: 844, deviceScaleFactor: 1, mobile: true,
      });
      const mobile = await evaluate(`(() => {
        const nav = document.querySelector('.mobile-nav');
        const links = [...nav.querySelectorAll(':scope > a')];
        const code = document.querySelector('.card pre');
        return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
          navVisible: getComputedStyle(nav).display !== 'none',
          desktopHidden: getComputedStyle(document.querySelector('.desktop-nav')).display === 'none',
          links: links.map((link) => ({ href: link.getAttribute('href'), width: link.getBoundingClientRect().width })),
          codeWidth: code.getBoundingClientRect().width };
      })()`);
      if (mobile.width !== width || mobile.scrollWidth > width || !mobile.navVisible || !mobile.desktopHidden
        || mobile.links.length !== 2 || mobile.links[0].href !== '#demo'
        || !/^(?:\.\/)?editor(?:\.en)?\.html(?:\?lang=zh-CN)?$/.test(mobile.links[1].href)
        || mobile.links.some((link) => link.width < 40)
        || mobile.codeWidth > width - 38) {
        throw new Error(`官网 ${width}px 布局越界或入口缺失：${JSON.stringify(mobile)}`);
      }
    }

    await click('.mobile-nav-more summary');
    await waitFor("document.querySelector('.mobile-nav-more').open", '手机章节目录展开');
    await click('.mobile-nav-menu a[href="#proof"]');
    await waitFor("location.hash === '#proof' && !document.querySelector('.mobile-nav-more').open", '章节跳转并收起目录');
    await click('.mobile-nav-more summary');
    await request('Input.dispatchKeyEvent', {
      type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27,
    });
    await waitFor("!document.querySelector('.mobile-nav-more').open", 'Escape 关闭手机章节目录');

    await request('Page.navigate', { url: samples });
    await waitFor("document.readyState === 'complete' && document.querySelector('.mobile-nav')", '样本库手机导航');
    const gallery = await evaluate(`(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
      navVisible: getComputedStyle(document.querySelector('.mobile-nav')).display !== 'none',
      demo: document.querySelector('.mobile-nav > a')?.getAttribute('href') }))()`);
    if (gallery.width !== 320 || gallery.scrollWidth > 320 || !gallery.navVisible
      || !/^(?:\.\/)?(?:index\.en\.html)?(?:\?lang=zh-CN)?#demo$/.test(gallery.demo)) {
      throw new Error(`样本库手机布局越界或试用入口缺失：${JSON.stringify(gallery)}`);
    }
    console.log('  官网首页与样本库桌面/手机排版通过');
  } finally {
    await request('Emulation.setDeviceMetricsOverride', {
      width: 1280, height: 720, deviceScaleFactor: 1, mobile: false,
    });
  }
}
