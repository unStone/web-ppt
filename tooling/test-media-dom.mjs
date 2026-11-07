import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { installDomEnv } from './lib/dom-env.mjs';
import { mediaArtifacts } from './lib/media-artifacts.mjs';

const dom = installDomEnv();
try {
  for (const { name: mode } of mediaArtifacts) {
    const file = new URL(`../out/media-insertion/${mode}.pptx`, import.meta.url);
    // 产物由 test-media-insertion.mjs 落盘（npm run test:media 会先跑它）；缺产物时指路而不是 ENOENT
    if (!existsSync(file)) {
      console.error(`缺少媒体保存产物 out/media-insertion/${mode}.pptx：先跑 npm run test:media 生成产物，再跑本套件。`);
      process.exit(1);
    }
    const parts = unzipSync(readFileSync(file));
    for (const [part, bytes] of Object.entries(parts)) {
      if (!part.endsWith('.xml') && !part.endsWith('.rels')) continue;
      const parsed = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
      assert.equal(parsed.querySelector('parsererror')?.textContent, undefined, `${mode} ${part}`);
    }
  }
  console.log('媒体产物严格 DOM XML 解析通过');
} finally { dom.window.close(); }
