# Tasks — dsh-minesweeper（001）

## 当前状态

- 文档性质：历史记录（任务与验证留痕：进度清单 T1–T9 + 正文 T10–T13 详情节）
- 对应版本：v0.5.3
- 状态：历史记录，结论按当时口径（进度清单 T1–T9 全为 [x]；T7 的「重启 + 刷新 3082 复验」当时留给后续会话，安装本身已完成；T10–T13（v0.4/v0.5）为后续补充的详情节）
- 维护者：AI + 用户

> 每个任务 = 一个逻辑改动。`done` = 该任务的验收条件；`验证` = 具体命令/操作。

## 进度（2026-07-02 收口）

- [x] T1 脚手架（build/typecheck 绿，lib/ 双产物）
- [x] T2 引擎 + 单测（40/40 断言通过，含确定性回放）
- [x] T3 客户端 UI（棋盘/HUD/自定义/长按/和弦/成绩，全进 client bundle）
- [x] T4 入口注册（`__ModuleLoader__` + `sidebarRightTabs` + `sidebar.right.pane.tab`，门禁断言通过）
- [x] T5 冒烟 + 安装脚本（smoke 19 项绿；install-to-dsh.sh 不自动重启）
- [x] T6 临时实例验证（3084 独立 DSH_HOME：引擎交互全流程 7/8+step9 3/3 通过；
      A6 卸载/重装双向验证——卸载后无 msw-style/无扫雷标签/0 错误，重装后
      msw-style 加载、扫雷标签可点、81 格棋盘渲染、首点泛洪开 6 格、0 插件错误）
- [x] T7 交付 3082（**待用户显式同意**：`bash scripts/install-to-dsh.sh` +
  `systemctl --user restart dsh-dev-web`，之后刷新 3082 复验。
  2026-07-02：安装已完成（link 安装 + 12/12 布局验证；期间修复 3082 profile 缺失的
  `dsh-trading-workbench-0.17.0.tgz` 依赖文件——从插件源目录补回）；**重启 + 刷新 3082 复验**
  留给用户执行或后续会话执行。**注意**：重启前 `dsh-dev-web` 进程仍持有旧代码，标签不会出现。）
- [x] T8 v0.2（2026-09-14）：标记模式开关 + 操作提示行 + 明暗层级重做。3084 临时实例 A7 无头矩阵 22/22
  （开/关标记模式 × 右键/长按/和弦/重开 + 明暗截图 v02-light/v02-dark 入 docs/screenshots/）；
  3082 link 安装就位（profile 内即新 client.js），刷新页面即生效，未重启服务。
- [x] T9 v0.3（2026-09-14）：全屏模式 + 可点性三态（光标/光影/悬停）+ HUD 数字标签 + 成绩语义。
  A8 矩阵 19/19（浅色 fresh）+ 18/18（深色）、A7 回归 22/22、build/typecheck/冒烟 24/引擎 40 全绿；
  像素差验证全屏与深色主题生效；截图 v03-{light,fs-light,fs-dark,dark} 入 docs/screenshots/。

## T1 脚手架（空壳可跑）

- 改动文件：`package.json`、`tsconfig.json`、`tsconfig.client.json`、`cordis.patch.yml`、
  `scripts/build.mjs`、`scripts/typecheck.mjs`、`src/index.ts`、`LICENSE`、`.gitignore`
- 说明：package.json 按 PLUGIN-DEV-STANDARD §2.2 模板（`dsh.bundle` + `dsh.client`）；
  build.mjs 含产物门禁（host 断言 `name/apply/inject/VERSION`，client 断言
  `__ModuleLoader__` / 插件 id / `sidebarRightTabs` / `sidebar.right.pane.tab`）；
  src/index.ts 为占位 host（apply 空操作）；先放一个最小 client entry 让构建链跑通
  （T4 再补全注册逻辑）。
