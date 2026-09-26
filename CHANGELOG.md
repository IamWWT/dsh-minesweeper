# Changelog

## [0.5.2] - 2026-09-25

跨平台与上游契约对齐：

- **主目录单源**：新增 `src/shared/dsh-home.ts`，`dshHome()` 用 `os.homedir()` 解析主目录
  （优先级 `$DSH_HOME` > `~/$DSH_HOME_DIRNAME`，默认 `.dsh-dev`）。原 `src/index.ts` 写作
  `${process.env.HOME || process.env.USERPROFILE || "/tmp"}/.dsh`——Windows 上 node 常无 `HOME`，
  且默认目录名写死为 `.dsh`（与现行 `.dsh-dev` 不符），会解析到错误位置。
- **设置卡片迁槽**：`settings.plugin.item` 已随上游 0.1.7-rc.1（commit `90af3110b7`）退役，
  改注册插件页配置区 `plugins.bundle.config`（keyed，**key = 包名**），按
  `view: 'summary' | 'page'` 分发（summary 返回 `null`）。注册到退役槽位不报错也不告警，
  只是永不渲染（表现为卡片凭空消失）。
- **构建脚本跨平台**：
  - tsc 解析不再只看 `<插件>/node_modules/typescript/bin/tsc`（本插件按布局红线不放
    `node_modules`，该路径永不成立 ⇒ `npm run check` 恒失败），改走与 esbuild 相同的
    锚点链（env → 同级 harness → DSH profile 依赖层），并用当前 Node 执行 `lib/tsc.js`
    （`bin/tsc` 无扩展名，Windows 上直接 spawn 会 ENOENT）。
  - `tsconfig.json` 去掉写死的 `typeRoots: ["./node_modules/@types"]`（同上原因会报 TS2688）。
  - `tsconfig.client.json` 的 `types` 由 `[]` 改为 `["node"]`（`src/shared/dsh-home.ts` 用到
    `node:os`/`node:path`/`process`，而该 tsconfig 的 `include` 覆盖 `src/shared/**`）。
  - `test/external-preload.mjs` 的基准目录判据不再只看「存在 `@deepseek-ai` 目录」——
    harness monorepo 根的 `node_modules` 也有该目录但不含 `schemastery` 这类 peer 依赖，
    选中它会让门禁报 `Cannot find package '@deepseek-ai/schemastery'`；改为按能否真正解析到
    `schemastery` 来挑。
- **共享路径解析器**：`scripts/paths.mjs` 的 `buildFallbackDirs()` 补上
  `<DSH_HOME>/profiles/node_modules`（DSH 把 `@deepseek-ai/*` hoisted 到该层），
  且排在 `<profile>/node_modules` 之前；`findTypeRoots()` 补探 pnpm 虚拟 store
  （`<dir>/node_modules/.pnpm/@types+<pkg>@<ver>/node_modules/@types`），
  使无本地 `node_modules` 时客户端 typecheck 也能解析到 `@types/react`。
- **回归门禁修正**：`test/smoke-test.mjs` 原先断言已退役的 `settings.plugin.item`
  （断言写在死契约上，只在**正确迁移之后**才会变红），改为断言 `plugins.bundle.config`。
- **版本门禁补漏**：`scripts/build.mjs` 的版本断言改为**从 `package.json` 推导期望值**
  （原先写死 `"0.5.2"`），并新增对 `src/client/entry.ts` 的 `pluginExports.VERSION` 断言。
  此前门禁只查 host `VERSION` 与 `ui.ts` 徽章，`entry.ts` 的 VERSION 长期停在 `0.1.0` 却全绿
  ——所谓「五处同步」实际只覆盖四处。`AGENTS.md` 规则 8 同步改写。
- 文档同步：README 版本号、`css.ts` / `settings-card.ts` / `src/index.ts` 中仍写旧槽位的注释。

## [0.5.1] - 2026-09-24

0.1.7 原生适配（harness 0.1.6→0.1.7 升级后 settingsScope 服务移除）：

- **host**：`Config` 新增 volatile 字段 `gameSettings`（`MinesweeperSettingsSchema`，`.volatile()`）；
  设置读 = 插件行字段当前值，写 = `ctx.settings.mutate(ns, ops)`（ns = 本插件 entry id，
  落 profile 用户层）；`loader/volatile-update`（`paths[0]==="gameSettings"`）驱动前端即时刷新；
  新增 `GET/PUT /api/dsh-minesweeper/settings`（`{value, revision, writable}` / 409 乐观锁）+
  `GET /settings/watch`（长轮询 ≤25s）。settings 服务缺失时只读降级，游戏与 `/stats` 不受影响。
- **client**：移除 `settingsScope` 服务依赖（0.1.7 已删该服务）；新增 `settings-api.ts`
  fetch 适配器（getSnapshot/subscribe/set/unset，同面替换旧 binder scope），卡片改走
  `/api/dsh-minesweeper/settings*` 插件自有端点；`inject` 不再声明 `settingsScope`。
