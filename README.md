# dsh-minesweeper

DSH（DeepSeek Harness）右侧栏里的经典扫雷。纯客户端实现：零运行时依赖、零网络请求、零后端状态——React 由宿主 `window.__ModuleLoader__` 注入，成绩只存浏览器 `localStorage`。

## 功能

- **棋盘**：CSS grid 渲染，未开格「浮起」/已开格「下沉」，数字 1–8 走 DSH 主题 token 语义色（明暗主题自动适配，无硬编码色值）。
- **经典规则**：首点安全（首点及其 8 邻域必无雷）、洪水填充、和弦（数字格点按引爆周围）、右键/长按 ≥350ms 插旗。
- **标记模式**（v0.2）：HUD 开关「🚩 标记模式」——开启后左键点格即插旗/取消旗（触屏友好），右键/长按在两种模式下都始终可插旗；棋盘带高亮描边提示模式开启，附操作提示行。
- **全屏模式**（v0.3）：「⛶ 全屏」把棋盘放大铺满整个窗口（按 cols/rows 比例缩放，不超视口；`Esc` 或按钮退出），小屏/投屏看盘更舒服。
- **可点性即明暗**（v0.3）：未开格=凸起按键（`pointer` 光标+悬停高亮）、已开空白格=凹陷地板（不可点，`default` 光标）、数字格=可点和弦（悬停品牌色描边）——"能不能点"一眼可辨。明暗层级用主题无关的中性光影（DSH 浅色 token 阴影透明度过低、白底不可见，v0.3 起浅色靠暗影、深色靠顶缘高亮）。
- **HUD 自解释**（v0.3）：两个数码表分别带「💣 剩余雷」「⏱ 用时(秒)」标签。
- **成绩语义**（v0.3）：「最佳 X.Xs · 🏆 N胜 M负 · 共N局」；无对局时显示「暂无记录」。
- **难度**：入门 9×9/10、进阶 16×16/40、专家 30×16/99 + 自定义（行/列 5–30，雷数 ≤ 格数×0.5，非法输入即时报错）。
- **终局停表**（v0.4）：经典规则——输/赢立即定格计时器，不再走秒；成绩行用真实 `<b>` 元素渲染（v0.3 曾把 HTML 字符串当文本，显示裸 `<b>`，v0.4 修复）。
- **HUD**：剩余雷数（雷数−旗数，可为负）、计时（首点开格起计，**终局即停**，封顶 999s）、🙂/😵/😎 表情重开按钮。
- **终局**：输=标出全部雷（点中者高亮）+ 错旗打叉；赢=自动给剩余雷插旗并停表（此时「剩余雷」= 雷数−旗数 = 0，属正确行为）。
- **成绩**：按难度存 `{ bestMs, plays, wins }`（`localStorage` 键 `dsh-minesweeper/v1/<难度id>`）；「清空记录」二次确认。

## 安装（dev 环境 3082）

```bash
cd dsh-plugins/dsh-minesweeper
bash scripts/install-to-dsh.sh          # 构建→冒烟→link 安装→验证（不重启服务）
systemctl --user restart dsh-dev-web    # 需要时手动重启 3082（需自行确认）
```

刷新 `http://127.0.0.1:3082` → 会话内展开右侧栏（会话头部的面板开关）→ 找到「🎮 扫雷」标签。

> 标签**不会**随页面自动打开（设计决策 D2）：需要时经右侧栏指南/标签点入。

## 开发

```bash
node scripts/build.mjs          # 双端打包 + 产物门禁 + 双端 typecheck
node test/engine-test.mjs       # 引擎单测（40 项，确定性 rng 回放）
node test/smoke-test.mjs        # 产物冒烟（host 导出 / client 注册面 / 无第二份 React / 无硬编码色）
node test/runtime-probe.mjs     # （需 3084 临时实例）真实 harness 运行时注入探针
```

- 引擎 `src/shared/engine.ts` 为纯函数模块（Host/Client 共享）：首点安全雷布、`revealAt` 洪水填充、`chord`、`toggleFlag`、胜负判定；`rng` 挂在 Board 上（`b.rng`），保证确定性回放。
- 客户端 `src/client/`：`entry.ts`（`__ModuleLoader__` 注册 + `sidebarRightTabs`/`sidebar.right.pane.tab` 双注册，guide order=41）、`ui.ts`（R.createElement 写法）、`css.ts`（全部 `--dsw-alias-*`/`--dsw-elevation-*` token）。
- 交互细节：指针 down 起 350ms 长按计时（位移 >12px 或离格即取消），抬手未触发=开格/和弦；触屏与桌面右键均支持。

## 文档

- `docs/specs/001-minesweeper/` — SDD 规格/计划/任务（含决策 D1–D4 与验收 A1–A6）
- `docs/REQUIREMENTS.md` — 需求→决策→实现→验收映射
- `docs/TROUBLESHOOTING.md` — 现象→根因→修复
- `docs/screenshots/` — 临时实例（3084）验证截图

## 版本

`0.5.2`（v0.5.2：跨平台主目录单源 `src/shared/dsh-home.ts`（`os.homedir()` 替代 `process.env.HOME`，修 Windows 上 `.dsh-dev` 变相对路径导致扫不到会话）+ 设置卡片迁到插件页配置区 `plugins.bundle.config`（key = 包名，旧槽 `settings.plugin.item` 已随上游 0.1.7-rc.1 退役）+ 构建脚本跨平台（tsc 改走共享锚点链、不再假设插件自带 `node_modules`）；v0.5.1：0.1.7 原生设置面（volatile 字段 + 插件自有 REST API，替代已移除的 settingsScope 服务）；v0.5：成绩迁 host 侧文件权威源 + localStorage 降级镜像、设置卡片「默认开启标记模式」；v0.4 终局停表 + 成绩行裸 `<b>` 修复；v0.3 全屏 + 可点性明暗重做 + HUD 标签 + 成绩语义；v0.2 标记模式/提示行；v0.1 经典玩法基线）。
v0.6 候选：多难度独立计时对比、导出/导入成绩、在线跨机同步。

## Windows / Ubuntu 本地构建

两端都先运行 `npm install`，再运行 `npm run check`。构建工具和 Node 类型由本包声明，类型检查通过当前 Node 启动，文件导入使用文件 URL，支持 Windows 盘符。运行时仍由 DSH 提供共享服务。

<!-- deepseek-shared-layout -->

## Windows / Ubuntu 共用目录

本项目遵循 [DeepSeek 共用目录约定](../dsh-agent-presets/docs/DIRECTORY-LAYOUT.md)。管理根统一写作 `<DEEPSEEK_ROOT>`（`.../deepseek/`），历史部署记录不能视为当前机器状态；Bash/systemd 命令只适用于对应环境，配置文件中的路径须在本机解析。
