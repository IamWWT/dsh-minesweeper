# Spec 001 — dsh-minesweeper 扫雷插件

## 当前状态

- 文档性质：规格（决策记录 + 范围 + 验收，含 §8 的 v0.5 增补）
- 对应版本：v0.5.3
- 状态：有效（D1–D7 已确认；文档抬头「版本：v0.1.0」为成文版本，后续增补见 §8）
- 维护者：AI + 用户

- 状态：**已确认**（v0.5 增补 2026-09-14：D6/D7 + A11–A15，见 §8）
- 版本：v0.1.0
- 日期：2026-09-14
- 确认记录：2026-09-14 用户确认 D1=右侧栏标签页、D2=不自动打开、D3=三档+自定义；
  D4（成绩存 localStorage）未单独提问，按推荐项 a 处理并记入假设表（v0.2 可升级为 host 侧）。

## 1. 背景与目标

用户原话：「开发 dsh-minesweeper 扫雷插件」。

目标：在 DSH Web（3082 工作区）内提供经典扫雷游戏，作为右侧栏标签页随时可玩；
纯客户端实现，零新增运行时依赖（React 由宿主注入），不引入任何网络请求与后端状态。

## 2. 范围

### 吸收/复用（不重造轮子）

- DSH 右侧栏标签机制：`ctx.sidebarRightTabs.register` + `sidebar.right.pane.tab`（keyed slot）
  —— 与 dsh-personal-workbench / dsh-trading-workbench / dsh-report-studio 同款注册路径；
- DSH 主题 token（`--dsw-alias-*` / `--dsw-elevation-*`），明暗主题自动适配；
- Cordis 插件协议（`name`/`inject`/`apply` + `dsh.bundle` + `dsh.client` 声明）。

### 自研范围

- 扫雷引擎（纯函数核心，`src/shared/engine.ts`，Host/Client 可共享、单测直接跑）：
  棋盘生成、首点安全、洪水填充、旗标、和弦（chord）、胜负判定；
- 客户端 UI（`src/client/`）：棋盘渲染 + 控制栏（难度/剩余雷数/计时/重开）+ 最佳成绩区；
- 最佳成绩持久化：浏览器 `localStorage`（按难度维度：`bestTimeMs` / 局数 / 胜局）。

### 非目标（v0.1 明确不做）

- 多人在线 / 人机对战 / AI 解题器；
- 音效、动画特效（仅保留 CSS 轻量过渡）；
- 跨用户排行榜（v0.5 起改为「同机跨浏览器/上下文共享」，见 D6；多用户在线榜单仍不做）；
- 移动端专属布局（仅做基础触控兼容：点按开格、长按插旗）。
- ~~Host 侧 API / 路由~~（v0.5 已实现：`/api/dsh-minesweeper/*`，见 D6；v0.1–v0.4 期间 host 为空壳）。

## 3. 形态与交互

### 入口

- 右侧栏标签「🎮 扫雷」：`sidebarRightTabs.register({ id: "dsh-minesweeper", kind: "minesweeper", priority: "extension", guide: [{ order: 41, ... }] })`
  （guide order 41 已核对，避开 personal-workbench 21 / troubleshoot 22 / trading 23 / scheduled-send 30 / sidebar-hub 30–35 / report-studio 32）；
- **页面加载不自动打开**（避免打扰主对话面），用户经侧栏「+」→ 指南页条目点入；
  是否改为自动打开见 D2。

> 注（2026-10-13）：上方占用表为当时核对结果；现行 3082 profile 实装清单中已无 `dsh-troubleshoot-workbench`（`troubleshoot`）与 `dsh-personal-workbench`。
> guide order 41 仍为本插件占用（`src/client/entry.ts`）。

### 棋盘与规则（经典 Windows 扫雷规则）

- 难度：入门 9×9/10、进阶 16×16/40、专家 30×16/99，外加「自定义」
  （行 5–30、列 5–30、雷数 ≤ 格数×0.5，非法输入即时报错文案）；
