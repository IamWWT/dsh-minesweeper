/**
 * dsh-minesweeper 游戏引擎（纯函数，零依赖，零 DOM）。
 *
 * 约定：
 *  - 棋盘行优先展开为 cells[]，idx = row * cols + col；
 *  - 所有变更函数原地修改 Board 并返回结构化结果；UI 层以 tick 计数触发重渲染；
 *  - 雷在「首次点击」时才放置（首点安全）：排除首点格 + 其八邻域；
 *  - rng 可注入（测试用确定性随机），缺省 Math.random。
 */

export type Rng = () => number;

export class EngineError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "EngineError";
  }
}

export interface Cell {
  mine: boolean;
  revealed: boolean;
  flagged: boolean;
  /** 周围 8 格中的雷数（布雷后计算）。 */
  adjacent: number;
}

export type BoardState = "new" | "playing" | "won" | "lost";

export interface Board {
  rows: number;
  cols: number;
  mines: number;
  state: BoardState;
  /** 是否已放置雷（首次点击后置 true）。 */
  started: boolean;
  cells: Cell[];
  /** 引爆的雷格 idx；-1 = 无。 */
  lostAt: number;
  /** 布雷随机源（首点安全布雷时使用；测试可注入确定性种子）。 */
  rng: Rng;
}

export interface RevealResult {
  revealedCount: number;
  /** 引爆的雷格 idx；-1 = 无。 */
  exploded: number;
}

export function idxOf(rows: number, cols: number, r: number, c: number): number {
  if (!Number.isInteger(r) || !Number.isInteger(c) || r < 0 || c < 0 || r >= rows || c >= cols) {
    throw new EngineError(`越界坐标 (${r},${c})，棋盘 ${rows}x${cols}`);
  }
  return r * cols + c;
}

export function idxToRC(idx: number, cols: number): [number, number] {
  return [Math.floor(idx / cols), idx % cols];
}

export function neighborsOf(rows: number, cols: number, idx: number): number[] {
  const [r, c] = idxToRC(idx, cols);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const r2 = r + dr;
      const c2 = c + dc;
      if (r2 < 0 || c2 < 0 || r2 >= rows || c2 >= cols) continue;
      out.push(r2 * cols + c2);
    }
  }
  return out;
}

/**
 * 可行性：rows/cols >= 2，且首点安全可成立——
 * 首点格 + 八邻域（最多 9 格）必须能全部避开雷，即 mines <= total - min(9, total)。
 */
export function isFeasible(rows: number, cols: number, mines: number): boolean {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || !Number.isInteger(mines)) return false;
  if (rows < 2 || cols < 2 || mines < 0) return false;
  const total = rows * cols;
  return mines <= total - Math.min(9, total);
}

export function newBoard(rows: number, cols: number, mines: number, rng: Rng = Math.random): Board {
  if (!isFeasible(rows, cols, mines)) {
    throw new EngineError(
      `不可行的棋盘 ${rows}x${cols} 雷=${mines}（首点安全要求 雷 <= ${rows * cols - Math.min(9, rows * cols)}）`,
    );
  }
  const total = rows * cols;
  const cells: Cell[] = new Array(total);
  for (let i = 0; i < total; i++) {
    cells[i] = { mine: false, revealed: false, flagged: false, adjacent: 0 };
  }
  return { rows, cols, mines, state: "new", started: false, cells, lostAt: -1, rng };
}

/** 排除 safeIdx 及其八邻域后随机放雷（Fisher-Yates 洗牌取前 mines 个）。 */
function placeMines(b: Board, safeIdx: number): void {
  const { rows, cols, cells } = b;
  const safe = new Set<number>([safeIdx, ...neighborsOf(rows, cols, safeIdx)]);
  const pool: number[] = [];
  for (let i = 0; i < rows * cols; i++) {
    if (!safe.has(i)) pool.push(i);
  }
  const rng = b.rng;
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  for (let k = 0; k < b.mines; k++) cells[pool[k]].mine = true;
  for (let i = 0; i < cells.length; i++) {
    let n = 0;
    for (const j of neighborsOf(rows, cols, i)) if (cells[j].mine) n++;
    cells[i].adjacent = n;
  }
  b.started = true;
}