- 版本五处同步 0.5.1。

## [0.5.0] - 2026-09-15
 - 2026-09-15

成绩迁 host 侧 + 设置卡片（spec §8 D6/D7，验收 A11–A15 全绿）。

### Added
- **D6 成绩迁 host 侧**：host 成为成绩权威源——`$DSH_HOME/profiles/<profile>/dsh-minesweeper/stats.json`
  （原子写 tmp+rename，损坏文件按空表处理并保留 `.corrupt` 备份），经
  `GET/PUT/DELETE /api/dsh-minesweeper/stats` 读写（`inject += ["webServer","settings"]`，
  参照 dsh-scheduled-send 模式）。浏览器 `localStorage` 降级为离线镜像/降级源：
  API 不可达时游戏照常可玩，恢复后以 host 覆盖本地视图（不反向回传，避免把过期数据刷回 host）。
  效果：同一机器上成绩跨浏览器/跨 profile/跨重启保留（原"跨会话排行榜"诉求的落地形态）。
- **D7 设置卡片**：设置页「扫雷」卡片（`settings.plugin.item`，命名空间 `dsh-minesweeper`），
  唯一项「默认开启标记模式」（`flagModeDefault`，schema 走 `@deepseek-ai/schemastery`）；
  游戏挂载时读取决定标记模式初始态，HUD 内开关仍是会话内开关，二者互不覆盖。

### Changed
- 版本五处同步 0.5.0（`package.json` / `src/index.ts` VERSION / 构建门禁 / README / `ui.ts` 徽章）。
- 构建门禁新增断言：`lib/index.js` 的 `inject` 必须含 `webServer` + `settings`。

### 验证
- 引擎 40/40、产物冒烟、A7/A8 回归矩阵全绿（A15）。
- 3084 临时实例：A11 路由三端（含 404 语义/坏 JSON 容错/并发写不损坏文件）、
  A12 双上下文探针（上下文 A 打完一局 → 全新无 localStorage 的上下文 B 可见 A 的成绩）、
  A13 设置卡片探针 + 截图、A14 API 断开降级可玩 + 清空记录同步清 host 文件，全部通过。

## [0.4.0] - 2026-09-14

用户实测反馈两条（v0.3 交付后）：①成绩行里出现裸 `<b>` 文本；②一局打完后用时仍在走、剩余雷=0 的疑问。

### Fixed
- **成绩行裸 `<b>` 文本**：v0.3 用 HTML 字符串拼成绩行，但 React `createElement` 不解析 HTML 字符串，
  `<b>` 被当纯文本渲染（用户看到 `<b>120.4s</b>` 字面量，即其"显示不正常"的根因）。
  v0.4 改为真实元素 `h("b", null, ...)` 构造，`<b>` 正常加粗、无字面标签（A8-F15 断言）。
- **终局停表**：经典规则——游戏结束（输/赢）立即冻结计时，不再继续走秒。
  `onEnd()` 结算前定格 `elapsed`（`startRef` 置空），此后 HUD 用时保持不变（A8-F16 断言 `003→003`）。

### 说明（非 bug）
- **赢棋时「剩余雷」=0 是正确行为**：引擎赢棋时自动给全部剩余雷插旗，旗数=雷数 →
  「剩余雷 = 雷数 − 旗数」自然归零；输棋同理。v0.4 起该表带「💣 剩余雷」标签，语义不再含糊。

### Changed
- 版本五处同步 0.4.0（`package.json` / `src/index.ts` / 构建门禁 / README / `ui.ts` 版本徽章）。
  > 教训：`ui.ts` 的版本徽章是第 5 个同步点，sed 批量升版必须包含它
  > （v0.4 首跑 A8 即因徽章仍为 v0.3.0 而 FAIL，已写入插件 AGENTS.md 红线 8）。

### 验证
- 构建 + 双 tsconfig + 冒烟 24 项 + 引擎 40/40 全绿。
- 3084 临时实例（重启取新 token）：A8 浅色 fresh 21/21（徽章 v0.4.0 / F15 无裸 `<b>` / F16 用时定格）
  + A8 深色 20/20 + A7 回归 22/22。
- 截图：`docs/screenshots/v04-{light,fs-light,fs-dark,dark}.png`。

## [0.3.0] - 2026-09-14

用户反馈驱动（全屏缺失 / 明暗仍不明显 / 两个数字含义不明 / 成绩显示怪）。

### Added
- **全屏模式**：HUD「⛶ 全屏」把棋盘放大铺满整个窗口（按 cols/rows 比例缩放、不超视口），
  `Esc` 或按钮退出；全屏内可正常对局。实现为 `position:fixed` 覆盖层（`msw-fs`），不改动宿主布局。
