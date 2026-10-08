# TROUBLESHOOTING — dsh-minesweeper

## 当前状态

- 文档性质：操作手册（排障）
- 对应版本：v0.5.3
- 状态：有效（各条为已发生的真实坑，处置办法仍适用；v0.5.2 起 tsc 路径统一收敛到 `scripts/paths.mjs`）
- 维护者：AI + 用户

> 记录实际发生过的坑（现象→根因→修复→教训）。未发生的不要猜。

## 1. client 产物 esbuild 报 `Expected ":" but found ","`

- **现象**：`scripts/build.mjs` 在 client 段报错，位置指向自定义表单区的字符串子节点（`"列 "`/`"雷 "`）。
- **根因**：`h("div", {...}, ...)` 的子项里把标签文字写成了裸字符串 + 紧跟 `)`，
  提前闭合了外层调用，esbuild 在后续 `,` 处报出误导性错误（实际是「三元分支被提前闭合」）。
- **修复**：文字包回 `h("label", null, "列 ")` 形式的完整子节点。
- **教训**：createElement 风格里，子节点要么是完整调用要么是纯文本节点；
  裸字符串后紧跟 `)` 几乎必是漏写了节点包裹。报错位置常与根因错位，回看调用栈的「上一级」。

## 2. 构建后 typecheck 报 `exit null`

- **现象**：`[typecheck] tsconfig.json 失败（exit null）`，无任何 tsc 输出。
- **根因**：build 脚本用 `loadTool("typescript/package.json")` 拿到的对象做 `String(pkg)`
  得到 `"[object Object]"`，spawn 该「路径」→ ENOENT → exit null。
- **修复**：tsc 路径改为显式候选列表，`existsSync` 探测（v0.5.2 起统一收敛到 `scripts/paths.mjs`
  的共享锚点链：env → 同级 `deepseek-harness/` → DSH profile 依赖层 + pnpm 虚拟 store）。
- **教训**：`createRequire()` 返回的是**模块值**不是路径；要拿路径就老老实实列路径候选。

## 3. 引擎「同种子不同布局」（确定性回放失败）

- **现象**：单测「同种子→同布局」失败；`revealAt` 后的盘面与期望不符。
- **根因**：`revealAt(b, i, rng=Math.random)` 带默认参数，调用时不传 rng 就绕过了 Board 上注入的种子 rng，
  直接用 `Math.random`，种子形同虚设。
- **修复**：删掉 `revealAt` 的 rng 参数，雷布用 `b.rng`（`newBoard` 时注入到 Board 上）。
- **教训**：「可注入的随机源」要么挂对象上、要么强制传参；带默认值的可选项是确定性测试的经典坑。

## 4. tsc 报 `TS2347 untyped function calls may not accept type arguments`

- **现象**：`R.useState<string>(...)` 报错（`R: any`）。
- **根因**：注入的 React 声明为 `any`，对 `any` 的调用不能接受类型实参。
- **修复**：给注入对象一个最小接口 `GameReact`（createElement/useState/useRef/useEffect 四件套），
  `const RR = R as GameReact` 后再调 hooks。
- **教训**：「any 省事」在泛型调用点上必炸；宿主注入对象至少给个最小形状接口。

## 5. 临时实例（3084）装插件时 pnpm `EROFS: read-only file system`

- **现象**：`dsh plugin --profile web add <src>` 在 pnpm 阶段报 EROFS（`~/.local/share/pnpm/store` 写失败）。
- **根因**：agent 沙箱默认只读工作区之外路径；pnpm 的全局 store 在 `$HOME` 下。
- **修复**：以提权（danger-full-access）重跑同一条命令即可；这是策略限制不是 bug。
- **教训**：`dsh plugin add` 内部会跑 pnpm，任何涉及 pnpm 全局 store 的操作都可能需要扩大沙箱。

## 6. 临时实例首启 onboarding 挡住右侧栏验证

- **现象**：headless 打开 3084 停在「选择工作区 / 添加 API Key」，右侧栏标签无从点起。
- **根因**：DSH 首启 onboarding（工作区+API key+模式）是**浏览器 localStorage** 态，
  新 profile 每次都要走一遍；且右侧栏展开按钮只出现在**会话头**里（需先有会话）。
  镜像主 home 的 settings.yaml/storages 只能补上「工作区列表」，补不了 onboarding 完成态。
- **缓解**：用持久化 playwright profile（`/tmp/msw-pw-profile`）把 onboarding 走一次后复用；
  或者直接在用户日常浏览器里对 3084 完成一次首启（约 30 秒）。
- **教训**：验证「右侧栏类」插件 UI 时，把「完成 DSH 首启」列为前置步骤写进脚本，不要假设它是空的。

## 7. 视觉工具 429（vision rate limit）

- **现象**：`vision_describe` 返回 `VISION_RATE_LIMITED`（ovh 后端限流，不支持并发）。
- **缓解**：同一轮内不要对视觉通道重试；先走 DOM/文本诊断，视觉复核顺延到下一轮。
- **教训**：截图取证与 DOM 断言双轨并行，任何一条通道限流都不阻塞诊断。

## 8. 成绩行显示裸 `<b>` 文本（"最佳 <b>120.4s</b> 这类陌生符号"）

- **现象**：成绩行渲染出字面量 `<b>…</b>`（v0.3 起用户看到"陌生符号/显示不正常"）。
- **根因**：成绩行用 HTML **字符串**（`"最佳 <b>" + x + "</b>"`）传给 `h("span", …)` 的 children。
  React 的 `createElement` **不解析 HTML 字符串**——字符串被当纯文本，`<b>` 标签原样显示。
- **修复**：改用真实元素 `h("b", null, x)` 作为 children（不要拼字符串）。
- **教训**：宿主注入的 React 是标准 `createElement`，任何"想加粗/换行"的需求都写成嵌套元素
  （`h("b", …)` / `h("br")`），**永远不要**把 `"<b>…</b>"` 当字符串传进 children。
  回归由 A8-F15（成绩行不得含字面 `<b>`）守门。

## 9. 终局后「用时」仍在走秒 / 「剩余雷」显示 0

- **现象**：一局结束后 HUD 的「⏱ 用时」还在增加；赢棋时「💣 剩余雷」显示 0。
- **根因**：①v0.3 的计时器只在**开始**时启动，终局未调用停止——秒数继续累积（经典规则应终局定格）；
  ②「剩余雷 = 雷数 − 已插旗数」，**赢棋时引擎自动给全部剩余雷插旗**，旗数==雷数，故剩余雷自然归 0
  ——这是正确行为，非 bug（v0.4 加了「💣 剩余雷」标签消除歧义）。
- **修复**：`onEnd()` 结算前先 `stopTimer()` 定格 `elapsed`（`startRef` 置空），HUD 此后不再走秒。
- **教训**：计时类 UI 的"生命周期结束点"（终局/重开/切难度）必须显式停表，不能只"开始"不管"停止"。
  A8-F16（终局后两次读数相等）守门。