- **首点安全**：首次开格后才按「该点击点 + 其八邻域必非雷」约束生成雷；
- 左键开格；空白格洪水填充自动展开；
- 右键 / 长按（≥350ms）插旗 ↔ 取消旗；
- **标记模式**（v0.2，D5）：HUD 开关。开启后左键点未开格 = 插旗/取消旗（触屏友好），
  已开格点按仍走和弦；右键与长按在任何模式下都保持插旗语义；开启时棋盘容器加品牌色描边 +
  操作提示行文案切换。模式为 UI 偏好：会话内保持（含重开），刷新页面重置为关，不写 localStorage。
- **明暗层级 / 可点性**（v0.2→v0.3，用户两轮反馈"阴影/不可点部分没体现"）：
  浅色主题下开/未开格背景色完全相同（对比 1.00），且 DSH 浅色 token 阴影透明度仅 0.05–0.12，
  纯 token 白底上不可见——故 v0.3 改用**主题无关的中性 rgba 光影**承载凹凸：
  - 未开格 = 凸起按键：外投影 + 顶缘高光 + 底缘暗缘，`cursor:pointer`，悬停品牌色描边；
  - 已开空白格 = 凹陷地板（不可点）：`--msw-floor` 主题 tint（浅加暗/深加亮）+ 顶部内阴影 + 描边，`cursor:default`；
  - 数字格 = 可点和弦：微凸起 + 悬停品牌色描边，`cursor:pointer`。
  语义色（数字/品牌/状态）仍走 `--dsw-alias-*` token，明暗层级用中性 rgba（禁 6 位 hex）。
- **全屏模式**（v0.3）：HUD「⛶ 全屏」切换 `position:fixed` 覆盖层（`msw-fs`，`z-index` 最高层），
  棋盘按 `cols/rows` 比例放大（`--msw-ar`，wrap 定宽避免循环尺寸塌缩）、不超视口，`Esc` 或按钮退出；
  全屏内可正常对局。
- **HUD 自解释**（v0.3）：两个数码表分别带「💣 剩余雷」「⏱ 用时(秒)」标签；
  成绩区显示「最佳 X.Xs · 🏆 N胜 M负 · 共N局」，无对局时显示「暂无记录」
  （v0.2 的 `胜负 W/P` 写法易被误读，v0.3 改为胜/负/总局数三分量）。
- 和弦：点已翻开数字格且其周围旗数 == 数字时，引爆周围未标旗格；
  旗数正确判定错（误标旗）按经典规则引爆（可能直接输，不加保护）；
- 数字配色 1–8 走经典语义色（blue/green/red/navy/maroon/teal/black/gray 的 DSH token 近似，
  明暗主题下用 `--dsw-alias-*` 语义 token 映射，不写死 hex）；
- 控制栏：剩余雷数（雷数−旗数，可为负，7 段数字风格）、计时器（首点起计，绝对秒数显示，
  **终局即停**：输/赢时定格并停止计时——经典规则；v0.4 修复了此前终局后仍继续计时的实现偏差）、
  重开按钮（🙂/😵/😎 表情按钮，随状态变化）；
- 输：翻开雷 → 标出全部雷（点中的雷标红），其余雷正常显示，误旗打叉；
- 赢：全部非雷格翻开 → 自动给剩余雷插旗、停表、刷新最佳成绩。

### 最佳成绩（D4 已按假设处理：localStorage）

> 注（2026-10-13）：当前实现已变更为下文（v0.5 起成绩权威源在 host 侧文件，localStorage 仅降级镜像；
> 键为按难度分键 `dsh-minesweeper/v1/<难度id>`），见 `../../README.md`「成绩与设置」与
> `BRD-业务需求说明书.md` R5/假设 D；本段保留 spec 成文时的占位写法。

- 键：`dsh-minesweeper:stats.v1`，按难度存 `{ bestTimeMs, plays, wins }`；
- 界面展示当前难度最佳时间 + 总胜局；「清空记录」按钮二次确认（confirm()）。

## 4. 验收标准

> 验证环境：临时实例（独立 `DSH_HOME=~/.dsh-ms-test` + 端口 3084）；
> 通过后再经用户同意 link 安装到 3082 复验。

