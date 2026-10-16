# REQUIREMENTS — dsh-minesweeper（spec 001 的实现→验收映射）

## 当前状态

- 文档性质：规格（需求 → 实现 → 验收映射）
- 对应版本：v0.5.3
- 状态：有效（v0.5 起成绩权威源已升至 host 侧文件，见 R5/R7；下表 A3/A4/A6 的 ⚠️/⏳ 为当时未闭环项）
- 维护者：AI + 用户

> 完整决策记录见 `BRD-001-minesweeper.md`（D1–D4 已与用户确认，D5–D7 见该文件 §8）。本文件是实现侧映射。

## 需求 → 实现

| # | 需求（spec 章节） | 实现 | 落点 |
|---|---|---|---|
| R1 | 右侧栏标签页入口（D1=a） | `sidebarRightTabs.register({id:"dsh-minesweeper", kind:"minesweeper", priority:"extension", guide order 41})` + `sidebar.right.pane.tab` keyed slot | `src/client/entry.ts` |
| R2 | 不自动打开（D2=a） | 注册不 `openTab`；用户经右侧栏手动点入 | `src/client/entry.ts` |
| R3 | 三档 + 自定义（D3=a） | PRESETS 三档 + `validateCustom`（行/列 5–30，雷 ≤ 格数×0.5，`isFeasible` 含首点安全余量） | `src/shared/difficulties.ts` |
| R4 | 经典规则：首点安全/洪水/和弦/插旗/胜负 | 纯函数引擎；首点排除点+8 邻域；和弦=旗数==数字才引爆；`rng` 挂在 Board（确定性） | `src/shared/engine.ts` |
| R5 | 成绩持久化（D4=a，假设项；v0.5 起升为 host 侧文件） | 权威源 `$DSH_HOME/profiles/<profile>/dsh-minesweeper/stats.json`（`GET/PUT/DELETE /api/dsh-minesweeper/stats`）；`localStorage` `dsh-minesweeper/v1/<难度id>` = `{bestMs, plays, wins}` 为降级镜像；随难度切换换键；清空二次确认 | `src/host/state.ts`、`src/host/routes.ts`、`src/client/ui.ts` |
| R6 | 主题 token，无硬编码色 | `css.ts` 全量 `--dsw-alias-*`/`--dsw-elevation-*`；数字 1–8 用 label/link/warn 系 token 映射 | `src/client/css.ts` |
| R7 | host 侧入口（v0.1 空壳 → v0.5 起持有成绩/设置面） | `src/index.ts`：`name` / `inject=["webServer","settings"]` / `apply`（注册 stats 路由 + settings 面）/ `VERSION` | `src/index.ts`、`src/host/routes.ts` |

## 验收对照（spec §4）

| 验收 | 状态 | 证据 |
|---|---|---|
| A1 pnpm check 全绿 | ✅ | build+gate+双端 typecheck+smoke（2026-09-14 运行，全绿） |
| A2 引擎单测 | ✅ | `test/engine-test.mjs` 40/40（首点安全 300 采样、洪水、和弦、胜负、边界） |
| A3 临时实例完整对局 | ⚠️ 部分 | 插件在 3084 真实 harness 加载、`#msw-style` 注入、0 报错（`test/runtime-probe.mjs`）；
  标签可见性与「开格/插旗/和弦/输赢」点击链路依赖 DSH 首启 onboarding（核心流程，非插件），
  需人工在浏览器完成一次首启（约 30s）后点标签复验；引擎行为已由 40 项单测等价覆盖 |
| A4 成绩持久化/刷新不丢/清空归零 | ⏳ | 逻辑由单测+代码审查覆盖；UI 复测并入 A3 人工环节 |
| A5 明暗主题无硬编码色 | ✅（静态） | 门禁扫描产物无 6 位 hex；人工亮/暗各看一眼随 A3 复验 |
| A6 卸载后无残留 | ⏳ | `dsh plugin --profile web rm dsh-minesweeper` 后刷新：标签消失、无报错（待 3082/3084 验证） |

## 假设（记录在案）

- A：成绩持久化（D4 未单独提问，按推荐项处理）：v0.1 存 localStorage，v0.5 起权威源为 host 侧
  `$DSH_HOME/profiles/<profile>/dsh-minesweeper/stats.json`，localStorage 降级为离线镜像。
- B：guide order=41 空闲（核对过 21/22/23/30–35 占用）。
- C：`rng` 直调 `Math.random` 仅在 UI 层 `newBoard` 缺省参数处发生，引擎内部一律 `b.rng`。
- D：成绩键实现为**按难度分键** `dsh-minesweeper/v1/<难度id>`（spec 原文写的单键
  `dsh-minesweeper:stats.v1` 为占位写法；分键更利于「随难度切换换键/清空当前难度」，
  语义与 spec「按难度存」一致，差异仅键的形态）。
