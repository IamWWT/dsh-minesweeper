/**
 * dsh-minesweeper — Host 侧状态文件（v0.5，spec D6/H1）。
 *
 * 权威数据源：`$DSH_HOME/profiles/<profile>/dsh-minesweeper/stats.json`
 *   { "stats": { "<难度键>": { "bestMs": number|null, "plays": number, "wins": number } } }
 *
 * 设计：
 * - 本模块**纯函数 + 无 I/O 依赖注入**（mkdir/write/read 可注入），便于 Node 直跑单测；
 * - 写盘原子化：先写 `<file>.tmp` 再 rename（同目录 rename 原子）；
 * - 读取损坏文件：备份为 `stats.json.corrupt` 后按空表继续（不阻塞游戏）；
 * - `parseStats` 是 HTTP 边界的唯一校验入口：形状不对的条目整体丢弃（宽容解析）。
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** 单个难度的成绩记录。 */
export interface DifficultyStats {
  bestMs: number | null;
  plays: number;
  wins: number;
}

/** 全量成绩表（难度键 → 记录）。 */
export type StatsMap = Record<string, DifficultyStats>;

/** 状态文件名（相对状态目录）。 */
export const STATE_FILE = "stats.json";

/** 默认状态目录：`<dshHome>/profiles/<profile>/dsh-minesweeper`。 */
export function resolveStateDir(dshHome: string, profile: string): string {
  const home = (dshHome || "").replace(/\/+$/, "");
  return `${home}/profiles/${profile || "web"}/dsh-minesweeper`;
}

/**
 * 宽松校验：把任意输入收敛为合法的 StatsMap。
 * 规则：非对象 → 空表；每个条目的字段逐项收敛（非有限数 → 0，bestMs 非有限数 → null，
 * 且 bestMs 存在时才计 wins/play 语义）；空键 / 非字符串键丢弃。
 */
export function parseStats(raw: unknown): StatsMap {
  const out: StatsMap = {};
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || k.length === 0 || k.length > 128) continue;
    if (v == null || typeof v !== "object" || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const bestMs = typeof o.bestMs === "number" && Number.isFinite(o.bestMs) ? o.bestMs : null;
    const plays = typeof o.plays === "number" && Number.isFinite(o.plays) ? Math.max(0, Math.trunc(o.plays)) : 0;
    const wins = typeof o.wins === "number" && Number.isFinite(o.wins) ? Math.min(Math.max(0, Math.trunc(o.wins)), plays) : 0;
    out[k] = { bestMs, plays, wins };
  }
  return out;
}

/** 从磁盘读取状态表（缺失/损坏 → 空表；损坏文件留 `.corrupt` 备份）。
 *  兼容两种落盘形状：裸表 `{key: {...}}` 与包装 `{stats: {...}}`（本模块写入用后者）。 */
export function loadStatsFile(file: string): StatsMap {
  try {
    if (!existsSync(file)) return {};
    const raw = JSON.parse(readFileSync(file, "utf-8"));
    if (raw != null && typeof raw === "object" && !Array.isArray(raw) && "stats" in raw) {
      return parseStats((raw as { stats: unknown }).stats);
    }
    return parseStats(raw);
  } catch {
    try {
      if (existsSync(file)) renameSync(file, file + ".corrupt");
    } catch {
      /* 备份失败不阻塞：按空表继续 */
    }
    return {};
  }
}

/**
 * 原子写状态表：`writeFile` 可注入（单测拦截）。
 * 返回写入的规范化内容（StatsMap）。
 */
export function saveStatsFile(
  file: string,
  stats: StatsMap,
  io?: { writeFile?: (path: string, data: string) => void },
): StatsMap {
  const clean = parseStats(stats);
  const dir = dirname(file);
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* 目录已存在或不可建：直接尝试写（失败抛给调用方） */
  }
  const write = io?.writeFile ?? ((p: string, d: string) => writeFileSync(p, d, "utf-8"));
  const payload = JSON.stringify({ stats: clean }, null, 2) + "\n";
  const tmp = file + ".tmp";
  write(tmp, payload);
  try {
    renameSync(tmp, file);
  } catch (e) {
    // rename 失败（跨设备等极端情况）：退化为直接覆盖写
    write(file, payload);
    void e;
  }
  return clean;
}

/** 删除状态文件（清空记录；不存在视为成功）。 */
export function clearStatsFile(file: string): boolean {
  if (!existsSync(file)) return true;
  try {
    rmSync(file);
    return true;
  } catch {
    return false;
  }
}