/**
 * 跨产物一致性闸门。
 *
 * 单测守的是「代码行为对不对」，这里守的是**源码正确、交出去的东西却不对**的那一类：
 * LICENSE 文件与四处声明不符、官网 npm 链接指向一个不存在的包、文档里的体积和
 * 快照数照抄旧值。这些问题任何断言都碰不到，只能靠把散落各处的同一事实拉到一起比对。
 *
 * 仓库为此修过四次 bug（LICENSE 实为 Apache-2.0、页脚 npm 链接指向已重命名的
 * web-ppt、重复 id 把整节内容覆盖掉、共享 chunk 叫 fetch-bytes），前两次至今没有
 * 守卫。AGENTS.md 那句「改数字先实测」也只是人工自觉——实测下来快照数与七个包的
 * 体积全都漂了。
 *
 * 只做静态可判定的检查，不跑测试、不发网络请求，秒级完成。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { readCounts } from './lib/measured.mjs';
import { SITE_PAGES, duplicateIds } from './lib/unique-ids.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const json = (path) => JSON.parse(read(path));

/** 各测试套件上轮落盘的实测规模；没跑过测试时为 null */
const counts = readCounts();

const failures = [];
let pass = 0;
let group = '';
const section = (name) => { group = name; console.log(`\n\x1b[36m▸ ${name}\x1b[0m`); };
const check = (name, ok, detail = '') => {
  if (ok) { pass++; return; }
  failures.push(`${group} · ${name}${detail ? `：${detail}` : ''}`);
  console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? ` — ${detail}` : ''}`);
};

/** packages/ 下真正的包目录（挡掉 .DS_Store 这类杂物） */
const packageDirs = readdirSync(join(root, 'packages')).sort()
  .filter((name) => statSync(join(root, 'packages', name)).isDirectory()
    && existsSync(join(root, 'packages', name, 'package.json')));
/** 仓库里所有 package.json 的路径，顺序稳定 */
const packageFiles = ['package.json', ...packageDirs.map((name) => `packages/${name}/package.json`)];
/** 会发到 npm 上的包（private 的不发） */
const published = packageFiles
  .map((file) => ({ file, ...json(file) }))
  .filter((p) => !p.private);

// ---------------- 许可证 ----------------
// LICENSE 正文是唯一事实来源，其余全是它的复述。复述点显式登记：新增一处要来这里加，
// 靠正则漫扫会把 CHANGELOG 里的「Apache POI」也当成许可证声明。
section('许可证声明');

const LICENSE_HEAD = /^(MIT|Apache|BSD|GPL|MPL|ISC)[^\n]*/;
const licenseKind = (LICENSE_HEAD.exec(read('LICENSE'))?.[0] ?? '').startsWith('MIT') ? 'MIT'
  : (LICENSE_HEAD.exec(read('LICENSE'))?.[1] ?? '未知');

/** 每个声明点抽出它自称的许可证名 */
const licenseClaims = [
  ...packageFiles.map((file) => ({ where: file, value: json(file).license })),
  ...['README.md', 'README.en.md'].flatMap((file) => {
    const text = read(file);
    return [
      { where: `${file} badge`, value: /License-([\w.-]+?)-blue\.svg/.exec(text)?.[1] },
      { where: `${file} 页尾`, value: /\n\[([\w.-]+)\]\((?:https:\/\/[^)]*\/)?LICENSE\)/.exec(text)?.[1] },
    ];
  }),
  ...packageDirs
    .filter((name) => existsSync(join(root, 'packages', name, 'README.md')))
    .map((name) => ({
      where: `packages/${name}/README.md`,
      value: /^(MIT|Apache-2\.0|BSD-[\w.-]+|GPL-[\w.-]+|ISC)\.?$/m.exec(read(`packages/${name}/README.md`))?.[1],
    })),
  ...SITE_PAGES.filter((page) => existsSync(join(root, 'packages/site', page)))
    .flatMap((page) => {
      const text = read(`packages/site/${page}`);
      return [
        { where: `site/${page} 页脚`, value: /Web-PPT · ([\w.-]+)</.exec(text)?.[1] },
        { where: `site/${page} JSON-LD`, value: /opensource\.org\/licenses\/([\w.-]+)/.exec(text)?.[1] },
      ];
    }),
].filter((claim) => claim.value !== undefined);

for (const claim of licenseClaims) {
  check(`${claim.where} 声明 ${claim.value}`, claim.value === licenseKind,
    `LICENSE 正文是 ${licenseKind}`);
}
console.log(`  ${licenseClaims.length} 处声明与 LICENSE 正文（${licenseKind}）比对完毕`);

// ---------------- 发布包版本 ----------------
// 版本不一致要到打 tag 时才被 release.yml 拦下，那时改起来最贵：tag 已经推了。
section('发布包版本');
const versions = new Map();
for (const p of published) versions.set(p.version, [...(versions.get(p.version) ?? []), p.name]);
check(`${published.length} 个发布包版本一致`, versions.size === 1,
  versions.size === 1 ? '' : [...versions].map(([v, names]) => `${v}: ${names.join(' ')}`).join(' | '));
if (versions.size === 1) console.log(`  全部为 ${[...versions.keys()][0]}`);

// ---------------- 文档链接 ----------------
section('文档链接');

/** 仓库内准备进入版本控制的 markdown（含新增未跟踪文件，不含 ignored 产物与外部语料） */
const markdownFiles = execFileSync('git',
  ['ls-files', '--cached', '--others', '--exclude-standard', '--', '*.md'],
  { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean);

let relativeLinks = 0;
for (const file of markdownFiles) {
  const text = readFileSync(join(root, file), 'utf8');
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1];
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    relativeLinks++;
    // 去掉锚点与行号后缀（docs 里用 path:line 指代具体行）
    const path = target.replace(/[#:].*$/, '');
    if (!path) continue;
    check(`${file} → ${target}`, existsSync(resolve(root, dirname(file), path)), '目标不存在');
  }
}
console.log(`  ${relativeLinks} 条仓库内链接`);

// npm 链接指向的包必须真实存在：页脚曾长期指向重命名前的 web-ppt，点开是 404。
// 第三方包显式登记，避免把外部依赖也当成自家包去查。
const THIRD_PARTY_NPM = new Set(['mtx-decompressor']);
const ownNames = new Set(published.map((p) => p.name));
let npmLinks = 0;
for (const file of [...markdownFiles, ...SITE_PAGES.map((p) => `packages/site/${p}`)]) {
  if (!existsSync(join(root, file))) continue;
  for (const m of readFileSync(join(root, file), 'utf8')
    .matchAll(/npmjs\.com\/package\/(@?[\w.-]+(?:\/[\w.-]+)?)/g)) {
    npmLinks++;
    check(`${file} → npm ${m[1]}`, ownNames.has(m[1]) || THIRD_PARTY_NPM.has(m[1]),
      '既不是本仓库发布的包，也不在第三方白名单里');
  }
}
console.log(`  ${npmLinks} 条 npm 包链接`);

// 外链可达性默认不查：CI 里发网络请求会被限流，一条 flaky 检查足以让整块闸门失去可信度。
// 发版前手动 `npm run verify -- --net` 走一遍即可。
if (process.argv.includes('--net')) {
  const external = new Set();
  for (const file of [...markdownFiles, ...SITE_PAGES.map((p) => `packages/site/${p}`)]) {
    if (!existsSync(join(root, file))) continue;
    for (const m of readFileSync(join(root, file), 'utf8').matchAll(/https?:\/\/[^"')\s>\]]+/g)) {
      // 徽章、schema 命名空间与 RFC 2606 保留的示例域名都不是给人点的
      if (/shields\.io|schema\.org|w3\.org|example\.(com|org|net)|localhost|127\.0\.0\.1/.test(m[0])) continue;
      external.add(m[0].replace(/[.,)]+$/, ''));
    }
  }
  // 有些站点禁 HEAD 却正常响应 GET，405/403 一律按可达处理，只认真正的 404/410。
  // 网络本身会偶发超时，重试一次再判死，否则一条抖动就能让整块闸门失去可信度。
  const visit = async (url) => {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await fetch(url, { method: 'GET', redirect: 'follow',
          signal: AbortSignal.timeout(15_000) });
        return { url, ok: response.status !== 404 && response.status !== 410, status: response.status };
      } catch (error) {
        if (attempt) return { url, ok: false, status: String(error.name ?? error) };
      }
    }
  };
  const results = await Promise.all([...external].map(visit));
  for (const { url, ok, status } of results) check(`外链 ${url}`, ok, String(status));
  console.log(`  ${external.size} 条外链已实访`);
}

// ---------------- 站点 HTML ----------------
section('站点 HTML');
for (const page of SITE_PAGES) {
  const dup = duplicateIds(read(`packages/site/${page}`));
  check(`${page} 无重复 id`, dup.length === 0, dup.join('、'));
}
console.log(`  ${SITE_PAGES.length} 个页面`);

// ---------------- 文档里的实测数字 ----------------
// AGENTS.md 要求「改数字前先实测」，但没有守卫，于是快照数停在 176 很久没人发现。
section('文档数字');

const snapshotCount = readdirSync(join(root, 'test/snapshots')).filter((f) => f.endsWith('.svg')).length;
// 目录文件数就是权威快照数：test-core.mjs 的「无孤儿基线」保证了目录里不会留下
// 已无对应渲染的旧文件，否则这里数出来的是垃圾。
const SNAPSHOT_CLAIMS = [
  ['README.md', /(\d+)\s*个(?:渲染快照|归一化 SVG|快照)/g],
  ['AGENTS.md', /(\d+)\s*个(?:渲染快照|归一化 SVG|快照)/g],
  ['README.en.md', /(\d+)\s+(?:render snapshots?|render snapshot baselines|normalized SVG baselines)/g],
];
let snapshotClaims = 0;
for (const [file, pattern] of SNAPSHOT_CLAIMS) {
  for (const m of read(file).matchAll(pattern)) {
    snapshotClaims++;
    check(`${file} 称 ${m[1]} 个快照`, Number(m[1]) === snapshotCount, `实测 ${snapshotCount} 个`);
  }
}
console.log(`  ${snapshotClaims} 处快照数声明，实测 ${snapshotCount} 个`);

// 快照按「fixture × 页 × 两条文本路径」展开，文档里同时写着参与的 fixture 数
const snapshotFixtures = new Set(readdirSync(join(root, 'test/snapshots'))
  .map((f) => /^(.+)-p\d+-(?:html|svg)\.svg$/.exec(f)?.[1]).filter(Boolean)).size;
for (const [file, pattern] of [
  ['README.md', /(\d+) 个测试文件 × 全部页 × 两条文本路径/],
  ['README.en.md', /(\d+) test files × every slide × both text paths/],
]) {
  const m = pattern.exec(read(file));
  if (m) {
    check(`${file} 称 ${m[1]} 个快照 fixture`, Number(m[1]) === snapshotFixtures,
      `实测 ${snapshotFixtures} 个`);
  }
}


// 官网：版本号与首屏那几个大字最容易被忘掉，JSON-LD 的 softwareVersion 已经修过一次。
const siteHtml = read('packages/site/index.html');
const latestStable = /^## (\d+\.\d+\.\d+)$/m.exec(read('CHANGELOG.md'))?.[1] ?? '';
const declaredVersion = /"softwareVersion":\s*"([^"]+)"/.exec(siteHtml)?.[1];
check(`官网 JSON-LD 声明版本 ${declaredVersion}`, declaredVersion === latestStable,
  `CHANGELOG 最新稳定版是 ${latestStable}`);

const siteStat = /<b>(\d+)<\/b><span>断言 \+ (\d+) 快照<\/span>/.exec(siteHtml);
if (!siteStat) {
  check('官网能定位断言 / 快照统计', false, '首屏文案改了就来这里同步');
} else if (counts) {
  // 官网那个大数是全部套件之和；缺任何一个套件的实测就不比，免得拿半截数字去判错。
  const suites = ['core', 'edit', 'save', 'powerpoint', 'editor', 'adapters', 'collab', 'metafile'];
  const measured = suites.every((key) => typeof counts[key] === 'number')
    ? suites.reduce((sum, key) => sum + counts[key], 0) : null;
  if (measured === null) console.log('  \x1b[33m跳过官网断言总数：counts.json 不全\x1b[0m');
  else check(`官网称 ${siteStat[1]} 项断言`, Number(siteStat[1]) === measured, `实测合计 ${measured}`);
  check(`官网称 ${siteStat[2]} 个快照`, Number(siteStat[2]) === snapshotCount, `实测 ${snapshotCount} 个`);
}

// 体积：dist 在才查，让 `npm run verify` 不必先构建也能跑完前面几组。
// 容差 2%：日常改动不该天天弄红文档，但 editor 那种 40.61 → 61.82 的错误陈述必须拦下。
const TOLERANCE = 0.02;
/** 还不到失败线、但值得顺手更新的漂移 */
const NUDGE = 0.005;
if (!existsSync(join(root, 'packages/core/dist'))) {
  console.log('  \x1b[33m跳过体积核对：先 npm run build\x1b[0m');
} else {
  let sizeClaims = 0;
  const sizeTablePackages = new Map([
    ['README.md', new Set()],
    ['README.en.md', new Set()],
    ['packages/site/index.html', new Set()],
  ]);
  const entryGzipKb = (name) => {
    const dir = name.replace('@web-ppt/', '');
    const entry = join(root, 'packages', dir, json(`packages/${dir}/package.json`).main.replace('./', ''));
    return existsSync(entry) ? gzipSync(readFileSync(entry)).length / 1024 : null;
  };
  const compareEntrySize = (where, name, claimed, precision = 2) => {
    sizeClaims++;
    sizeTablePackages.get(where)?.add(name);
    if (!ownNames.has(name)) {
      check(`${where} 的 ${name} 是发布包`, false, '仓库中不存在或标记为 private');
      return;
    }
    const actual = entryGzipKb(name);
    if (actual === null) {
      check(`${name} 产物存在`, false, 'package.json main 指向的文件不存在');
      return;
    }
    const drift = Math.abs(actual - Number(claimed)) / actual;
    check(`${where} 称 ${name} 为 ${claimed}KB`, drift <= TOLERANCE,
      `实测 ${actual.toFixed(2)}KB gzip（偏差 ${(drift * 100).toFixed(1)}%）`);
    if (drift > NUDGE && drift <= TOLERANCE) {
      console.log(`  \x1b[33m~ ${where} 的 ${name} 已漂 ${(drift * 100).toFixed(1)}%（实测 ${actual.toFixed(precision)}KB）\x1b[0m`);
    }
  };
  // 中文表 `| 90.08KB |`，英文表 `| 90.08 KB |`，两份 README 必须同时跟着实测走——
  // 只查一份的话，另一份会独自漂到没人发现。
  for (const file of ['README.md', 'README.en.md']) {
    for (const [, name, claimed] of read(file)
      .matchAll(/\[`(@web-ppt\/[\w-]+)`\]\([^)]+\)[^\n|]*(?:\|[^\n|]*){2}\|\s*([\d.]+)\s*KB/g)) {
      compareEntrySize(file, name, claimed);
    }
  }
  // 官网包表写的是一位小数，同一套实测值、同一条容差
  for (const [, name, claimed] of siteHtml
    .matchAll(/<code>(@web-ppt\/[\w-]+)<\/code><\/td>(?:<td>.*?<\/td>){2}<td>([\d.]+)KB gzip/g)) {
    compareEntrySize('packages/site/index.html', name, claimed, 1);
  }

  // 有体积的包表就必须是全表；只校准已列出的行，会让新包像 collab 一样永远逃过体积核对。
  for (const [file, listed] of sizeTablePackages) {
    const missing = [...ownNames].filter((name) => !listed.has(name));
    const extra = [...listed].filter((name) => !ownNames.has(name));
    check(`${file} 的发布包体积表完整`, missing.length === 0 && extra.length === 0,
      [missing.length ? `漏列 ${missing.join('、')}` : '', extra.length ? `多列 ${extra.join('、')}` : '']
        .filter(Boolean).join('；'));
  }

  // CHANGELOG 只核对当前包版本对应的条目；旧版本数字是历史证据，不能拿今天的构建覆盖。
  const currentVersion = versions.size === 1 ? [...versions.keys()][0] : '';
  const changelog = read('CHANGELOG.md');
  const releaseStart = currentVersion ? changelog.indexOf(`## ${currentVersion} -`) : -1;
  const releaseEnd = releaseStart < 0 ? -1 : changelog.indexOf('\n## ', releaseStart + 3);
  const currentRelease = releaseStart < 0 ? ''
    : changelog.slice(releaseStart, releaseEnd < 0 ? undefined : releaseEnd);
  const collabSizes = /`@web-ppt\/collab`[\s\S]{0,700}?发布入口为 ([\d.]+)KB gzip；[\s\S]{0,120}?([\d,]+)B gzip/
    .exec(currentRelease);
  check(`CHANGELOG ${currentVersion} 能定位 collab 两种体积口径`, collabSizes !== null,
    '当前版本条目需同时声明发布入口与排除 peer 的测试薄包');
  if (collabSizes) {
    compareEntrySize('CHANGELOG.md', '@web-ppt/collab', collabSizes[1]);
    if (typeof counts?.collabThinGzip !== 'number') {
      console.log('  \x1b[33m跳过 CHANGELOG collab 薄包体积：先 npm run test:collab\x1b[0m');
    } else {
      sizeClaims++;
      const claimedThin = Number(collabSizes[2].replace(/,/g, ''));
      check(`CHANGELOG 称 collab 测试薄包为 ${claimedThin}B`, claimedThin === counts.collabThinGzip,
        `实测 ${counts.collabThinGzip}B gzip`);
    }
  }
  console.log(`  ${sizeClaims} 处 gzip 体积声明`);
}

// ---------------- 文档里的测试规模 ----------------
// 断言数只有跑完测试才知道，由各套件写进 out/verify/counts.json（见 lib/measured.mjs）。
// 声明点显式登记：新增一个套件要来这里加一行，正则漫扫会把版本号、页数一起当断言数。
section('测试规模声明');
if (!counts) {
  console.log('  \x1b[33m跳过：out/verify/counts.json 不存在，先 npm test\x1b[0m');
} else {
  const COUNT_CLAIMS = [
    ['README.md', /核心解析 \/ 渲染，([\d,]+) 项断言/, ['core']],
    ['README.md', /编辑模型 ([\d,]+) 项 \+ 保存 ([\d,]+) 项 \+ PowerPoint 证据 ([\d,]+) 项 \+ ([\d,]+) 份固件、([\d,]+) 对独立进程 SVG 指纹/,
      ['edit', 'save', 'powerpoint', 'fixtures', 'equivalence']],
    ['README.md', /([\d,]+) 项会话 \/ adapter/, ['editor']],
    ['README.md', /EMF \/ WMF \/ PICT 解码器，([\d,]+) 项断言/, ['metafile']],
    ['README.md', /React \/ Vue 的 ([\d,]+) 项 SSR/, ['adapters']],
    ['README.en.md', /— ([\d,]+) assertions \+ [\d,]+ render snapshots/, ['core']],
    ['README.en.md', /([\d,]+) edit-model \+ ([\d,]+) save \+ ([\d,]+) PowerPoint-evidence assertions, plus ([\d,]+) process-isolated SVG fingerprint pairs across ([\d,]+) fixtures/,
      ['edit', 'save', 'powerpoint', 'equivalence', 'fixtures']],
    ['README.en.md', /([\d,]+) adapter\/session/, ['editor']],
    ['README.en.md', /decoders — ([\d,]+) assertions/, ['metafile']],
    ['README.en.md', /([\d,]+) React \/ Vue SSR/, ['adapters']],
    ['AGENTS.md', /全部测试：([\d,]+) \+ ([\d,]+) \+ ([\d,]+) \+ ([\d,]+) \+ ([\d,]+) \+ ([\d,]+) \+ ([\d,]+) \+ ([\d,]+) 项断言/,
      ['core', 'edit', 'save', 'powerpoint', 'editor', 'adapters', 'collab', 'metafile']],
    ['AGENTS.md', /([\d,]+) 对编辑等价指纹/, ['equivalence']],
  ];
  let countClaims = 0;
  const skipped = new Set();
  for (const [file, pattern, keys] of COUNT_CLAIMS) {
    const m = pattern.exec(read(file));
    if (!m) { check(`${file} 能定位 ${keys.join('/')} 声明`, false, '正则没匹配到，文案改了就来这里同步'); continue; }
    keys.forEach((key, index) => {
      // 没跑到的套件跳过而不判错：counts.json 是尽力而为的产物，缺一项不等于文档写错了
      if (typeof counts[key] !== 'number') { skipped.add(key); return; }
      countClaims++;
      const claimed = Number(m[index + 1].replace(/,/g, ''));
      check(`${file} 称 ${key} 为 ${claimed}`, claimed === counts[key], `实测 ${counts[key]}`);
    });
  }
  console.log(`  ${countClaims} 处规模声明，来自 ${Object.keys(counts).length} 个套件的实测`);
  if (skipped.size) console.log(`  \x1b[33m未跑到的套件不参与比对：${[...skipped].join('、')}\x1b[0m`);
}

// ---------------- 发布包清单 ----------------
// README 长期写着「构建七个发布包」，collab 发布后没人回来改。
section('发布包清单');
const publishedShort = new Set(published.map((p) => p.name.replace('@web-ppt/', '')));
for (const [file, pattern] of [
  ['README.md', /构建[^\n（]{0,8}发布包（([^）]+)）/],
  ['README.en.md', /Build all [^\n(]{0,20}publishable packages \(([^)]+)\)/],
]) {
  const listed = pattern.exec(read(file))?.[1].split('/').map((n) => n.trim()).filter(Boolean) ?? [];
  const missing = [...publishedShort].filter((n) => !listed.includes(n));
  const extra = listed.filter((n) => !publishedShort.has(n));
  check(`${file} 的发布包清单完整`, missing.length === 0 && extra.length === 0,
    [missing.length ? `漏列 ${missing.join('、')}` : '', extra.length ? `多列 ${extra.join('、')}` : ''].filter(Boolean).join('；'));
}
console.log(`  实际 ${publishedShort.size} 个发布包`);

// ---------------- 汇总 ----------------
console.log('\n' + '─'.repeat(60));
if (failures.length) {
  console.log(`\x1b[31m✗ ${failures.length} 项不一致 / 共 ${pass + failures.length} 项\x1b[0m`);
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
console.log(`\x1b[32m✓ 全部 ${pass} 项一致性检查通过\x1b[0m`);
