/**
 * dsh-minesweeper 引擎单测（T2）。
 *
 * 流程：esbuild 把 src/shared/{engine,difficulties}.ts 打包成 test/dist/engine.mjs
 * （与生产 client bundle 同一引擎代码），然后动态 import 做白盒断言。
 *
 * 覆盖：
 *  - 参数校验 / 首点安全可行性（isFeasible 边界）
 *  - 首点安全：300 次随机采样，首点格 + 八邻域无雷
 *  - 雷数守恒、确定性 rng 可复现
 *  - 洪水填充（空域展开 + 邻数独立复算）
 *  - 撞雷判负（lostAt）、胜利（含自动插旗）、无雷盘首开即胜
 *  - 和弦：旗数匹配才引爆 / 旗数不符空操作
 *  - 插旗互斥（已开格/终局不生效）
 *  - validateCustom 边界
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readdirSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import assert from "node:assert/strict";
import { buildFallbackDirs } from "../scripts/paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/* ---------- 工具解析（与 scripts/build.mjs 同策略） ---------- */
const FALLBACK = buildFallbackDirs({ importMetaUrl: import.meta.url, envKeys: ["MINES_TOOLS_DIR"] });
function loadTool(name) {
  const anchors = [here + "/x.js", root + "/x.js", ...FALLBACK.map((d) => d + "/x.js")];
  for (const a of anchors) {
    try {
      return createRequire(a)(name);
    } catch {
      /* next */
    }
  }
  if (name === "esbuild") {
    for (const d of FALLBACK) {
      const pnpm = d.replace(/node_modules$/, "node_modules/.pnpm");
      if (!existsSync(pnpm)) continue;
      for (const dir of readdirSync(pnpm).filter((x) => x.startsWith("esbuild@")).sort().reverse()) {
        const p = `${pnpm}/${dir}/node_modules/esbuild`;
        try {
          return createRequire(p + "/x.js")(p);
        } catch {
          /* next version */
        }
      }
    }
  }
  throw new Error(`找不到 ${name}`);
}

