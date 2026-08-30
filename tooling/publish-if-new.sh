#!/usr/bin/env bash
# registry 上已经有这个版本就跳过，否则发布。在包目录内运行。
#
# 发布是八步串行的，中间任一步挂掉都得重跑整个 job；没有这层守卫，
# 前面已发成功的包会以 EPUBLISHCONFLICT 把重跑再次弄红，
# 真正的失败原因反而被埋掉。
set -euo pipefail

name=$(node -p "require('./package.json').name")
version=$(node -p "require('./package.json').version")

if npm view "${name}@${version}" version >/dev/null 2>&1; then
  echo "::notice::${name}@${version} 已在 registry 上，跳过发布"
  exit 0
fi

echo "发布 ${name}@${version}"
if [[ "$version" == *-* ]]; then
  # npm 默认把任何 publish 都推进 latest；预发布版必须显式留在 next，
  # 否则一次 beta 发布就会让无版本安装绕过稳定版。
  npm publish --tag next
else
  npm publish --tag latest
fi
