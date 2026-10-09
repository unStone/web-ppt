/**
 * 「完成后检查文档是否需要同步」——同一套判定逻辑，两个挂载点：
 *
 *  · node check-doc-sync.mjs stop        ZCode Stop hook（AI 每次完成回复时，工作区视角）
 *  · node check-doc-sync.mjs pre-commit  git pre-commit hook（任何客户端提交时，暂存区视角）
 *
 * 文档漂移是这个仓库的已知陷阱（AGENTS.md「文档数字会悄悄过期」）：verify 只能拦
 * 数字与链接这类机械可比对的事实，拦不住「新能力没写进能力矩阵」这类语义缺口。
 * 本脚本把机械可判的部分（改了什么类别的文件）算出来，把语义判断交还给人或 AI。
 *
 * 行为契约（两个模式一致）：
 *  - 改动未触及敏感区域，或只改了 Markdown → 静默放行（exit 0，无输出）
 *  - 触及敏感区域 → 首次拦截并给出待复查文档清单；此后同一批敏感文件的重试放行，
 *    等于「已确认无需更新」。指纹只含敏感文件（列表 + 内容），因此拦截之后补改
 *    文档不会生成新指纹、不会被再次拦截。
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2] ?? 'stop';
if (!['stop', 'pre-commit'].includes(mode)) {
  console.error(`未知模式 ${mode}，可用：stop | pre-commit`);
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const stateFile = join(root, `out/hook/doc-sync-${mode}-state.json`);
/** pre-commit 看暂存区（这次提交），Stop 看工作区（这次会话），git 参数只差 --cached */
const cached = mode === 'pre-commit';
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

/** 敏感区域 → 需要复查的文档。规则与 docs/testing.md、releasing.md 的职责对齐。 */
const RULES = [
  {
    match: (f) => /^packages\/[^/]+\/src\//.test(f) || /^packages\/[^/]+\/package\.json$/.test(f),
    docs: 'docs/architecture.md（分层与依赖是否变化）、docs/api/ 下对应能力文档、README 包表',
  },
  {
    match: (f) => /^tooling\/make-[^/]+\.mjs$/.test(f) || /^fixtures\//.test(f),
    docs: 'docs/testing.md 固件约定、README 测试文件表',
  },
  {
    match: (f) => /^tooling\/(test|check)-[^/]+\.mjs$/.test(f) || f === 'package.json',
    docs: 'docs/testing.md（门禁与断言计数登记）、README / README.en / AGENTS 的断言数（npm test 后实测，verify 会比对）',
  },
  {
    match: (f) => /^test\/snapshots\//.test(f),
    docs: 'README / README.en / AGENTS 的快照数（实测口径见 docs/testing.md）',
  },
  {
    match: (f) => /^\.github\/workflows\//.test(f) || f === 'CHANGELOG.md',
    docs: 'docs/releasing.md（流水线行为与发版 checklist）',
  },
];

const diffArgs = cached ? ['diff', '--cached'] : ['diff', 'HEAD'];
const changed = new Set([
  ...git(cached ? ['diff', '--cached', '--name-only'] : ['diff', 'HEAD', '--name-only'])
    .split('\n').filter(Boolean),
  // Stop 模式补上未跟踪文件（untracked 不出现在 diff 里）；pre-commit 只认暂存区
  ...(cached ? [] : git(['status', '--porcelain']).split('\n').filter(Boolean)
    .map((line) => line.slice(3).trim())),
]);

const hits = [...changed].filter((f) => RULES.some((r) => r.match(f))).sort();
if (!hits.length) process.exit(0);

const fingerprint = createHash('sha256')
  .update(hits.join('\n') + git([...diffArgs, '--', ...hits]))
  .digest('hex');
const previous = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : null;
if (previous?.fingerprint === fingerprint) process.exit(0);
mkdirSync(dirname(stateFile), { recursive: true });
writeFileSync(stateFile, JSON.stringify({ fingerprint }, null, 2) + '\n');

const docList = [...new Set(RULES.filter((r) => hits.some(r.match)).map((r) => r.docs))];
const message = [
  '本次改动触及需要同步文档的区域，请先判断文档是否需要更新：',
  ...docList.map((d) => `· ${d}`),
  '',
  '触及的文件：', ...hits.map((f) => `· ${f}`),
  '',
  '若对应文档已更新，或改动属于无行为变化的内部调整，重新执行刚才的操作即可通过（同一批文件只提醒一次）。',
].join('\n');

if (mode === 'stop') {
  // Stop 事件的 block 即请求继续，reason 会注入对话
  process.stdout.write(JSON.stringify({ decision: 'block', reason: message }));
} else {
  // git hook：stderr 展示给提交者，exit 1 中断本次提交
  console.error(message);
  process.exit(1);
}
