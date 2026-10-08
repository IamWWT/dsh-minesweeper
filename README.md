# dsh-minesweeper

## 一句话定位

DSH（DeepSeek Harness）**右侧栏里的经典扫雷**：玩法与 UI 全在浏览器侧（零第三方运行时依赖，React 由宿主 `window.__ModuleLoader__` 注入），成绩权威源在 host 侧文件。

## 当前能力清单

**玩法**

- **棋盘**：CSS grid 渲染，未开格「浮起」/已开格「下沉」，数字 1–8 走 DSH 主题 token 语义色（明暗自适应，无硬编码色值）。
- **经典规则**：首点安全（首点及其 8 邻域必无雷）、洪水填充、和弦（数字格点按引爆周围）、右键/长按 ≥350ms 插旗。
- **标记模式**：HUD 开关「🚩 标记模式」，开启后左键点格即插旗/取消旗（触屏友好），棋盘带高亮描边 + 操作提示行；右键/长按在两种模式下都始终可插旗。
- **难度**：入门 9×9/10、进阶 16×16/40、专家 30×16/99 + 自定义（行列 5–30，雷数 ≤ 格数×0.5，非法输入即时报错）。
- **全屏模式**：「⛶ 全屏」按 cols/rows 比例缩放铺满窗口（不超视口，`Esc` 或按钮退出）。
- **HUD**：剩余雷/用时各带标签、🙂/😵/😎 表情重开；首点开格起计，**终局即停表**，封顶 999s。
- **终局**：输 = 标出全部雷（点中者高亮）+ 错旗打叉；赢 = 自动给剩余雷插旗并停表。
- **可点性即明暗**：未开格=凸起按键（pointer + 悬停高亮）、已开空白格=凹陷地板（不可点）、数字格=可点和弦（悬停描边）。

**成绩与设置**

- **成绩**：按难度存 `{ bestMs, plays, wins }`；权威源 = `$DSH_HOME/profiles/<profile>/dsh-minesweeper/stats.json`（`GET/PUT/DELETE /api/dsh-minesweeper/stats`，跨浏览器/跨重启保留），接口不可达时降级到 `localStorage`（键 `dsh-minesweeper/v1/<难度id>`）；「清空记录」二次确认。
- **设置卡片**（插件页配置区 `plugins.bundle.config`，key = 包名 `dsh-minesweeper`）：`flagModeDefault`「默认开启标记模式」。host 侧为 volatile 字段，配 `GET/PUT /api/dsh-minesweeper/settings`（`{value, revision, writable}`，409 乐观锁）+ `GET /settings/watch`（长轮询 ≤25s）；settings 服务缺失时只读降级，游戏与 `/stats` 不受影响。

**接入方式**

- 入口 = 右侧栏标签（`sidebarRightTabs.register`，guide order **41**）+ `sidebar.right.pane.tab`（keyed slot，key `dsh-minesweeper`）双注册；**标签不随页面自动打开**，需经右侧栏指南/标签点入。
- host 侧 `inject=[]`，`apply` 无操作（v0.1 空壳）；客户端产物为自包含 IIFE，无第二份 React。

## 安装

一律 **tgz 安装**（无 link 安装）：

```bash
cd dsh-plugins/dsh-minesweeper
pnpm check && npm pack        # 构建 + 门禁 + 测试 → 产出 dsh-minesweeper-0.5.3.tgz

cd ../../deepseek-harness
DSH_HOME=~/.dsh-dev pnpm dsh plugin --profile web add \
  /home/wwt/Downloads/aigc/proj/deepseek/dsh-plugins/dsh-minesweeper/dsh-minesweeper-0.5.3.tgz
```

- 装完核对 `~/.dsh-dev/profiles/web/node_modules/dsh-minesweeper/lib` 真实存在。
- **重打包必须升版本号**（同版本 pnpm 按 integrity 判「已最新」，不重解压 → 缺 `lib/` 启动即 `ERR_MODULE_NOT_FOUND`）。
- 重启 3082 **需用户同意**；`bash scripts/install-to-dsh.sh` 是一键封装（构建→冒烟→重装→验证，**不自动重启**）。
- 刷新 `http://127.0.0.1:3082` → 会话内展开右侧栏 → 点「🎮 扫雷」标签。windows-lite 用同一 tgz 流程，装完托盘退出后重开桌面应用。

