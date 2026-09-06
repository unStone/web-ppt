import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFixture, captureSaveAndReopen, selectPaneObject, changeValue } from './site-editor-browser-helpers.mjs';

export async function runSiteAppearanceBrowserContract(context) {
  const { evaluate, waitFor, click, request, out } = context;
  await openFixture(context, '/fixtures/sample-editor-appearance.pptx', 'appearance.pptx');
  await selectPaneObject(context, 'picture-901');
  await waitFor(`!!document.querySelector('[data-ppt-accessibility] [aria-selected=true]')`, '读屏选择状态');
  await click('#imageInspector [data-appearance-tools]');
  await waitFor("document.querySelector('#appearanceDialog')?.open", '图片效果窗口');
  await changeValue(context, '#appearanceDialog [name=alpha]', '45');
  await click('#appearanceDialog [name=grayscale]');
  await click('#appearanceDialog [name=duotone]');
  await click('#appearanceDialog [type=submit]');
  await waitFor("!document.querySelector('#appearanceDialog')", '应用图片效果');
  await click('#undo'); await click('#redo');
  await click('#imageInspector [data-appearance-tools]');
  await waitFor("document.querySelector('#appearanceDialog [name=alpha]')?.value === '45'", '连续查询读取最新投影');
  await evaluate("document.querySelector('#appearanceDialog').close()");
  await selectPaneObject(context, 'plain-shape');
  await click('#shapeInspector [data-appearance-tools]');
  await waitFor("document.querySelector('#appearanceDialog')?.open", '立体效果窗口');
  await changeValue(context, '#appearanceDialog [name=extrusion]', '0');
  await changeValue(context, '#appearanceDialog [name=bevelTop]', '3');
  await changeValue(context, '#appearanceDialog [name=material]', 'metal');
  await click('#appearanceDialog [type=submit]');
  await captureSaveAndReopen(context, 'appearance-reopened.pptx');
  await selectPaneObject(context, 'plain-shape');
  await click('#shapeInspector [data-appearance-tools]');
  await waitFor(`document.querySelector('#appearanceDialog [name=extrusion]')?.value === '0'
    && document.querySelector('#appearanceDialog [name=bevelTop]')?.value === '3'`, '零挤出与斜角重开');
  await evaluate("document.querySelector('#appearanceDialog').close()");
  await selectPaneObject(context, 'picture-901');
  await click('#imageInspector [data-appearance-tools]');
  await waitFor(`document.querySelector('#appearanceDialog [name=alpha]')?.value === '45'
    && document.querySelector('#appearanceDialog [name=duotone]')?.checked
    && document.querySelector('#appearanceDialog [name=grayscale]')?.checked`, '图片效果重开');
  await evaluate("document.querySelector('#appearanceDialog').close()");
  const pixels = await evaluate(`(async () => {
    const core = await import('/chartex-core.mjs');
    const p = await core.parse(await fetch('/fixtures/sample-editor-appearance.pptx').then(r=>r.arrayBuffer()), {lazy:false});
    const image = p.slides[0].elements.find(e=>e.name==='picture-901');
    const slide = {...p.slides[0], background:null, elements:[{...image,x:0,y:0,w:64,h:32,crop:undefined,
      alpha:1,filter:'grayscale(1)',duotone:['rgb(17,34,51)','rgb(255,238,221)']}]};
    const outputs = [await core.slideToPng(p,slide), new Blob([await core.slideToSvgFile(p,slide)],{type:'image/svg+xml'})];
    const samples=[];
    for(const blob of outputs){
      const im=new Image(),url=URL.createObjectURL(blob);im.src=url;await im.decode();
      const canvas=document.createElement('canvas');canvas.width=640;canvas.height=360;
      const ctx=canvas.getContext('2d');ctx.drawImage(im,0,0,640,360);URL.revokeObjectURL(url);
      samples.push([...ctx.getImageData(0,16,1,1).data]);
    }
    p.dispose();return samples;
  })()`, true);
  if (pixels.some((pixel) => pixel.slice(0,3).some((value,index) => Math.abs(value-[17,34,51][index])>3))) {
    throw new Error(`灰度与双色调的 PNG/SVG 像素不一致：${JSON.stringify(pixels)}`);
  }
  await openFixture(context, '/fixtures/mixed-patched.pptx', 'mixed-features.pptx');
  const mixed = `document.querySelector('[data-ppt-layer=static]')?.textContent.includes('9,876')
    && document.querySelector('[data-ppt-layer=static]')?.textContent.includes('North')`;
  await waitFor(mixed, '现代图表自动原生解析与经典数据共存');
  await captureSaveAndReopen(context, 'mixed-features-reopened.pptx');
  await waitFor(mixed, '混合功能保存重开');
  const screenshot = await request('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(join(out, 'mixed-features.png'), Buffer.from(screenshot.result.data, 'base64'));
  writeFileSync(join(out, 'appearance-pixels.json'), JSON.stringify({ png:pixels[0], svg:pixels[1] }, null, 2)+'\n');
  console.log('  图片/立体控件、读屏选择、双色调像素与混合内容保存重开通过');
}