- done：`node scripts/build.mjs && node scripts/typecheck.mjs` 全绿，`lib/` 双产物生成。
- 验证：`cd dsh-plugins/dsh-minesweeper && node scripts/build.mjs && node scripts/typecheck.mjs`

## T2 游戏引擎 + 单测

- 改动文件：`src/shared/engine.ts`、`src/shared/difficulties.ts`、`test/engine-test.mjs`、
  `test/engine.bundle.mjs`（esbuild 打包引擎到 `test/dist/` 的薄脚本）、`package.json`（test 脚本）
- 引擎 API：`newBoard / revealAt / chord / toggleFlag / neighborsOf / remainingMines / isFeasible`，
  支持注入 `rng`（确定性测试）。
- 单测覆盖：参数校验抛错、首点安全 300 次随机采样、首点安全+邻域无雷、雷数守恒、
  无雷盘单点开满即胜、撞雷判负（lostAt 正确）、和弦引爆/不引爆、flag 与 reveal 互斥、
  胜利自动插旗、自定义边界（5×5 可行 / 超雷数不可行）。
- done：`node test/engine-test.mjs` 全绿（含确定性 rng 回放）。
- 验证：`cd dsh-plugins/dsh-minesweeper && node test/engine-test.mjs`

## T3 客户端 UI（棋盘 + HUD + 自定义表单 + 成绩）

- 改动文件：`src/client/css.ts`、`src/client/ui.ts`（R.createElement 风格）、`src/client/react-shim.d.ts`
- 覆盖：棋盘（CSS grid + aspect-ratio 自适应）、8 数字色 token 映射、未开格浮起/开格下沉、
  输棋全雷展示 + 错旗打叉、HUD（雷数/计时/表情重开）、难度切换（含自定义表单 + 非法输入即时报错）、
  长按插旗、和弦、localStorage 成绩（bestMs/plays/wins + 清空按钮二次确认）。
- done：`node scripts/build.mjs` 绿（UI 全部进 client bundle）；typecheck 绿。
- 验证：`node scripts/build.mjs && node scripts/typecheck.mjs`

## T4 入口注册（entry.ts 完整化）

- 改动文件：`src/client/entry.ts`
- 注册：`sidebarRightTabs.register({ id:"dsh-minesweeper", kind:"minesweeper", priority:"extension",
  guide: order=41 })` + `sidebar.right.pane.tab`（key=`dsh-minesweeper`）；样式随 effect 清理；
  不 openTab（D2）。
- done：client 产物含 `sidebarRightTabs`、`sidebar.right.pane.tab`、`dsh-minesweeper`、`__ModuleLoader__`
  （build 门禁断言）。
- 验证：`node scripts/build.mjs`（含门禁）

## T5 冒烟测试 + 安装脚本

- 改动文件：`test/smoke-test.mjs`、`scripts/verify-installed.mjs`、`scripts/install-to-dsh.sh`
- smoke：host 产物动态 import 断言导出 + client 文本断言 + 顶层布局卫生。
- install-to-dsh.sh：构建→冒烟→`dsh plugin --profile web rm`（忽略未装）→`add` link→verify；**不重启**。
- done：`node test/smoke-test.mjs` 绿。
- 验证：`bash scripts/install-to-dsh.sh --help` 可打印用法；正式安装走 S4/S5。

## T6 临时实例验证（3084）

- 操作：`DSH_HOME=$HOME/.dsh-minesweeper-test DSH profile web`（独立 home）+
  `pnpm dsh web --port 3084 --no-open`（在 dsh-test/deepseek-harness 或主 harness 内），
  `dsh plugin --profile web add <源码目录>`（指向测试 DSH_HOME）。
- 手测 A3/A4/A5：开标签→三档+自定义对局（开格/插旗/和弦/输/赢/重开）→ 成绩持久化 →
  明暗主题各看一眼 → 刷新页面。
- done：spec A3/A4/A5 逐条勾掉并截图留档（docs/screenshots/）。
- 验证：浏览器手工 + 截图证据。

## T7 交付 3082（需用户同意）

