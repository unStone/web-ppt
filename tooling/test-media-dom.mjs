import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { installDomEnv } from './lib/dom-env.mjs';

const dom = installDomEnv();
try {
  for (const mode of ['patched', 'generated', 'mp4-patched', 'mp4-generated', 'fmp4-patched', 'fmp4-generated']) {
    const parts = unzipSync(readFileSync(new URL(`../out/media-insertion/${mode}.pptx`, import.meta.url)));
    for (const [part, bytes] of Object.entries(parts)) {
      if (!part.endsWith('.xml') && !part.endsWith('.rels')) continue;
      const parsed = new DOMParser().parseFromString(strFromU8(bytes), 'application/xml');
      assert.equal(parsed.querySelector('parsererror')?.textContent, undefined, `${mode} ${part}`);
    }
  }
  console.log('媒体产物严格 DOM XML 解析通过');
} finally { dom.window.close(); }