| # | 标准 | 验证方式 |
|---|---|---|
| A1 | `pnpm check` 全绿（esbuild 双端产物门禁 + Host/Client 双 tsconfig typecheck + 冒烟） | 临时目录跑 `pnpm check` |
| A2 | 引擎单测通过：首点安全（1000 次随机采样断言首点邻域无雷）、洪水填充、和弦、旗不变量、胜负判定、自定义网格边界 | `pnpm test` |
| A3 | 临时实例打开「扫雷」标签：可完整对局（开格/插旗/和弦/输/赢/切难度/自定义/重开） | 浏览器手测 + 截图 |
| A4 | 胜利后最佳成绩更新；刷新页面成绩仍在；清空后归零 | 浏览器手测 |
| A5 | 明/暗两套主题下无硬编码色块、无对比度崩坏 | 切主题目测 |
| A6 | `dsh plugin --profile web rm dsh-minesweeper` 后标签消失、侧栏无残留报错 | 临时实例卸载验证 |
| A7 | 标记模式：开关切换后，左键在未开格上插旗/取消旗；已开格左键仍和弦；右键/长按在两模式下均插旗；重开不丢模式 | 临时实例脚本化交互矩阵（3084 无头浏览器） |

## 5. 迁移与运维

| 阶段 | 内容 | 出口条件 |
|---|---|---|
| S1 | 本 spec 用户确认（Clarify 回填） | 用户点头 |
| S2 | 脚手架 + 引擎 + 测试（engine 全绿） | `pnpm test` 绿 |
| S3 | 客户端 UI + 标签注册 | `pnpm check` 绿 |
| S4 | 临时实例 3084 安装验证（A3–A6） | 手测通过 |
| S5 | 经用户同意：link 安装 3082 + 重启（`systemctl --user restart dsh-dev-web`） | 3082 复验 |

- 回滚：`dsh-dev plugin --profile web rm dsh-minesweeper`（开发期 link 安装）；
- 不触碰 3082：S1–S4 全程只在临时实例进行（红线：未发布改动禁止上 3082）。

> 注（2026-10-13）：§4 尾注与 §5 S5/回滚中的「link 安装」为当时做法；现行安装唯一方式为 **tgz**
> （`pnpm check && npm pack` → `DSH_HOME=~/.dsh-dev pnpm dsh plugin --profile web add <tgz>`，见
> `../../README.md`「安装」）。重启方式不变（`systemctl --user restart dsh-dev-web`，需用户同意）。

## 6. 决策点（已确认）

| # | 决策点 | 候选 | 结论（2026-09-14 用户确认） |
|---|---|---|---|
| D1 | 形态 | a) 右侧栏标签页 b) 全屏 overlay（同 personal-workbench 双入口） c) 会话内嵌游戏 | **✅ a：右侧栏标签页** |
| D2 | 页面加载自动打开标签？ | a) 否，经指南页手动打开（推荐） b) 是，随页面自动开一个标签 | **✅ a：不自动打开** |
| D3 | v0.1 难度范围 | a) 三档经典 + 自定义（推荐） b) 仅三档经典 | **✅ a：三档 + 自定义** |
| D4 | 成绩存储 | a) localStorage（零后端，推荐） b) host 路由写 `$DSH_HOME` 文件（需加路由+测试） | **假设：a（localStorage）**——未单独提问的低危项，记录于此；v0.2 可平滑升级 host 侧 |
| D5 | 插旗发现性（v0.2，用户反馈「不知道要右键/长按」） | a) 仅文档 b) HUD 加「标记模式」开关 + 操作提示行（推荐） | **✅ b：开关 + 提示行；标记模式为会话内偏好，不落盘** |

## 7. 依赖与风险

- 依赖客户端 API：`slots` / `sidebarRightTabs`（0.1.x pre-stable，已核对 personal-workbench 等 4 个在跑插件的同款用法）；
  风险：框架升级改 API → 对策：面尽量小（只 `register` + slot body + guide），升级 harness 后跑 `pnpm check` + 冒烟回归；
- 触屏长按与滚动手势冲突 → 350ms 阈值 + 移动中取消判定；桌面端另有右键，不受影响；
- 主题 token 覆盖度：个别语义色（如 8 种数字色）在 `--dsw-alias-*` 中无精确对应时，
  用 `color-mix()` 或最接近的 label 系 token 近似，禁止裸 hex（红线 7）——具体 token 映射在实现时落表；