## 构建与验证

`package.json` scripts：`build` / `build:notypecheck` / `check` / `typecheck` / `test` / `pack` / `verify:installed` / `install:dev`。

```bash
pnpm check        # = 构建（双端打包 + 产物门禁 + 双端 typecheck）+ 引擎单测 + 产物冒烟
pnpm typecheck    # 单独跑 host/client 类型检查
pnpm test         # 引擎单测（确定性 rng 回放）+ 产物冒烟
pnpm verify:installed   # 安装后验证（对 profile 内真实安装目录）
node test/runtime-probe.mjs   # 需 3084 临时实例：真实 harness 运行时注入探针
```

- 产物门禁：host `lib/index.js` 导出齐全；client `lib/client.js` 含 `__ModuleLoader__` + 插件 id + 关键插槽、无顶层 import/export、无第二份 `ReactCurrentOwner`、无 6 位 hex 硬编码色；版本断言**从 `package.json` 推导**（host `VERSION` / 客户端徽章 / `entry.ts` 的 `pluginExports.VERSION` 逐处核对）。
- 引擎 `src/shared/engine.ts` 为纯函数模块（host/client 共享），随机源走 `Board.rng`（`newBoard` 注入），保证确定性回放。

## 环境支持矩阵

| 环境 | 支持度 | 验证状态 |
|---|---|---|
| `ubuntu-4090`（源码树 + systemd 3082，验证走 3084 临时实例） | 全量 | `pnpm check` 全绿；3084 临时实例实测通过（布局/窄容器改动后的实机复测**未记录 → 未验证**） |
| `windows-lite`（官方桌面版 profile `desktop`，无 systemd） | 全量 | 同一 tgz 流程；**未验证** |

- 双环境一致性来自「零环境依赖」：不触碰 MySQL/SQLite、Python/venv、本地模型服务；`src/` 无 POSIX-only 调用（无 `spawn('bash')` / `/proc` / POSIX 信号 / 绝对 unix 路径假设），无 OS 分支。
- 主目录经 `os.homedir()` 解析（`$DSH_HOME` > `~/.dsh-dev`），成绩文件落 `<DSH_HOME>/profiles/<profile>/dsh-minesweeper/stats.json`。

## 文档索引

| 文件 | 一句话 |
|---|---|
| [`docs/需求/BRD-业务需求说明书.md`](`docs/需求/BRD-业务需求说明书.md`) | spec 001 的「需求→决策→实现→验收」映射 |
| [`docs/管理/RMP-风险管理.md`](`docs/管理/RMP-风险管理.md`) | 实际踩过的坑（现象→根因→修复→教训） |
| `docs/需求/` + `docs/管理/` 下同 id 文件 | SDD 三件套：决策 D1–D4 与验收 A1–A6 |
| `docs/需求/` + `docs/管理/` 下同 id 文件 | 布局/窄容器适配与键盘焦点优化规格 |
| `docs/screenshots/` | 临时实例（3084）验证截图 |
| [AGENTS.md](AGENTS.md) | 本插件工程纪律（红线、命令、版本同步规则） |
| [CHANGELOG.md](CHANGELOG.md) | 版本变更记录 |

## 版本号

**0.5.3**（`package.json.version` = tgz 文件名 `dsh-minesweeper-0.5.3.tgz` = 客户端徽章字面量）

## 附：仓库与共用目录

唯一代码仓库 = `IamWWT/dsh-plugins`（private monorepo），本插件目录 `dsh-plugins/dsh-minesweeper/`；分支 `main`（集成）/ `ubuntu`（agent 开发）/ `windows`（用户）。遵循 [DeepSeek 共用目录约定](../../dsh-agent-presets/docs/DIRECTORY-LAYOUT.md)，管理根统一写作 `<DEEPSEEK_ROOT>`（`.../deepseek/`）；`systemctl` 与 Bash 命令仅适用于 `ubuntu-4090`。