- **可点性=明暗**：未开格=凸起按键（`pointer` 光标+悬停高亮），已开空白格=凹陷地板（`default` 光标，不可点），
  数字格=可点和弦（悬停品牌色描边）。明暗层级改用**主题无关的中性 rgba 光影**——DSH 浅色主题
  token 阴影透明度仅 0.05–0.12，白底上不可见（v0.2 仍"看不到明暗"的根因）；浅色靠暗影、深色靠顶缘高亮。
- **HUD 数字标签**：两个数码表分别标注「💣 剩余雷」「⏱ 用时(秒)」。
- 成绩区无对局时显示「暂无记录 · 打完一局自动记录」。

### Changed
- 成绩显示：`胜负 W/P` → 「🏆 N胜 M负 · 共N局」+「最佳 X.Xs」（W/P 易被误读为"胜负数"）。
- 版本四处同步 0.3.0；构建门禁/冒烟新增 v0.3 断言（全屏/标签/成绩语义）。

### 验证
- 构建+双 tsconfig+冒烟 24 项+引擎 40/40 全绿。
- 3084 临时实例：A7 回归 22/22（含新光影的 R4/R5/R6 明暗断言）；A8 v0.3 矩阵 19/19（浅色 fresh）
  + 18/18（深色）：全屏进出（按钮/Esc）、全屏内开格、光标三态、表头标签、全屏棋盘适配、成绩新语义。
- 截图：`docs/screenshots/v03-{light,fs-light,fs-dark,dark}.png`。

## [0.2.0] - 2026-09-14

### Added
- **标记模式**（v0.2 用户反馈驱动）：HUD 新增「🚩 标记模式」开关——开启后左键点格 = 插旗/取消旗
  （未开格），已开格点按仍走和弦；右键与长按在两种模式下都始终可插旗。
  开启时棋盘容器加品牌色描边提示，按钮高亮（`aria-pressed`）。
- **操作提示行**：棋盘下方常驻一行操作说明（随标记模式开/关切换文案），解决「功能存在但发现性差」问题。
- **明暗层级重做**（用户反馈「阴影没有体现，未开格看不分明暗」）：未开格 = 凸起（双色 bevel + `lv2` 外投影），
  已开格 = 凹陷（单内阴影 + 描边）。浅色主题两层背景色完全相同（对比 1.00），明暗差异此前基本不可见，
  现改由投影/内阴影承载（纯 `--dsw-*` token，无硬编码色值）。

### 说明
- 标记模式为 UI 偏好（会话内保持，刷新页面重置），不写入成绩 localStorage。
- 引擎零改动：`src/shared/engine.ts` 与单测不变（40/40）。
- 版本四处同步：`package.json` / `src/index.ts` / 构建门禁 / README。
- 验证：构建+双 tsconfig 类型检查全绿；3084 临时实例交互矩阵（开/关标记模式 × 右键/长按/和弦/重开）全部通过。

dsh-minesweeper 变更记录。格式跟随 [Keep a Changelog](https://keepachangelog.com/zh-CN/)。

## [0.1.0] - 2026-09-14

首版：经典扫雷进入 DSH 右侧栏。

### Added
- 引擎（`src/shared/engine.ts`，纯函数、确定性 rng）：首点安全雷布（首点+8 邻域无雷）、
  洪水填充、和弦（旗数匹配才引爆，误标按经典规则不保护）、旗标互斥、胜负判定、
  胜利自动插旗、自定义网格可行性校验（行/列 5–30，雷数 ≤ 格数×0.5 且首点安全余量成立）。
- 客户端 UI（`src/client/`）：CSS grid 棋盘、数字 1–8 主题 token 配色、终局展示
  （全雷+错旗打叉）、HUD（剩余雷数/计时封顶 999s/🙂😵😎 重开）、长按 ≥350ms 插旗
  （位移 >12px 或离格取消）、右键插旗、难度三档+自定义表单（即时报错）。
- 注册：`sidebarRightTabs.register`（id=`dsh-minesweeper`, kind=`minesweeper`,
  priority=extension, guide order=41）+ `sidebar.right.pane.tab` 主体；不自动打开（D2）。
- 成绩：`localStorage` `dsh-minesweeper/v1/<难度>` = `{bestMs, plays, wins}`，
  随难度切换自动切换键，「清空记录」二次确认。
- 工程：esbuild 双端产物 + 产物门禁（host 导出断言 / client 注册面 / 无第二份 React /
  无硬编码色值）；引擎单测 40 项（含 300 次首点安全采样、确定性 rng 回放）；
  冒烟测试 `test/smoke-test.mjs`；`scripts/install-to-dsh.sh`（link 安装，不自动重启）。

### 验证
- `pnpm check`（build+typecheck+smoke）全绿；引擎单测 40/40。
- 临时实例（3084，独立 DSH_HOME）：插件 client 真实加载、`#msw-style` 注入、0 控制台错误。
- 注：右侧栏标签的「点击即玩」需完成 DSH 首启 onboarding（工作区/模式，核心流程），
  已在临时实例完成到「会话+右侧栏」一步，标签本体可见性随核心 onboarding 状态。