/** 洪水填充：展开 start 及其连通的空域（不越过已开格/旗/雷）。 */
function floodReveal(b: Board, start: number): number {
  const queue: number[] = [start];
  let count = 0;
  while (queue.length > 0) {
    const i = queue.pop() as number;
    const c = b.cells[i];
    if (c.revealed || c.flagged || c.mine) continue;
    c.revealed = true;
    count++;
    if (c.adjacent === 0) {
      for (const j of neighborsOf(b.rows, b.cols, i)) {
        const nc = b.cells[j];
        if (!nc.revealed && !nc.mine) queue.push(j);
      }
    }
  }
  return count;
}

function checkWin(b: Board): void {
  if (b.state !== "playing") return;
  let nonMine = 0;
  let revealedNonMine = 0;
  for (const c of b.cells) {
    if (!c.mine) {
      nonMine++;
      if (c.revealed) revealedNonMine++;
    }
  }
  if (nonMine > 0 && revealedNonMine === nonMine) {
    b.state = "won";
    for (const c of b.cells) if (c.mine) c.flagged = true; // 经典：胜利自动插旗
  }
}

/**
 * 翻开一格（或经由空域洪水展开）。首次调用会按首点安全布雷（随机源取 board.rng）。
 * 已开格/已插旗/终局棋盘 → 空操作。
 */
export function revealAt(b: Board, i: number): RevealResult {
  const c = b.cells[i];
  if (b.state === "won" || b.state === "lost") return { revealedCount: 0, exploded: -1 };
  if (c.revealed || c.flagged) return { revealedCount: 0, exploded: -1 };
  if (!b.started) {
    placeMines(b, i);
    b.state = "playing";
  }
  if (c.mine) {
    b.state = "lost";
    b.lostAt = i;
    c.revealed = true;
    return { revealedCount: 0, exploded: i };
  }
  const count = floodReveal(b, i);
  checkWin(b);
  return { revealedCount: count, exploded: -1 };
}

/**
 * 和弦：点击已开数字格，若周围旗数 == 数字，则翻开周围未插旗格；
 * 旗数不符 → 空操作（经典规则）。
 */
export function chord(b: Board, i: number): RevealResult {
  const c = b.cells[i];
  if (b.state === "won" || b.state === "lost") return { revealedCount: 0, exploded: -1 };
  if (!c.revealed || c.adjacent === 0) return { revealedCount: 0, exploded: -1 };
  const nbs = neighborsOf(b.rows, b.cols, i);
  let flags = 0;
  for (const j of nbs) if (b.cells[j].flagged) flags++;
  if (flags !== c.adjacent) return { revealedCount: 0, exploded: -1 };
  let revealed = 0;
  let exploded = -1;
  for (const j of nbs) {
    const nc = b.cells[j];
    if (nc.flagged || nc.revealed) continue;
    const r = revealAt(b, j);
    revealed += r.revealedCount;
    if (r.exploded >= 0) {
      exploded = r.exploded;
      break;
    }
  }
  if (b.state === "playing") checkWin(b);
  return { revealedCount: revealed, exploded };
}

/** 插旗/取消旗；已开格与终局棋盘不生效。返回当前是否已插旗。 */
export function toggleFlag(b: Board, i: number): boolean {
  const c = b.cells[i];
  if (b.state === "won" || b.state === "lost") return c.flagged;
  if (c.revealed) return c.flagged;
  c.flagged = !c.flagged;
  return c.flagged;
}

export function remainingMines(b: Board): number {
  let flags = 0;
  for (const c of b.cells) if (c.flagged) flags++;
  return b.mines - flags;
}

/** 终局时把全部雷标出（UI 用；引擎层保持 cells 单一事实源）。 */
export function visibleMines(b: Board): number[] {
  if (b.state !== "lost") return [];
  const out: number[] = [];
  for (let i = 0; i < b.cells.length; i++) if (b.cells[i].mine) out.push(i);
  return out;
}