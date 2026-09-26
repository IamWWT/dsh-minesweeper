/**
 * dsh-minesweeper — 客户端 UI（React 由 DSH 宿主经 factory require 注入，
 * 本文件不做任何静态 react import；全部 createElement 走注入的 R）。
 *
 * 组件：App（标签主体）= 标题栏 + HUD（表情/雷数/计时）+ 难度选择（含自定义表单）
 *      + 棋盘（CSS grid 自适应）+ 成绩条（localStorage 持久化）。
 *
 * 交互：
 *  - 点按未开格 → 翻开（首次点击触发首点安全布雷）
 *  - 长按 ≥350ms（位移 >12px 取消）→ 插旗（触屏兜底；桌面右键亦可插旗）
 *  - 点击已开数字格 → 和弦（周围旗数 == 数字时引爆邻域）
 *  - 表情按钮：🙂 重开 / 😵 已负 / 😎 已胜
 */
import {
  PRESETS,
  validateCustom,
  statsKeyOf,
  type DifficultyPreset,
} from "../shared/difficulties.ts";
import {
  newBoard,
  revealAt,
  chord,
  toggleFlag,
  remainingMines,
  type Board,
} from "../shared/engine.ts";
import { fetchHostStats, putHostStats, deleteHostStats, normalizeStatsMap, type StatsMap } from "./stats-api.ts";

/* ---------------- React 最小结构类型（宿主注入） ---------------- */

export interface ReactLike {
  createElement: (...args: unknown[]) => unknown;
  useState: <T>(init: T | (() => T)) => [T, (v: T | ((p: T) => T)) => void];
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => void;
  useRef: <T>(init: T) => { current: T };
  useMemo: <T>(fn: () => T, deps: unknown[]) => T;
  useCallback: <F extends (...a: never[]) => unknown>(fn: F, deps: unknown[]) => F;
  Fragment: unknown;
}

interface Stats {
  bestMs: number | null;
  plays: number;
  wins: number;
}

const EMPTY_STATS: Stats = { bestMs: null, plays: 0, wins: 0 };

function loadStats(key: string): Stats {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const j = JSON.parse(raw) as Partial<Stats>;
      return {
        bestMs: typeof j.bestMs === "number" ? j.bestMs : null,
        plays: typeof j.plays === "number" ? j.plays : 0,
        wins: typeof j.wins === "number" ? j.wins : 0,
      };
    }
  } catch {
    /* localStorage 不可用（隐私模式等）时静默降级 */
  }
  return { ...EMPTY_STATS };
}

function saveStats(key: string, s: Stats): void {
  try {
    localStorage.setItem(key, JSON.stringify(s));
  } catch {
    /* 忽略配额/隐私模式失败：成绩仅尽力而为 */
  }
}

/* ---------------- 组件工厂 ---------------- */

export interface GameUI {
  /** 标签主体组件（经 R.createElement 渲染）。 */
  App: (props: Record<string, unknown>) => unknown;
}

/* 注入的 React 的极简类型面：避免 any 上泛型调用（TS2347）与隐式 any 参数。 */
export interface GameReact {
  createElement: (type: unknown, props?: Record<string, unknown> | null, ...children: unknown[]) => unknown;
  useState: <T = unknown>(init?: T | (() => T)) => [T, (v: T | ((p: T) => T)) => void];
  useRef: <T>(v: T) => { current: T };
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => void;
}

