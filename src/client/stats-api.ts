/**
 * dsh-minesweeper — v0.5 host API 数据层（spec D6/H2/H3）。
 *
 * 约定：
 *   GET  /api/dsh-minesweeper/stats  → { version, stats: {难度键: {bestMs, plays, wins}}, settings? }
 *   PUT  /api/dsh-minesweeper/stats  body { stats: {...} }（全量替换，host 文件为权威源）
 *   DELETE /api/dsh-minesweeper/stats（全量清空；UI 的「清空记录」按难度走 PUT）
 *
 * 所有请求带超时（红线：异步必须有超时），失败一律返回 null/false，
 * 调用方按「host 不可达 → localStorage 降级」处理，绝不阻塞游戏。
 */
export interface DiffStats {
  bestMs: number | null;
  plays: number;
  wins: number;
}

export type StatsMap = Record<string, DiffStats>;

export interface HostStatsResponse {
  version?: string;
  stats?: StatsMap;
  settings?: { flagModeDefault?: boolean };
}

const API = "/api/dsh-minesweeper/stats";

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  return { signal: ctl.signal, cancel: () => clearTimeout(t) };
}

/** 读取 host 成绩；不可达/超时/坏响应 → null（调用方降级 localStorage）。 */
export async function fetchHostStats(timeoutMs = 3000): Promise<HostStatsResponse | null> {
  try {
    const { signal, cancel } = withTimeout(timeoutMs);
    const res = await fetch(API, { method: "GET", signal, headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<HostStatsResponse>;
    if (!body || typeof body !== "object") return null;
    return {
      version: typeof body.version === "string" ? body.version : undefined,
      stats: body.stats && typeof body.stats === "object" ? (body.stats as StatsMap) : {},
      settings: body.settings && typeof body.settings === "object" ? (body.settings as HostStatsResponse["settings"]) : undefined,
    };
  } catch {
    return null;
  }
}

/** 全量写回 host（调用方负责传完整表）；成功 true。 */
export async function putHostStats(stats: StatsMap, timeoutMs = 4000): Promise<boolean> {
  try {
    const { signal } = withTimeout(timeoutMs);
    const res = await fetch(API, {
      method: "PUT",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stats }),
    });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return Boolean(body && body.ok);
  } catch {
    return false;
  }
}

/** 全量清空 host 状态文件。 */
export async function deleteHostStats(timeoutMs = 4000): Promise<boolean> {
  try {
    const { signal } = withTimeout(timeoutMs);
    const res = await fetch(API, { method: "DELETE", signal });
    if (!res.ok) return false;
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return Boolean(body && body.ok);
  } catch {
    return false;
  }
}

/** 把 host 返回的 stats 收敛为合法表（与 host parseStats 同语义，防脏数据进 UI）。 */
export function normalizeStatsMap(raw: unknown): StatsMap {
  const out: StatsMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string" || !k) continue;
    const o = (v ?? {}) as Record<string, unknown>;
    out[k] = {
      bestMs: typeof o.bestMs === "number" && Number.isFinite(o.bestMs) ? o.bestMs : null,
      plays: typeof o.plays === "number" && Number.isFinite(o.plays) ? Math.max(0, Math.trunc(o.plays)) : 0,
      wins: typeof o.wins === "number" && Number.isFinite(o.wins) ? Math.min(Math.max(0, Math.trunc(o.wins)), typeof o.plays === "number" ? Math.trunc(o.plays) : 0) : 0,
    };
  }
  return out;
}