- 操作：`dsh-dev plugin --profile web add <源码目录>`（3082）→ **征询用户同意后**
  `systemctl --user restart dsh-dev-web` → 刷新 3082 复验标签可用。
- 文档：README/CHANGELOG/REQUIREMENTS/TROUBLESHOOTING 收口，`pnpm check` 终检。
- done：3082 上标签可玩 + 文档齐全。

## T8 v0.2 标记模式 + 操作提示（2026-09-14，用户反馈驱动）

- 背景：用户实测 3082 后反馈「不知道要右键/长按插旗」→ spec 增补 D5（开关+提示行方案）/A7。
- 改动：`src/client/ui.ts`（`flagMode` 状态 + HUD「🚩 标记模式」开关 + `reveal()` 标记模式分支
  + 棋盘 `msw-flagmode` 描边 + 操作提示行 + 右键按钮守卫）、`src/client/css.ts`（`.msw-hint`/`.msw-flagmode` + 明暗层级重做：未开格=凸起 bevel+`lv2` 外投影、已开格=凹陷内阴影+描边，全 token）、
  版本号 0.2.0 四处同步（package.json / src/index.ts / 构建门禁 / README）。
- done：构建+双 tsconfig 类型检查全绿、冒烟含新断言（标记模式/提示行）、3084 无头脚本化
  交互矩阵（A7）全过、3082 link 安装后刷新页面即生效（link 安装无需重启服务）。
- 验证：`node scripts/build.mjs && node test/smoke-test.mjs` + 3084 无头浏览器 A7 矩阵。

## T9 v0.3 全屏 + 可点性明暗 + HUD 自解释（2026-09-14，用户反馈驱动）

- 背景：用户反馈 4 点——①无全屏；②"不可点击的部分仍缺少标记"（浅色主题 token 阴影透明度仅
  0.05–0.12，白底上不可见，v0.2 纯 token 光影实际失效）；③右上角两个数字序列含义不明；
  ④"最佳/胜负"显示观感异常（W/P 语义易误读 + 空数据显示"— 0/0"）。
- 改动：`src/client/ui.ts`（`fs` 状态 + ⛶ 全屏按钮 + Esc 监听 + root `msw-fs` + root 注入
  `--msw-ar=cols/rows` + 表头数字标签 + 成绩区"暂无记录/N胜M负·共N局"）、
  `src/client/css.ts`（全屏 `position:fixed` 覆盖层 + wrap 定宽防循环尺寸塌缩；
  三态格子：未开=凸起按键 pointer、已开空白=凹陷地板 default、数字格=和弦可点 pointer；
  中性 rgba 光影替代纯 token 阴影；`--msw-floor` 主题 tint）；
  版本号 0.3.0 四处同步；smoke 新增 3 条 v0.3 断言。
- 教训：DSH 浅色主题 `--dsw-shadow-lv*`/`--dsw-alias-border-l*` token 在纯白底上接近不可见，
  "主题 token 承载光影"仅在深色主题成立——明暗层级必须叠加主题无关的中性 rgba 光影。
  全屏 wrap 用 `fit-content` 会导致子元素百分比宽循环塌缩，必须给 wrap 定宽。
- done：构建+双 tsconfig+冒烟 24+引擎 40 全绿；3084 A8 19/19（浅色）+18/18（深色）、
  A7 回归 22/22；像素差验证（全屏 0.096 显著差异 / 深色 0.998 全幅）；截图入 docs/screenshots/。
- 验证：`node scripts/build.mjs && node test/smoke-test.mjs` + 3084 A8/A7 无头矩阵。

## T10 v0.4 成绩行裸 `<b>` 修复 + 终局停表（2026-09-14，用户反馈驱动）

- 背景：用户实测反馈 2 点——①「最佳 120.4s 🏆 1胜 0负」行里出现裸 `<b>` 文本（"下面显示仍旧是有
  /b 这份陌生符号"）；②一局打完后"用时还在计时，剩余雷数已经是 0"。
