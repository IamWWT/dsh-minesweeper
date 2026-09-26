#!/usr/bin/env bash
# dsh-minesweeper 一键安装到 dev web（3082，~/.dsh-dev）。
# 流程：构建 → 冒烟 → rm 旧（忽略未装）→ link add → 安装后验证。
# 红线：本脚本【绝不】自动重启 dsh-dev-web；需要重启时手动执行
#       systemctl --user restart dsh-dev-web  （并先获得用户同意）。
# 用法：bash scripts/install-to-dsh.sh [--no-build]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh-dev}"
DO_BUILD=1
[[ "${1:-}" == "--no-build" ]] && DO_BUILD=0

# harness 目录跨平台解析（env → 向上找兄弟 deepseek-harness）
# shellcheck source=./paths.sh
source "$HERE/scripts/paths.sh"
HARNESS="$(dsh_resolve_harness "$HERE")" || { dsh_harness_error; exit 1; }

run_dsh() { ( cd "$HARNESS" && DSH_HOME="$DSH_HOME" pnpm dsh "$@" ); }

echo "==> [1/5] 构建（node scripts/build.mjs）"
if [[ $DO_BUILD -eq 1 ]]; then
  node "$HERE/scripts/build.mjs"
fi

echo "==> [2/5] 冒烟（引擎 + 产物）"
node "$HERE/test/engine-test.mjs"
node "$HERE/test/smoke-test.mjs"

echo "==> [3/5] 移除旧安装（忽略未装）"
run_dsh plugin --profile web rm dsh-minesweeper 2>/dev/null || true

echo "==> [4/5] link 安装源码目录"
run_dsh plugin --profile web add "$HERE"

echo "==> [5/5] 安装后验证"
DSH_HOME="$DSH_HOME" node "$HERE/scripts/verify-installed.mjs"

echo
echo "✅ 安装完成。下一步（需用户同意后手动执行）："
echo "   systemctl --user restart dsh-dev-web   # 重启 3082 使插件生效"
echo "   然后刷新 http://127.0.0.1:3082，右侧栏点「扫雷」标签。"