- React 由宿主 `window.__ModuleLoader__` 的 require 提供，禁止在 bundle 里打进第二份 React。

## 8. v0.5 增补（2026-09-14，用户确认"可以进行了"）

### 决策（v0.5）

| # | 决策点 | 结论 |
|---|---|---|
| D6 | 成绩持久化升级 | **host 侧文件为权威源**：`$DSH_HOME/profiles/<profile>/dsh-minesweeper/stats.json`，经宿主 HTTP 路由 `/api/dsh-minesweeper/*` 读写（`inject += ["webServer","settings"]`，`ctx.webServer.register` 注册，参照 dsh-scheduled-send 模式）；浏览器 `localStorage` 降级为**离线镜像/降级源**（API 不可达时继续可玩，恢复后以 host 为准）。效果：同一机器上成绩跨浏览器/跨 profile/跨重启保留（原"跨会话排行榜"诉求的实际解法）。 |
| D7 | 设置卡片 | 设置页 `settings.plugin.item`（key = 命名空间 `dsh-minesweeper`）小卡片：唯一项「默认开启标记模式」（boolean，schema 走 `@deepseek-ai/schemastery`，命名空间经 `ctx.settings.register` 注册，参照 dsh-global-auth / dsh-sidebar-hub）。游戏挂载时读取该设置决定标记模式初始态；HUD 内开关仍是会话内开关，二者互不覆盖。 |

> 注（2026-10-13）：D7 的落点当前实现已变更——设置卡片现注册在**插件页配置区 `plugins.bundle.config`**
> （keyed，key = **包名** `dsh-minesweeper`），数据面为插件自有 REST `/api/dsh-minesweeper/settings*`；
> `settings.plugin.item` 槽位与 `settingsScope` 服务已随上游 0.1.7 退役（注册到退役槽位不报错但永不渲染）。
> 见 `../../README.md`「成绩与设置」、`../../CHANGELOG.md` [0.5.1]/[0.5.2]、`../../AGENTS.md` 红线 6。

### 假设表（v0.5，未单独提问的低危项，记录在案）

- H1：状态文件位置 `$DSH_HOME/profiles/<profile>/dsh-minesweeper/stats.json`（与 dsh-scheduled-send 的
  `<profile>/<插件名>/` 约定一致）；写盘原子化（tmp + rename），损坏文件按空表处理并保留 `.corrupt` 备份。
- H2：同步策略 = host 权威、客户端每次对局结束 `PUT` 该难度**完整记录**（`{bestMs, plays, wins}`，
  host 按难度键整条替换）；单用户单机场景下最后写入者胜，不做锁与增量合并。
- H3：`localStorage` 仅作 API 不可达时的降级镜像；API 恢复后以 host 覆盖本地视图（不反向上传，
  避免把过期数据刷回 host 文件）。
- H4：设置卡片为**自定义 client 卡片**（一个开关），不做多字段表单；`flagModeDefault` 变更经
  `settingsScope` binder 热生效（下一局/刷新后生效，不打断进行中的对局）。

### 验收（v0.5）

| # | 标准 | 验证方式 |
|---|---|---|
| A11 | 路由 `GET/PUT/DELETE /api/dsh-minesweeper/stats` 行为正确（含 404 语义、坏 JSON 容错、并发写不损坏文件） | host 侧单测（假 req/res）+ 3084 curl 实测 |
| A12 | **跨浏览器上下文共享**：上下文 A 打完一局 → 全新上下文 B（无 localStorage）打开扫雷能看到 A 的成绩 | 3084 双上下文探针（A9） |
| A13 | 设置卡片：设置页出现「扫雷」卡片，切换「默认开启标记模式」→ 重开游戏初始开关为开；卡片值跨重启保留 | 3084 探针 + 截图 |
| A14 | API 不可达时游戏仍可完整对局并记成绩（降级镜像）；清空记录同时清 host 文件与本地镜像 | 探针（断 API 路径）+ host 文件断言 |
| A15 | 回归：引擎 40/40、冒烟、A7/A8 矩阵全绿（v0.2–v0.4 行为不变） | 既有矩阵 |