- 根因：①v0.3 用 HTML 字符串拼成绩行，React `createElement` 不解析 HTML 字符串 → `<b>` 当纯文本渲染；
  ②计时器是独立 interval，终局未停表（经典规则应在终局定格）。"剩余雷=0"非 bug：赢棋时引擎自动
  给全部剩余雷插旗，旗数=雷数 →「剩余雷=雷数−旗数」自然归零。
- 改动：`src/client/ui.ts`（成绩行改真实元素 `h("b", null, ...)`；`onEnd()` 结算前定格
  `elapsed` 并清空 `startRef`）；版本五处同步 0.4.0（含 `ui.ts` 版本徽章——第 5 个同步点，
  已写入插件 AGENTS.md 红线 8）；`probe/a8-matrix.mjs` 新增 F15（无裸 `<b>`）/F16（终局停走）断言。
- 教训：版本徽章字面量是第 5 个版本同步点，sed 批量升版必须覆盖（v0.4 首跑 A8 因徽章仍 v0.3.0 FAIL）；
  3084 实例须在 rebuild 后**重启**（启动时缓存 client bundle），且 nohup 起的进程会随命令沙箱消亡，
  必须用常驻后台 job 启动。
- done：构建+双 tsconfig+冒烟 24+引擎 40 全绿；3084（重启后新 token）A8 浅色 fresh 21/21 +
  深色 20/20 + A7 回归 22/22；截图 `v04-*.png` 入 docs/screenshots/；文档四件套收口。
- 验证：`node scripts/build.mjs && node test/smoke-test.mjs` + 3084 A8/A7 无头矩阵。

## T11 v0.5 host 侧成绩持久化（2026-09-14，用户确认开工）

- spec：D6（host 文件为权威源 + `/api/dsh-minesweeper/*` 路由）+ A11/A14/H1–H3。
- 改动：`src/index.ts`（`inject` 增 `webServer`/`settings`，apply 注册路由）、新增
  `src/host/state.ts`（状态文件读写：tmp+rename 原子写、损坏文件备份 `.corrupt`）与
  `src/host/routes.ts`（GET/PUT/DELETE `/api/dsh-minesweeper/stats`，`readBody(req)` 只读请求对象）；
  新增 `test/host-test.mjs`（假 req/res 单测：状态机 + 路由语义 + 并发写完整性）。
- 状态目录：`$DSH_HOME/profiles/<profile>/dsh-minesweeper/stats.json`（H1）。

## T12 v0.5 设置卡片 + 标记模式默认值（2026-09-14）

- spec：D7 + A13/H4。
- 改动：host `settings.register("dsh-minesweeper", z.object({flagModeDefault}))`（schemastery，
  参照 dsh-global-auth）；client `settings.plugin.item`（key=命名空间）自定义卡片 +
  `settingsScope` binder 读取初始值；游戏挂载时以 `flagModeDefault` 初始化标记模式开关。
- 新增依赖 `@deepseek-ai/schemastery`（host 侧，随 lib/index.js 打包，运行期零新增依赖）。

## T13 v0.5 client 数据层重构 + 全量验证

- spec：D6 客户端半边 + A12/A15。
- 改动：`ui.ts` 数据层改为「host API 权威 + localStorage 降级镜像」（挂载时 GET 合并、
  终局 PUT、清空 DELETE；所有 fetch 带超时）；设置卡片样式并入 `css.ts`。
- 验证：3084 实例重启 + `probe/a9-matrix.mjs`（A11 curl 实测 + A12 双上下文共享 +
  A13 设置卡片 + A14 降级路径）+ A7/A8 回归 + 截图 v05-*。

## 文档任务（随各 T 同步）

- `README.md`（T1 起占位，T6 后按实际行为定稿）、`CHANGELOG.md`、`AGENTS.md`（插件红线）、
  `docs/需求/BRD-业务需求说明书.md`、`docs/管理/RMP-风险管理.md`（T6 起记录实测问题）。
