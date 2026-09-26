/**
 * dsh-minesweeper — Host HTTP 路由（v0.5，spec D6/A11）。
 *
 *   GET    /api/dsh-minesweeper/stats   { version, stats, settings }
 *   PUT    /api/dsh-minesweeper/stats   body { stats: {...} } → 全量替换并持久化
 *   DELETE /api/dsh-minesweeper/stats   清空（删状态文件）
 *
 * 约定（与 dsh-scheduled-send 同惯例）：
 * - 全部 JSON；`Cache-Control: no-store`；CORS 放开（同源直连，跨源兜底）；
 * - `readBody` 只读**请求对象** req（传错对象 → promise 永不 resolve，历史教训）；
 * - 坏 JSON / 坏形状 → 400（PUT）或容错解析（见 state.ts parseStats）；
 * - 文件 I/O 走可注入的 StateStore，便于单测。
 */
import { clearStatsFile, loadStatsFile, parseStats, saveStatsFile, type StatsMap } from "./state.ts";

/** 最小请求对象面（Node http.IncomingMessage 的子集）。 */
type Req = {
  on: (ev: "data" | "end" | "error", fn: (chunk?: unknown, err?: unknown) => void) => void;
  destroy: () => void;
};

/** 最小响应对象面。 */
type Res = {
  writeHead: (status: number, headers?: Record<string, string>) => void;
  end: (body?: string) => void;
};

export interface RouteDeps {
  /** 状态文件路径（已按 $DSH_HOME/profile 解析好）。 */
  stateFile: string;
  /** 设置快照读取（settings 服务缺失时返回空对象）。 */
  getSettings: () => { flagModeDefault?: boolean };
  version: string;
  /** 0.1.7 设置读写门面（缺失时设置端点不注册，/stats 仍可用）。 */
  settingsFacade?: {
    getSettings(): { flagModeDefault?: boolean };
    currentRevision(): number;
    write(input: { fields?: Record<string, unknown>; clear?: string[]; expectedRevision?: number }): Promise<{ revision: number }>;
    watch(timeoutMs: number): Promise<{ changed: boolean; revision: number }>;
  } | null;
  /** I/O 注入点（单测替换）。 */
  io?: {
    load?: (file: string) => StatsMap;
    save?: (file: string, stats: StatsMap) => StatsMap;
    clear?: (file: string) => boolean;
  };
}

/** GET /api/dsh-minesweeper/settings → { value, revision, writable }。 */
function createSettingsGetHandler(facade: NonNullable<RouteDeps["settingsFacade"]>): (req: Req, res: Res) => Promise<void> {
  return async (_req, res) => {
    try {
      const value = { flagModeDefault: Boolean(facade.getSettings().flagModeDefault) };
      sendJson(res, 200, { value, revision: facade.currentRevision(), writable: true });
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e) });
    }
  };
}

/** PUT /api/dsh-minesweeper/settings/write → { fields?, clear?, expectedRevision? } → { revision }（409/400/500）。 */
function createSettingsWriteHandler(facade: NonNullable<RouteDeps["settingsFacade"]>): (req: Req, res: Res) => Promise<void> {
  return async (req, res) => {
    let raw: unknown;
    try {
      const body = await readBody(req, 64 * 1024);
      raw = body ? JSON.parse(body) : {};
    } catch {
      sendJson(res, 400, { ok: false, error: "bad-json" });
      return;
    }
    if (raw === null || typeof raw !== "object") {
      sendJson(res, 400, { ok: false, error: "bad-body" });
      return;
    }
    const body = raw as { fields?: Record<string, unknown>; clear?: string[]; expectedRevision?: number };
    try {
      const out = await facade.write({ fields: body.fields, clear: body.clear, expectedRevision: body.expectedRevision });
      sendJson(res, 200, { ok: true, revision: out.revision });
    } catch (e) {
      const msg = String((e as { message?: string })?.message ?? e);
      const status = /revision/i.test(msg) ? 409 : /未知设置项|至少其一/.test(msg) ? 400 : 500;
      sendJson(res, status, { ok: false, error: msg });
    }
  };
}

/** GET /api/dsh-minesweeper/settings/watch?timeoutMs= → 长轮询 { changed, revision }。 */
function createSettingsWatchHandler(facade: NonNullable<RouteDeps["settingsFacade"]>, timeoutMs?: number): (req: Req, res: Res) => Promise<void> {
  return async (_req, res) => {
    try {
      const out = await facade.watch(timeoutMs ?? 25_000);
      sendJson(res, 200, out);
    } catch (e) {
      sendJson(res, 500, { ok: false, error: String(e) });
    }
  };
}

