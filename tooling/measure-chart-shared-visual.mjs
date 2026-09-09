import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { withChartBrowser } from './lib/chart-browser-lab.mjs';

const root = resolve('.'), out = resolve('out/chart-shared/visual');
mkdirSync(out, { recursive: true });
const cases = JSON.parse(readFileSync('tooling/chart-shared-cases.json'))
  .filter(item => ['category-growth', 'cache-square', 'mixed-records'].includes(item.stem));
cases.push({stem:'render-mixed-scatter',fixture:'sample-chart-shared-mixed-scatter.pptx'});
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { method: '首页面 1280×720；LibreOffice 实际 PNG 与两条引擎文字路径；无相似度及格线。',
  runnerSha256: digest(readFileSync(import.meta.filename)), rendererManifest: 'out/chart-shared/mixed-render-gate-inputs.json',
  office: execFileSync('/Applications/LibreOffice.app/Contents/MacOS/soffice', ['--version'], { encoding: 'utf8' }).trim(),
  toolSha256: digest(readFileSync('tooling/compare-libreoffice.mjs')), cases: [], savePathPixels: [] };
const persist = () => writeFileSync(`${out}/result.json`, JSON.stringify(report, null, 2) + '\n');
for (const item of cases) for (const variant of ['original', 'patched', 'generated']) {
  const name = `shared-visual-${item.stem}-${variant}`;
  const source = variant === 'original' ? `fixtures/${item.fixture}` : `out/chart-shared/${item.stem}-${variant}.pptx`;
  const bytes = readFileSync(source), input = `${out}/${name}.pptx`;
  writeFileSync(input, bytes);
  const record = { stem: item.stem, variant, source, input, sha256: digest(bytes), status: 'running' };
  report.cases.push(record); persist();
  try {
    execFileSync(process.execPath, ['tooling/compare-libreoffice.mjs', input], { stdio: 'inherit', timeout: 120000 });
    const comparison = resolve('out/compare', name); record.comparison = `${comparison}/compare.html`;
    record.referenceSha256 = digest(readFileSync(`${comparison}/reference.png`));
    await withChartBrowser(root, async ({ evaluate, request, version }) => {
      report.browser = version;
      await request('Page.enable');
      const url = pathToFileURL(record.comparison).href;
      await request('Page.navigate', { url });
      for (let i = 0; i < 200; i++) {
        if (await evaluate(`location.href === ${JSON.stringify(url)} && !!document.querySelector('#metrics b')`)) break;
        const error = await evaluate(`document.querySelector('#err')?.textContent`);
        if (error) throw new Error(error);
        if (i === 199) throw new Error('图像比较未完成');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      record.htmlMetrics = await evaluate("document.querySelector('#metrics').textContent");
      const htmlPng = await evaluate("document.querySelector('#myC').toDataURL('image/png').split(',')[1]");
      writeFileSync(`${comparison}/engine-html.png`, Buffer.from(htmlPng, 'base64'));
      writeFileSync(`${comparison}/comparison.png`, Buffer.from((await request('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
      const native = await evaluate(`(async () => {
        const pres = await WebPPT.parse(SRC), svg = WebPPT.renderSlideToSvg(pres, pres.slides[0], { textMode: 'svg' });
        try {
          const img = new Image(); const loaded = new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; });
          img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg); await loaded;
          const c = document.createElement('canvas'); c.width = 1280; c.height = 720;
          const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,1280,720); ctx.drawImage(img,0,0,1280,720);
          const a = document.querySelector('#refC').getContext('2d').getImageData(0,0,1280,720).data;
          const b = ctx.getImageData(0,0,1280,720).data; let sum=0,max=0,diff=0;
          for (let i=0;i<a.length;i+=4) { const d=[0,1,2].map(k=>Math.abs(a[i+k]-b[i+k]));
            sum+=d[0]+d[1]+d[2]; const m=Math.max(...d); max=Math.max(max,m); if(m>8) diff++; }
          return { ssim:ssim(a,b,1280,720),mae:sum/(1280*720*3),max,diffPercent:100*diff/(1280*720),png:c.toDataURL().split(',')[1] };
        } finally { pres.dispose(); }
      })()`);
      writeFileSync(`${comparison}/engine-svg.png`, Buffer.from(native.png, 'base64'));
      delete native.png; record.svgMetrics = native;
    });
    assert.equal(digest(readFileSync(source)), record.sha256, '比较不修改原始验证产物');
    record.status = 'complete';
  } catch (error) { record.status = 'failed'; record.error = error.stack; throw error; }
  finally { persist(); }
}
for (const item of cases) {
  const pair = report.cases.filter(record => record.stem === item.stem && record.variant !== 'original');
  report.savePathPixels.push({ stem: item.stem, libreOfficePngIdentical: pair[0].referenceSha256 === pair[1].referenceSha256,
    htmlPngIdentical: digest(readFileSync(`${pair[0].comparison.replace('/compare.html','')}/engine-html.png`)) === digest(readFileSync(`${pair[1].comparison.replace('/compare.html','')}/engine-html.png`)),
    svgPngIdentical: digest(readFileSync(`${pair[0].comparison.replace('/compare.html','')}/engine-svg.png`)) === digest(readFileSync(`${pair[1].comparison.replace('/compare.html','')}/engine-svg.png`)) });
}
persist(); console.log(JSON.stringify(report.savePathPixels));
