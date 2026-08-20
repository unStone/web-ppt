/**
 * 按 fixtures/corpus.json 把测试语料拉到 corpus/（已 gitignore）。
 *
 * 语料不入库有两个理由。一是体积：git 不对二进制做增量，62MB 进了历史就永远
 * 在那儿，clone 一次背一次。二是授权：POI 的 test-data 里有大量从网上抓来的
 * 第三方文档，上游以 ASL 2.0 分发不等于洗白了别人的著作权 —— 当本地测试输入
 * 用不涉及分发，转载就另一回事了。所以这里只记来源，谁跑测试谁自己从原始地址取。
 *
 * URL 钉在具体 commit 上，内容不会在脚下变。校验用 git blob SHA1
 * （sha1("blob <len>\0" + 内容)）—— 清单里的 sha 字段就是它，能真验，
 * 不是拿体积凑合。
 */
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'corpus');
const CONCURRENCY = 6;

/** git 存 blob 的方式：sha1("blob " + 字节数 + "\0" + 内容) */
const blobSha = (buf) =>
  createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

const doc = JSON.parse(readFileSync(join(ROOT, 'fixtures/corpus.json'), 'utf8'));
const only = process.argv[2];

for (const set of doc.sets) {
  if (only && set.name !== only) continue;

  const dir = join(OUT, set.name);
  mkdirSync(dir, { recursive: true });

  const todo = [];
  let have = 0;
  for (const f of set.files) {
    const path = join(dir, f.name);
    // 已有且校验通过就跳过 —— 重跑不该重下 62MB
    if (existsSync(path) && statSync(path).size === f.bytes) {
      if (!f.sha || blobSha(readFileSync(path)) === f.sha) {
        have++;
        continue;
      }
    }
    todo.push(f);
  }

  console.log(`[${set.name}] ${set.files.length} 个文件，已有 ${have}，待下载 ${todo.length}`);
  if (!todo.length) continue;

  let done = 0;
  let failed = 0;
  const queue = [...todo];

  const worker = async () => {
    for (;;) {
      const f = queue.shift();
      if (!f) return;
      const url = set.base + encodeURIComponent(f.name);
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (f.sha && blobSha(buf) !== f.sha) throw new Error('校验和不符');
        writeFileSync(join(dir, f.name), buf);
        done++;
        if (done % 20 === 0) console.log(`  ${done}/${todo.length}`);
      } catch (e) {
        failed++;
        console.error(`  ✗ ${f.name}: ${e.message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`[${set.name}] 完成 ${done}/${todo.length}${failed ? `，失败 ${failed}` : ''}`);
}
