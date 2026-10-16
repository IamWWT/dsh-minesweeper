# AGENTS.md — dsh-minesweeper

本插件的工程纪律（工作区级约定见 `../../AGENTS.md`；插件工程规范见 `../AGENTS.md`（dsh-plugins monorepo）与 `../docs/管理/CMP-插件开发规范.md`——原 `PLUGIN-DEV-STANDARD.md` 路径已不存在；此处只列本插件特有项）。

## 红线

1. **不碰 3082 主力环境**：开发/验证一律走临时实例（独立 `DSH_HOME` + 端口 3084）；
   装 3082 必须经用户显式同意，且 `install-to-dsh.sh` 永远不自动重启 `dsh-dev-web`。
2. **不修改 `deepseek-harness/` 源码**：一切扩展走 Cordis 注册面。
3. **client 侧禁止第二份 React**：React 只能来自宿主 `window.__ModuleLoader__` 的 `require("react")`；
   禁止 `import "react"` 进 bundle（门禁：产物不得含 `ReactCurrentOwner`）。
4. **禁止硬编码色值**：CSS 只用 `--dsw-alias-*` / `--dsw-elevation-*` token（门禁会扫 6 位 hex）。
5. **注册面只走公开 API**：`ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab`（keyed slot）；
   不得注册与核心同名的子插槽。guide order 固定 41（改动前先在插件间核对占用）。
6. **host 侧能力以 spec 为准**：v0.5 起 `inject=["webServer","settings"]`，`apply` 注册 `/api/dsh-minesweeper/stats`（+ settings 端点）与状态文件；无 `webServer` 时静默跳过路由。新增/变更 host 能力前先改 spec（`docs/需求/BRD-001-minesweeper.md` §8）再动手。
7. **确定性**：引擎随机源必须走 `Board.rng`（`newBoard` 注入），禁止引擎内部直调 `Math.random`。
8. **版本同步：以 `package.json` 为单一事实源**。`scripts/build.mjs` 门禁**从 package.json 推导**
   期望版本并逐处断言：host `VERSION`（`src/index.ts`）、客户端徽章字面量
   （`src/client/ui.ts` 的 `dsh-minesweeper v0.x.y`）、客户端入口
   `pluginExports.VERSION`（`src/client/entry.ts`）；README/CHANGELOG 由人工同步。
   **不再在门禁里写死版本号**——写死会漏检：v0.5.2 之前 `entry.ts` 的 VERSION 长期停在
   `0.1.0` 而门禁全绿（v0.4 也曾漏掉 `ui.ts` 徽章导致 A8 首跑 FAIL）。
   自查：`grep -rn "v0\." README.md docs CHANGELOG.md src lib package.json`。
   同版本重复打包不会刷新 pnpm 安装（integrity 判定「已最新」）——安装一律走 tgz 且必须升版本号（见 README「安装」）。

## 常用命令

```bash
node scripts/build.mjs            # 构建 + 门禁 + 双端 typecheck
node test/engine-test.mjs         # 引擎单测
node test/smoke-test.mjs          # 产物冒烟
npm pack                          # 产出 dsh-minesweeper-0.5.3.tgz
DSH_HOME=~/.dsh-dev pnpm dsh plugin --profile web add <tgz 绝对路径>   # 在 deepseek-harness/ 内执行
bash scripts/install-to-dsh.sh    # 一键封装（构建→冒烟→rm 旧→安装→验证；不自动重启）
```

> 安装唯一方式为 **tgz**（不用 link）。上一条 `scripts/install-to-dsh.sh` 仍按**源码目录** `add`（link 语义），与该政策不一致——实际安装请走 `npm pack` + `plugin add <tgz>`（README「安装」）。

## 布局约定

- `src/index.ts` host 入口 → `lib/index.js`（ESM，node:* / @deepseek-ai/* external）
- `src/client/entry.ts` → `lib/client.js`（IIFE，`__ModuleLoader__` 注册）
- `src/shared/` 双端共享（引擎、难度表）；`test/` 全部为 Node 直跑脚本，无框架。