function sendJson(res: Res, status: number, obj: unknown): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(JSON.stringify(obj));
}

/** 从请求对象读 body（只读 req！）。 */
function readBody(req: Req, limit = 1 << 20): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let size = 0;
    req.on("data", (chunk?: unknown) => {
      const c = chunk as Buffer | undefined;
      if (!c) return;
      size += c.length;
      if (size > limit) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(new Uint8Array(c.buffer, c.byteOffset, c.byteLength));
    });
    req.on("end", () => resolve(Buffer.concat(chunks as unknown as readonly Uint8Array[]).toString("utf-8")));
    req.on("error", reject);
  });
}

interface RouteHandlers {
  get: (req: Req, res: Res) => Promise<void>;
  put: (req: Req, res: Res) => Promise<void>;
  del: (req: Req, res: Res) => Promise<void>;
}

/** 构造三个路由处理器（注入式，可直接单测）。 */
export function createStatsHandlers(deps: RouteDeps): RouteHandlers {
  const load = deps.io?.load ?? ((f: string) => loadStatsFile(f));
  const save = deps.io?.save ?? ((f: string, s: StatsMap) => saveStatsFile(f, s));
  const clear = deps.io?.clear ?? clearStatsFile;

  return {
    async get(_req, res) {
      let stats: StatsMap;
      try {
        stats = load(deps.stateFile);
      } catch {
        stats = {};
      }
      sendJson(res, 200, { version: deps.version, stats, settings: deps.getSettings() });
    },

    async put(req, res) {
      let raw: unknown;
      try {
        const body = await readBody(req);
        raw = body ? JSON.parse(body) : undefined;
      } catch {
        sendJson(res, 400, { ok: false, error: "bad-json" });
        return;
      }
      const obj = (raw ?? {}) as Record<string, unknown>;
      if (obj.stats === undefined) {
        sendJson(res, 400, { ok: false, error: "stats-missing" });
        return;
      }
      if (obj.stats !== null && typeof obj.stats !== "object") {
        sendJson(res, 400, { ok: false, error: "bad-stats" });
        return;
      }
      const stats = parseStats(obj.stats);
      let saved: StatsMap;
      try {
        saved = save(deps.stateFile, stats);
      } catch (e) {
        sendJson(res, 500, { ok: false, error: `state-save-failed: ${String(e)}` });
        return;
      }
      sendJson(res, 200, { ok: true, stats: saved });
    },

    async del(_req, res) {
      let ok = false;
      try {
        ok = clear(deps.stateFile);
      } catch {
        ok = false;
      }
      sendJson(res, ok ? 200 : 500, { ok });
    },
  };
}

/** 注册到宿主 webServer（无 webServer 时静默跳过——非 web profile 下插件仍可加载）。 */
export function registerStatsRoutes(
  ws: { register?: (r: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => void } | null | undefined,
  deps: RouteDeps,
): void {
  if (!ws || typeof ws.register !== "function") return;
  const h = createStatsHandlers(deps);
  ws.register({ kind: "exact", path: "/api/dsh-minesweeper/stats", handler: (req, res) => {
    const r = res as unknown as { method?: string };
    const method = (req as unknown as { method?: string }).method || "GET";
    const rr = r as unknown as Res;
    if (method === "PUT") return h.put(req as Req, rr);
    if (method === "DELETE") return h.del(req as Req, rr);
    return h.get(req as Req, rr);
  } });

  /* 0.1.7 设置端点（门面缺失时不注册，/stats 保持可用）。 */
  if (deps.settingsFacade) {
    const facade = deps.settingsFacade;
    ws.register({ kind: "exact", path: "/api/dsh-minesweeper/settings", handler: (req, res) => {
      const method = (req as unknown as { method?: string }).method || "GET";
      const rr = res as unknown as Res;
      if (method === "PUT") return createSettingsWriteHandler(facade)(req as Req, rr);
      return createSettingsGetHandler(facade)(req as Req, rr);
    } });
    ws.register({ kind: "exact", path: "/api/dsh-minesweeper/settings/watch", handler: (req, res) =>
      createSettingsWatchHandler(facade)(req as Req, res as unknown as Res) });
  }
}
