#!/usr/bin/env bash
# registry 上已经有这个版本就跳过，否则发布。在包目录内运行。
#
# 发布是九步串行的，中间任一步挂掉都得重跑整个 job；没有这层守卫，
# 前面已发成功的包会以 EPUBLISHCONFLICT 把重跑再次弄红，
# 真正的失败原因反而被埋掉。
set -euo pipefail

verified_build=false
if [[ "$#" -gt 1 || ( "$#" -eq 1 && "$1" != '--verified-build' ) ]]; then
  echo '用法: publish-if-new.sh [--verified-build]；未知或冲突参数' >&2
  exit 2
fi
if [[ "$#" -eq 1 ]]; then verified_build=true; fi

name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")

if npm view "${name}@${version}" version >/dev/null 2>&1; then
  echo "::notice::${name}@${version} 已在 registry 上，跳过发布"
  exit 0
fi

echo "发布 ${name}@${version}"
tag=latest
if [[ "$version" == *-* ]]; then
  # npm 默认把任何 publish 都推进 latest；预发布版必须显式留在 next，
  # 否则一次 beta 发布就会让无版本安装绕过稳定版。
  tag=next
fi

if [[ "$verified_build" == true ]]; then
  # 仅 release 在根构建和 verify 后显式复用；直接调用保留 prepublishOnly 的构建保障。
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  tarball="$(node "$script_dir/pack-for-release.mjs")"
  npm publish "$tarball" --tag "$tag"
else
  npm publish --tag "$tag"
fi
