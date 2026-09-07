import { checkThreeDTransparency } from './three-d-alpha-browser-contract.mjs';
import { mkdirSync,writeFileSync } from 'node:fs';
import { openFixture,selectPaneObject,changeValue,captureSaveAndReopen } from './site-editor-browser-helpers.mjs';
export async function runSiteThreeDBrowserContract(context) {
  const {waitFor,click,evaluate,request}=context;
  await openFixture(context,'/fixtures/sample-three-d.pptx','three-d-ui.pptx');
  await waitFor(`document.querySelectorAll('#canvasMount [data-projection]').length===6`, '三维网格自动加载');
  mkdirSync('out/three-d',{recursive:true});
  await checkThreeDTransparency(evaluate);
  const screenshot=await request('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  writeFileSync('out/three-d/browser.png',Buffer.from(screenshot.result.data,'base64'));
  await selectPaneObject(context,'XYZ rotation');
  await click('#shapeInspector [data-appearance-tools]');
  await waitFor(`document.querySelector('#appearanceDialog')?.open`, '三维相机控件');
  await changeValue(context,'#appearanceDialog [name=camera]','perspectiveFront');
  await changeValue(context,'#appearanceDialog [name=fieldOfView]','60');
  await changeValue(context,'#appearanceDialog [name=rotZ]','22');
  await click('#appearanceDialog [type=submit]');
  await waitFor(`document.querySelectorAll('#canvasMount [data-projection=perspective]').length===4`, '实际透视投影切换');
  await click('#undo');await waitFor(`document.querySelectorAll('#canvasMount [data-projection=perspective]').length===3`, '相机撤销');
  await click('#redo');
  await captureSaveAndReopen(context,'three-d-reopened.pptx');
  await selectPaneObject(context,'XYZ rotation');await click('#shapeInspector [data-appearance-tools]');
  await waitFor(`document.querySelector('#appearanceDialog [name=fieldOfView]')?.value==='60' && document.querySelector('#appearanceDialog [name=rotZ]')?.value==='22'`, '原生相机保存重开');
  await evaluate(`document.querySelector('#appearanceDialog').close()`);
}
