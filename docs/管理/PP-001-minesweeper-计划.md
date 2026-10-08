# Plan — dsh-minesweeper 扫雷插件（001）

## 当前状态

- 文档性质：历史记录（v0.1 技术规划）
- 对应版本：v0.5.3
- 状态：历史记录，结论按当时口径（host 曾为空壳 `inject=[]`；v0.5 起 host 持有 `webServer`/`settings` 与 `/api/dsh-minesweeper/*` 路由，成绩权威源移到 host 侧文件）
- 维护者：AI + 用户

> 对应 spec：`spec.md`（已确认 D1–D4）。本文件是技术规划，任务拆解见 `tasks.md`。

## 1. 技术架构

```
dsh-minesweeper/
├── cordis.patch.yml            # bundle insert：id=minesweeper（无 config 键——v0.1 无可配项）
├── src/
│   ├── index.ts                # Host 入口（占位）：name/inject=[]/VERSION/apply 空操作
│   ├── shared/
│   │   └── engine.ts           # 游戏引擎（纯函数，零 DOM/零依赖；Host/Client/测试共用）
│   │   └── difficulties.ts     # 三档预设 + 自定义校验
│   └── client/
│       ├── entry.ts            # window.__ModuleLoader__ 注册：sidebarRightTabs + pane.tab 槽
│       ├── ui.ts               # React（宿主注入）createElement 风格组件：HUD/棋盘/表单/成绩
│       └── css.ts              # 全部走 --dsw-* 主题 token 的样式串
├── test/
│   ├── engine-test.mjs         # 引擎单测（对 esbuild 打包的 test/dist/engine.mjs 断言）
│   └── smoke-test.mjs          # 产物门禁：host 导出 + client 注册面 + 布局卫生
└── scripts/
    ├── build.mjs               # esbuild 双端 + 产物门禁（参考 dsh-scheduled-send）
    ├── typecheck.mjs           # 双 tsconfig --noEmit
    ├── install-to-dsh.sh       # 构建→冒烟→link 重装→验证（不自动重启 3082）
    └── verify-installed.mjs    # 安装后布局断言
```

### Host / Client 边界

| 侧 | 职责 | 依赖 |
|---|---|---|
| Host（`src/index.ts`） | 仅插件身份：`name="minesweeper"`、`inject=[]`、`VERSION="0.1.0"`、`apply()` 空操作。无路由、无状态目录（v0.1 无任何可调配置键 → cordis.patch.yml 不声明任何 config，遵守「只声明实际消费的键」） | 无（纯 TS，零 npm 依赖） |
| Client（`src/client/`） | 全部游戏逻辑与 UI：`sidebarRightTabs.register`（id=`dsh-minesweeper`，kind=`minesweeper`，priority=extension，guide order=41）+ `sidebar.right.pane.tab`（key=`dsh-minesweeper`）铺 GameApp；不自动 openTab（D2） | React/ReactDOM 由宿主 `factory(require)` 注入，bundle 里零 React 依赖 |
| 共享（`src/shared/`） | 引擎纯函数 + 难度预设，同时被 client bundle 与 node 测试引用 | 无 |

### 数据通道

- **无网络请求**：游戏状态 100% 浏览器内存（React state）；
- 成绩持久化：`localStorage["dsh-minesweeper/v1/<diffId>"] = { bestMs, plays, wins }`（D4 假设）；
- 宿主侧零状态 → 插件卸载即无痕。

## 2. 关键选型与理由

| 决策 | 选择 | 理由 |
|---|---|---|
| 引擎位置 | `src/shared/` 纯函数模块 | 可单测（node）、可被 client bundle 内联；不引入 Host 路由 |
| 首点安全 | 首次点击后按「点击格+八邻域排除」布雷 | 现代扫雷标准规则；雷数可行性在 `newBoard` 时校验（`rows*cols - mines ≥ min(9, rows*cols)`） |
| React 使用方式 | 宿主注入 `require("react")`，组件一律 `R.createElement`（不用 JSX、不打第二份 React） | 与 personal-workbench 同款；规避 bundle 内 React 重复实例 |
| 主题 | 仅 `--dsw-alias-*` / `--dsw-elevation-*` token；8 个数字色映射 8 个现成 token（brand/success/error/business/warn/link/label-primary/warn-secondary） | 红线：禁止写死色值；明暗主题自动适配 |
| 触屏 | 长按 ≥350ms 插旗（pointer 事件，位移>10px 取消） | 无右键设备的兜底 |
| 无 JSX | `.ts` + `createElement` 显式调用 | 与 personal-workbench 一致，tsconfig 无需 jsx 配置 |
| 类型环境 | client 自带 `react-shim.d.ts`（最小 React 类型面） | 不依赖 `@types/react` 安装，类型检查自包含 |

## 3. 状态模型

- `Board { rows, cols, mines, state: new|playing|won|lost, cells[], lostAt, started }` 全程内存；
- 引擎函数原地变更 board（`revealAt/chord/toggleFlag`），UI 用 `tick` 计数触发重渲染（480 格量级无压力）；
- 计时：`playing` 起 `setInterval(1s)`，封顶 999s；重开清零；
- `state=won` 时自动给剩余雷插旗（经典行为）。

## 4. 风险与对策

| 风险 | 对策 |
|---|---|
| `sidebarRightTabs` API 0.1.x 仍可能演进 | 使用面收敛到 `register` + slot body 两处；升级 harness 后跑 `pnpm check` + 临时实例冒烟 |
| 8 数字色的 token 近似与经典色不完全一致 | 可接受（语义可辨即可）；映射表写在 css.ts 注释里 |
| 长按与滚动/拖拽手势冲突 | 350ms 阈值 + 位移取消 + `touch-action: manipulation` 禁双击缩放 |
| 临时实例验证时 3082 与 3084 并存 | 独立 DSH_HOME（`~/.dsh-minesweeper-test`）+ 独立端口 3084，全程不碰 3082 |
| 同版本号 tgz 缓存坑 | 开发期一律源码 link 安装；tgz 仅稳定版且必升版本号 |
