import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { sourceAliasArgs } from './bundle-browser.mjs';

let importSequence = 0;

export async function bundleNode({ root, entry, output, aliases }) {
  execFileSync('npx', [
    'esbuild', entry, '--bundle', '--format=esm', '--platform=node', '--log-level=error',
    ...sourceAliasArgs(root, aliases), `--outfile=${output}`,
  ], { cwd: root, stdio: 'inherit' });
  return import(`${pathToFileURL(output).href}?run=${process.pid}-${++importSequence}`);
}