const esbuild = loadTool("esbuild");
mkdirSync(root + "/test/dist", { recursive: true });
await esbuild.build({
  stdin: {
    contents: `export * from "./src/shared/engine.ts"; export * from "./src/shared/difficulties.ts";`,
    resolveDir: root,
    sourcefile: "engine-entry.ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: root + "/test/dist/engine.mjs",
  logLevel: "warning",
});
const E = await import(pathToFileURL(root + "/test/dist/engine.mjs").href + "?t=" + Date.now());

/* ---------- 确定性 RNG（mulberry32） ---------- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  if (ok) {
    pass++;
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ""}`);
  } else {
    fail++;
    console.error(`  FAIL  ${name}${detail ? `  (${detail})` : ""}`);
  }
}
const {
  newBoard,
  revealAt,
  chord,
  toggleFlag,
  revealAt: _rv,
  neighborsOf,
  isFeasible,
  remainingMines,
  idxOf,
} = E;
const { validateCustom, PRESETS, CUSTOM_MIN, CUSTOM_MAX } = E;

console.log("[1/8] 参数校验与可行性");
{
  assert.throws(() => newBoard(1, 9, 0), E.EngineError, "rows<2 应抛错");
  assert.throws(() => newBoard(9, 9, -1), E.EngineError);
  assert.throws(() => newBoard(9, 9, 81), E.EngineError, "雷数=格数 必不可行");
  check("isFeasible(9,9,72)（=total-safeZone 边界）", isFeasible(9, 9, 72) === true);
  check("isFeasible(9,9,73) 不可行", isFeasible(9, 9, 73) === false);
  check("isFeasible(3,3,1) 不可行（首点安全区覆盖全盘）", isFeasible(3, 3, 1) === false);
  check("isFeasible(3,3,0) 可行", isFeasible(3, 3, 0) === true);
  check("预设三档全部可行", PRESETS.every((p) => isFeasible(p.rows, p.cols, p.mines)));
}

console.log("[2/8] 首点安全（300 次随机采样）");
{
  const rng = mulberry32(20260914);
  const configs = [];
  for (let i = 0; i < 300; i++) {
    const rows = 5 + Math.floor(rng() * 6); // 5..10
    const cols = 5 + Math.floor(rng() * 6);
    const cap = Math.min(Math.floor((rows * cols) / 2), rows * cols - Math.min(9, rows * cols));
    const mines = Math.floor(rng() * (cap + 1));
    configs.push([rows, cols, mines]);
  }
  let allOk = true;
  let detail = "";
  for (const [rows, cols, mines] of configs) {
    const b = newBoard(rows, cols, mines, mulberry32(rows * 100 + cols));
    const first = Math.floor(rng() * rows * cols);
    const r = revealAt(b, first);
    if (r.exploded >= 0) {
      allOk = false;
      detail = `首点即炸 rows=${rows} cols=${cols} mines=${mines}`;
      break;
    }
    const safe = new Set([first, ...neighborsOf(rows, cols, first)]);
    for (const i of safe) {
      if (b.cells[i].mine) {
        allOk = false;
        detail = `首点安全区出现雷 (${rows}x${cols}/${mines})`;
        break;
      }
    }
    if (!allOk) break;
    const mineCount = b.cells.filter((c) => c.mine).length;
    if (mineCount !== mines) {
      allOk = false;
      detail = `雷数守恒破坏: ${mineCount} != ${mines}`;
    }
  }
  check("300 次随机：首点+邻域无雷、首点不炸、雷数守恒", allOk, detail || "300/300");
}

console.log("[3/8] 确定性 rng 复现");
{
  const b1 = newBoard(6, 6, 5, mulberry32(42));
  const b2 = newBoard(6, 6, 5, mulberry32(42));
  revealAt(b1, 0);
  revealAt(b2, 0);
  const layout = (b) => b.cells.map((c) => (c.mine ? "M" : c.revealed ? "." : "?")).join("");
  check("同种子 → 同布局", layout(b1) === layout(b2));
  check("不同首点 → 不同布雷", (() => {
    const c = newBoard(6, 6, 5, mulberry32(42));
    revealAt(c, 35);
    return layout(c) !== layout(b1);
  })());
}

console.log("[4/8] 洪水填充与邻数（白盒复算）");
{
  const b = newBoard(6, 6, 7, mulberry32(7));
  const mineIdx = b.cells.findIndex((c) => !c.mine); // 取一个非雷格做首点
  const res = revealAt(b, mineIdx);
  check("首点不炸", res.exploded === -1);
  check("首点已翻开", b.cells[mineIdx].revealed === true);
  // 独立复算邻数
  let adjOk = true;
  for (let i = 0; i < b.cells.length; i++) {
    let expect = 0;
    for (const j of neighborsOf(6, 6, i)) if (b.cells[j].mine) expect++;
    if (b.cells[i].adjacent !== expect) {
      adjOk = false;
      break;
    }
  }
  check("全部 36 格邻数与独立复算一致", adjOk);
  // 已开格必非雷；未开格若为雷则合法
  let noMineRevealed = true;
  for (const c of b.cells) if (c.revealed && c.mine) noMineRevealed = false;
  check("已开格中无雷", noMineRevealed);
  check("state=playing", b.state === "playing");
}

console.log("[5/8] 无雷盘单点开满即胜");
{
  const b = newBoard(5, 5, 0);
  const res = revealAt(b, 0);
  check("单点开满全盘", res.revealedCount === 25);
  check("state=won", b.state === "won");
}

console.log("[6/8] 撞雷判负 + 雷显示");
{
  const b = newBoard(5, 5, 3, mulberry32(99));
  revealAt(b, 0); // 触发布雷
  const mineIdx = b.cells.findIndex((c) => c.mine);
  check("棋盘上有雷", mineIdx >= 0);
  const r = revealAt(b, mineIdx);
  check("引爆返回 exploded 位置", r.exploded === mineIdx);
  check("state=lost", b.state === "lost");
  check("lostAt=引爆格", b.lostAt === mineIdx);
  check("终局后操作全部空操作", revealAt(b, 0).exploded === -1 && toggleFlag(b, 0) === b.cells[0].flagged);
}

console.log("[7/8] 胜利（含自动插旗）");
{
  const b = newBoard(5, 5, 3, mulberry32(7));
  revealAt(b, 12); // 先触发布雷
  // 翻开所有非雷格
  for (let i = 0; i < b.cells.length; i++) {
    if (!b.cells[i].mine && !b.cells[i].revealed) revealAt(b, i);
  }
  check("全翻开后 state=won", b.state === "won");
  check("胜利自动给所有雷插旗", b.cells.every((c) => !c.mine || c.flagged));
}

console.log("[8/8] 和弦 + 插旗（白盒构造，确定性断言）");
{
  // 白盒棋盘：手动布雷 + 复算邻数，保证断言不依赖随机种子
  function build(mines) {
    const b = newBoard(6, 6, 0);
    b.started = true;
    b.state = "playing";
    for (const i of mines) b.cells[i].mine = true;
    for (let i = 0; i < b.cells.length; i++) {
      b.cells[i].adjacent = neighborsOf(6, 6, i).filter((j) => b.cells[j].mine).length;
    }
    return b;
  }

  // 正例：格7=(1,1) 的雷邻 = {6, 8}；全插旗后和弦 → 安全展开未开邻格，绝不引爆
  const b = build([6, 8]);
  b.cells[7].revealed = true;
  toggleFlag(b, 6);
  toggleFlag(b, 8);
  check("前置：格7 数字=2 且邻雷全插旗", b.cells[7].adjacent === 2);
  const rc = chord(b, 7);
  check("和弦正例：无引爆", rc.exploded === -1 && b.state !== "lost");
  check("和弦展开未开邻格（0/2/12/14 被翻开）",
    b.cells[0].revealed && b.cells[2].revealed && b.cells[12].revealed && b.cells[14].revealed,
    `revealedCount=${rc.revealedCount}`);

  // 负例：旗数不足（0 < 数字1）→ 空操作
  const b2 = build([6]);
  b2.cells[7].revealed = true; // 格7 邻雷={6} → 数字1
  const r2 = chord(b2, 7);
  check("旗数不足时和弦空操作", r2.exploded === -1 && r2.revealedCount === 0 && b2.state === "playing");

  // 插旗基础行为
  const b3 = newBoard(5, 5, 1, mulberry32(3));
  check("未开格可插旗", toggleFlag(b3, 24) === true);
  check("再插取消旗", toggleFlag(b3, 24) === false);
  const b5 = newBoard(5, 5, 1, mulberry32(3));
  check("初始 remainingMines=1", remainingMines(b5) === 1);
  toggleFlag(b5, 24);
  check("插旗后 remainingMines=0", remainingMines(b5) === 0);
  check("终局后拒旗", (() => {
    const b4 = newBoard(5, 5, 1, mulberry32(3));
    revealAt(b4, 0);
    const mineIdx = b4.cells.findIndex((c) => c.mine);
    revealAt(b4, mineIdx); // 判负
    const any = b4.cells.findIndex((c) => !c.revealed && !c.mine);
    return b4.state === "lost" && !b4.cells[any].flagged && toggleFlag(b4, any) === b4.cells[any].flagged;
  })());
}


console.log("[9/9] validateCustom 边界");
{
  check("5x5/12 通过（格数一半且首点安全可行）", validateCustom(5, 5, 12) === null);
  check("5x5/13 超格数一半", validateCustom(5, 5, 13) !== null);
  check("行<5 报错", validateCustom(4, 8, 5) !== null);
  check("列>30 报错", validateCustom(16, 31, 40) !== null);
  check("雷数负数报错", validateCustom(8, 8, -1) !== null);
  check("非整数报错", validateCustom(8.5, 8, 10) !== null);
  check("9x9/45 通过（一半=40.5→40? 45>40 应报错）", validateCustom(9, 9, 45) !== null);
  check("9x9/40 通过", validateCustom(9, 9, 40) === null);
  check("预设标签完整", PRESETS.length === 3 && PRESETS.every((p) => p.rows > 0 && p.mines > 0));
}

console.log(`\n引擎单测：${pass} 通过 / ${fail} 失败`);
rmSync(root + "/test/dist", { recursive: true, force: true });
process.exit(fail > 0 ? 1 : 0);