export function createGameUI(R: any): GameUI {
  const RR = R as GameReact;
  const h = R.createElement;

  /* ---- 计时/时长格式化 ---- */
  function fmtClock(sec: number): string {
    return String(Math.min(999, Math.max(0, sec))).padStart(3, "0");
  }
  function fmtMs(ms: number | null): string {
    return ms == null ? "—" : (ms / 1000).toFixed(1) + "s";
  }

  /* ---- App ---- */
  function App(_props: Record<string, unknown>): unknown {
    const [presetId, setPresetId] = RR.useState<string>("beginner");
    const [custom, setCustom] = RR.useState({ rows: 16, cols: 16, mines: 30 });
    const [formErr, setFormErr] = RR.useState("");
    const [flagMode, setFlagMode] = RR.useState(false);
    const [fs, setFs] = RR.useState(false);
    const [, setTick] = RR.useState(0);
    const [elapsed, setElapsed] = RR.useState(0);

    const boardRef = RR.useRef<Board>(newBoard(9, 9, 10));
    const startRef = RR.useRef<number | null>(null); // 首次翻格时刻（performance.now）
    const lpRef = RR.useRef<{ x: number; y: number; timer: number; fired: boolean; canceled: boolean } | null>(null);
    const [stats, setStats] = RR.useState<Stats>(() => loadStats(statsKeyOf("beginner")));
    const [statsKey, setStatsKey] = RR.useState(statsKeyOf("beginner"));

    /* v0.5 数据层：全量表（host 权威 / localStorage 降级镜像） */
    const mapRef = RR.useRef<StatsMap>({});
    const hostOkRef = RR.useRef(false);
    const flagTouchedRef = RR.useRef(false); // 用户手动动过标记模式开关 → 不再套用默认值

    /* v0.5：挂载时从 host 拉权威成绩表（失败 → 保持 localStorage 降级，不阻塞渲染） */
    RR.useEffect(() => {
      let dead = false;
      void (async () => {
        const res = await fetchHostStats();
        if (dead) return;
        if (res && res.stats) {
          hostOkRef.current = true;
          const table = normalizeStatsMap(res.stats);
          mapRef.current = table;
          for (const [k, v] of Object.entries(table)) saveStats(k, v); // 回写本地镜像（尽力）
          setStats({ ...table[statsKeyOf(currentPreset().id)] ?? { ...EMPTY_STATS } });
        }
        if (res?.settings?.flagModeDefault && !flagTouchedRef.current) setFlagMode(true);
      })();
      return () => {
        dead = true;
      };
    }, []);

    const bump = (): void => setTick((t) => t + 1);

    const currentPreset = (): { rows: number; cols: number; mines: number; id: string } =>
      presetId === "custom"
        ? { rows: custom.rows, cols: custom.cols, mines: custom.mines, id: `custom-${custom.rows}x${custom.cols}-${custom.mines}` }
        : (() => {
            const p = PRESETS.find((x) => x.id === presetId) ?? PRESETS[0];
            return { rows: p.rows, cols: p.cols, mines: p.mines, id: p.id };
          })();

    /* 成绩键随难度切换（首次渲染后）：host 表优先，未同步前用本地镜像 */
    RR.useEffect(() => {
      const key = statsKeyOf(currentPreset().id);
      if (key !== statsKey) {
        setStatsKey(key);
        let s = mapRef.current[key];
        if (!s) {
          s = loadStats(key);
          mapRef.current[key] = s;
        }
        setStats({ ...s });
      }
    });

    /* 计时器：playing 期间每 250ms 刷新显示（封顶 999s） */
    RR.useEffect(() => {
      const t = window.setInterval(() => {
        if (startRef.current == null) return;
        setElapsed(Math.min(999, Math.floor((performance.now() - startRef.current) / 1000)));
      }, 250);
      return () => window.clearInterval(t);
    }, []);

    /* 全屏：Esc 退出 */
    RR.useEffect(() => {
      if (!fs) return;
      const h = (e: { key: string }) => {
        if (e.key === "Escape") setFs(false);
      };
      window.addEventListener("keydown", h);
      return () => window.removeEventListener("keydown", h);
    }, [fs]);

    function newGame(p: { rows: number; cols: number; mines: number }): void {
      boardRef.current = newBoard(p.rows, p.cols, p.mines);
      startRef.current = null;
      lpRef.current = null;
      setElapsed(0);
      bump();
    }

    function onEnd(b: Board): void {
      const key = statsKeyOf(currentPreset().id);
      const s = { ...(mapRef.current[key] ?? loadStats(key)) };
      s.plays += 1;
      if (b.state === "won") {
        s.wins += 1;
        const ms = startRef.current == null ? 0 : Math.max(0, Math.round(performance.now() - startRef.current));
        if (s.bestMs == null || ms < s.bestMs) s.bestMs = ms;
      }
      /* v0.4 终局停表：经典规则终局即停表（计时不再走字）；
         胜利时剩余雷数=0 是引擎自动给全部雷插旗的正常行为 */
      if (startRef.current != null) {
        setElapsed(Math.min(999, Math.floor((performance.now() - startRef.current) / 1000)));
        startRef.current = null;
      }
      mapRef.current[key] = s;
      saveStats(key, s); // 本地镜像（尽力）
      setStats({ ...s });
      /* v0.5：host 为权威源，终局后回写（尽力；失败降级本地，不影响对局） */
      if (hostOkRef.current) {
        void putHostStats(mapRef.current).then((ok) => {
          if (!ok) hostOkRef.current = false;
        });
      }
    }

    function doReveal(i: number): void {
      const b = boardRef.current;
      if (b.state === "won" || b.state === "lost") return;
      revealAt(b, i);
      if (b.state !== "new") {
        if (startRef.current == null) startRef.current = performance.now();
        // 引擎调用后 state 可能已变更：经 string 读取避免误用调用前的收窄类型
        const st: string = b.state;
        if (st === "won" || st === "lost") onEnd(b);
      }
      bump();
    }

    function doChord(i: number): void {
      const b = boardRef.current;
      if (b.state !== "playing") return;
      chord(b, i);
      if (startRef.current == null && b.state === "playing") startRef.current = performance.now();
      const st: string = b.state;
      if (st === "won" || st === "lost") onEnd(b);
      bump();
    }

    function doFlag(i: number): void {
      const b = boardRef.current;
      if (b.state === "won" || b.state === "lost") return;
      toggleFlag(b, i);
      bump();
    }

    /* ---- 指针交互（点按开格 / 长按 ≥350ms 插旗） ----
       down 起 350ms 计时；位移 >12px 或 pointerleave → canceled（视为滚动，抬手不开格）；
       计时到 → fired（插旗），随后 pointerup 不再开格；未触发即抬手 → 点按开格/和弦。 */
    function onCellDown(i: number, e: { clientX: number; clientY: number; button?: number }): void {
      // 右键/中键交给 contextmenu 与系统处理，不启动长按计时（防标记模式下右键双触发）
      if (e.button != null && e.button !== 0) return;
      const c = boardRef.current.cells[i];
      if (boardRef.current.state === "won" || boardRef.current.state === "lost") return;
      if (c.revealed) return;
      const lp = { x: e.clientX, y: e.clientY, timer: 0, fired: false, canceled: false };
      lpRef.current = lp;
      lp.timer = window.setTimeout(() => {
        if (lpRef.current === lp && !lp.canceled) {
          lp.fired = true;
          doFlag(i);
        }
      }, 350);
    }

    function onCellMove(e: { clientX: number; clientY: number }): void {
      const lp = lpRef.current;
      if (!lp || lp.fired || lp.canceled) return;
      if (Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 12) {
        window.clearTimeout(lp.timer);
        lp.canceled = true;
      }
    }

    function onCellUp(i: number, e?: { button?: number }): void {
      // 右键/中键抬起由 contextmenu 路径处理，避免与插旗叠加成“插了又取消”
      if (e && e.button != null && e.button !== 0) return;
      const lp = lpRef.current;
      lpRef.current = null;
      if (!lp || lp.canceled) return;
      window.clearTimeout(lp.timer);
      if (lp.fired) return; // 长按已插旗
      reveal(i);
    }

    function onCellLeave(): void {
      const lp = lpRef.current;
      if (!lp) return;
      window.clearTimeout(lp.timer);
      lp.canceled = true;
      lpRef.current = null;
    }

    
    function reveal(i: number): void {
      const c = boardRef.current.cells[i];
      if (flagMode) {
        // 标记模式：左键 = 插旗/取消旗（未开格）；已开格 → 和弦（与普通模式一致）
        if (c.revealed) {
          doChord(i);
        } else {
          doFlag(i);
        }
        return;
      }
      if (c.revealed) {
        doChord(i); // 已开格 → 和弦
        return;
      }
      if (c.flagged) return;
      doReveal(i);
    }

    function onContext(i: number, e: { preventDefault: () => void }): void {
      e.preventDefault();
      doFlag(i);
    }

    function startCustom(): void {
      const err = validateCustom(custom.rows, custom.cols, custom.mines);
      setFormErr(err ?? "");
      if (err) return;
      newGame({ rows: custom.rows, cols: custom.cols, mines: custom.mines });
    }

    function switchPreset(id: string): void {
      setPresetId(id);
      const p = PRESETS.find((x) => x.id === id);
      if (p) newGame({ rows: p.rows, cols: p.cols, mines: p.mines });
    }

    function restart(): void {
      if (presetId === "custom") {
        newGame({ rows: custom.rows, cols: custom.cols, mines: custom.mines });
      } else {
        switchPreset(presetId);
      }
    }

    function clearStats(): void {
      const key = statsKeyOf(currentPreset().id);
      const s = { ...EMPTY_STATS };
      mapRef.current[key] = s;
      saveStats(key, s);
      setStats({ ...s });
      /* v0.5：host 侧同难度记录一并清零（PUT 全量表；全量 DELETE 仅保留给运维/测试） */
      if (hostOkRef.current) {
        void putHostStats(mapRef.current).then((ok) => {
          if (!ok) hostOkRef.current = false;
        });
      }
    }

    /* ---------------- 渲染 ---------------- */
    const b = boardRef.current;
    const face = b.state === "lost" ? "😵" : b.state === "won" ? "😎" : "🙂";

    return h(
      "div",
      { className: "msw-root" + (fs ? " msw-fs" : ""), style: { "--msw-ar": b.cols / b.rows }, role: "application", "aria-label": "扫雷" },
      h(
        "div",
        { className: "msw-title" },
        h("h1", null, "扫雷"),
        h("span", { className: "msw-badge" }, `dsh-minesweeper v0.5.3`),
      ),
      h(
        "div",
        { className: "msw-hud" },
        h("button", { type: "button", className: "msw-face", onClick: restart, "aria-label": "重新开始" }, face),
        h(
          "div",
          { className: "msw-meters" },
          h(
            "div",
            { className: "msw-meter", title: "剩余雷数 = 盘上还没踩到的雷还有多少" },
            h("span", { className: "msw-meter-cap" }, "💣 剩余雷"),
            h("span", { className: "msw-meter-val" }, fmtClock(remainingMines(b))),
          ),
          h(
            "div",
            { className: "msw-meter", title: "用时 = 从第一次开格起计，单位秒" },
            h("span", { className: "msw-meter-cap" }, "⏱ 用时(秒)"),
            h("span", { className: "msw-meter-val" }, fmtClock(elapsed)),
          ),
        ),
        h(
          "button",
          {
            type: "button",
            className: "msw-btn" + (fs ? " msw-fs-on" : ""),
            "aria-pressed": fs,
            title: fs ? "退出全屏（或按 Esc）" : "把棋盘放大到整个屏幕（Esc 退出）",
            onClick: () => setFs((v) => !v),
          },
          fs ? "✕ 退出全屏" : "⛶ 全屏",
        ),
        h(
          "button",
          {
            type: "button",
            className: "msw-btn" + (flagMode ? " msw-flagmode-on" : ""),
            "aria-pressed": flagMode,
            title: flagMode
              ? "标记模式已开：左键点格 = 插旗/取消旗（再点一次关闭）"
              : "开启标记模式：左键点格即插旗（手机/触屏友好）",
            onClick: () => {
              flagTouchedRef.current = true; // 手动操作后不再被设置默认值覆盖
              setFlagMode((v) => !v);
            },
          },
          flagMode ? "🚩 标记模式：开" : "🚩 标记模式：关",
        ),
        h("select", {
          className: "msw-select",
          value: presetId,
          onChange: (e: { target: { value: string } }) => {
            if (e.target.value === "custom") setPresetId("custom");
            else switchPreset(e.target.value);
          },
        } as object, [
          ...PRESETS.map((p) => h("option", { key: p.id, value: p.id }, p.label)),
          h("option", { key: "custom", value: "custom" }, "自定义"),
        ]),
      ),
      presetId === "custom"
        ? h(
            "div",
            { className: "msw-row" },
            h("label", null, "行 "),
            h("input", {
              className: "msw-input",
              type: "number",
              min: 5,
              max: 30,
              value: custom.rows,
              onChange: (e: { target: { value: string } }) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setCustom((v) => ({ ...v, rows: n }));
              },
            }),
            h("label", null, "列 "),
            h("input", {
              className: "msw-input",
              type: "number",
              min: 5,
              max: 30,
              value: custom.cols,
              onChange: (e: { target: { value: string } }) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setCustom((v) => ({ ...v, cols: n }));
              },
            }),
            h("label", null, "雷 "),
            h("input", {
              className: "msw-input",
              type: "number",
              min: 0,
              value: custom.mines,
              onChange: (e: { target: { value: string } }) => {
                const n = parseInt(e.target.value, 10);
                if (Number.isFinite(n)) setCustom((v) => ({ ...v, mines: n }));
              },
            }),
            h("button", { type: "button", className: "msw-btn msw-btn-primary", onClick: startCustom }, "开始"),
            h("div", { className: "msw-err" }, formErr),
          )
        : null,
      h(
        "div",
        { className: "msw-board-wrap" + (flagMode ? " msw-flagmode" : "") },
        h(
          "div",
          {
            className: "msw-board",
            style: { gridTemplateColumns: `repeat(${b.cols}, minmax(0, 1fr))` },
          },
          b.cells.map((c, i) => {
            const cls = ["msw-cell"];
            let content: string = "";
            let n = -1;
            if (c.revealed) {
              cls.push("msw-open");
              if (c.mine) {
                content = "💣";
                if (i === b.lostAt) cls.push("msw-boom");
              } else if (c.adjacent > 0) {
                content = String(c.adjacent);
                n = c.adjacent;
              }
            } else if (b.state === "lost") {
              // 终局展示全部雷
              if (c.mine) {
                content = "💣";
                if (i === b.lostAt) cls.push("msw-boom");
              } else if (c.flagged) {
                cls.push("msw-wrongflag");
              }
            } else if (c.flagged) {
              cls.push("msw-flag");
            }
            if (n > 0) cls.push(`msw-n${n}`);
            if (c.mine && !c.revealed && b.state !== "lost") {
              // 未终局不显示未开的雷
            }
            return h("div", {
              key: i,
              className: cls.join(" "),
              role: "button",
              "aria-label": c.revealed ? `已开格` : "未开格",
              onPointerDown: (e: { clientX: number; clientY: number }) => onCellDown(i, e),
              onPointerMove: (e: { clientX: number; clientY: number }) => onCellMove(e),
              onPointerUp: (e: { button?: number }) => onCellUp(i, e),
              onPointerLeave: () => onCellLeave(),
              onContextMenu: (e: { preventDefault: () => void }) => onContext(i, e),
            }, content || null);
          }),
        ),
      ),
      h(
        "div",
        { className: "msw-hint" },
        (flagMode
          ? "标记模式：左键点格 = 插旗/取消旗 · 右键/长按同样可插旗 · 点表情重开"
          : "左键开格 · 右键/长按插旗🚩 · 点数字格和弦 · 点表情重开") +
          (fs ? " · Esc 退出全屏" : " · ⛶ 全屏看大盘（Esc 退出）"),
      ),
      h(
        "div",
        { className: "msw-stats" },
        ...(stats.plays === 0
          ? [h("span", { key: "empty" }, "暂无记录 · 打完一局自动记录")]
          : [
              h("span", { key: "best" }, "最佳 ", h("b", null, fmtMs(stats.bestMs))),
              h("span", { key: "wl" }, "🏆 ", h("b", null, `${stats.wins}胜 ${stats.plays - stats.wins}负`), ` · 共${stats.plays}局`),
            ]),
        h("button", { type: "button", className: "msw-link-btn", onClick: () => { if (window.confirm("清空当前难度的全部成绩？")) clearStats(); } }, "清空记录"),
      ),
    );
  }

  return { App };
}