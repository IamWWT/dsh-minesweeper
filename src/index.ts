/**
 * dsh-minesweeper — Host 入口（Node 侧，v0.5）。
 *
 * 职责（spec §8 D6/D7）：
 *   - settings 命名空间 `dsh-minesweeper`（`flagModeDefault`，设置卡片绑定）；
 *   - 状态文件 `$DSH_HOME/profiles/<profile>/dsh-minesweeper/stats.json`（成绩权威源）；
 *   - 路由 `/api/dsh-minesweeper/stats`（GET/PUT/DELETE，见 host/routes.ts）。
 *
 * 注意：入口必须用具名导出（`export const name` 等），禁止 `export default`
 * （default export 会丢 inject 声明，见 postmortem 0001）。
 */
import z from "@deepseek-ai/schemastery";
import { resolveStateDir } from "./host/state.ts";
import { registerStatsRoutes } from "./host/routes.ts";
import { dshHome } from "./shared/dsh-home.ts";

export const name = "minesweeper";

/** v0.5 起 host 依赖 webServer（路由）+ settings（0.1.7 SettingsForms 服务）。 */
export const inject = ["webServer", "settings"];

/** 五处同步之一（package.json / 构建门禁 / README / ui.ts 徽章 / 本文件）。 */
export const VERSION = "0.5.3";

/** 设置命名空间（client 卡片注册在 `plugins.bundle.config`，key = **包名** `dsh-minesweeper`）。 */
export const SETTINGS_NAMESPACE = "dsh-minesweeper";

/** 设置 schema：扁平单字段（设置页可直接平铺渲染）。 */
export const MinesweeperSettingsSchema = z.object({
  flagModeDefault: z.boolean().default(false),
});

/** 插件行配置：0.1.7 原生设置面 = 本条目的 volatile 字段 `gameSettings`
 * （旧 `settings.register("dsh-minesweeper")` 命名空间已随 0.1.7 移除）。 */
export const Config = z.object({
  gameSettings: MinesweeperSettingsSchema.default({}).volatile(),
});

export interface MinesweeperSettings {
  flagModeDefault: boolean;
}

/** 0.1.7 settings 服务最小契约（SettingsForms：describe/mutate）。 */
interface SettingsServiceLike {
  describe?: () => Array<{ ns?: string; revision?: number }>;
  mutate?: (
    ns: string,
    ops: Array<{ op: "set" | "unset"; path: string[]; value?: unknown }>,
    expectedRevision?: number,
  ) => Promise<unknown>;
}

interface SettingsWriteInput {
  fields?: Record<string, unknown>;
  clear?: string[];
  expectedRevision?: number;
}

/** 设置写入门面（路由层复用；0.1.7 原生路径）。 */
interface SettingsFacade {
  getSettings(): { flagModeDefault: boolean };
  currentRevision(): number;
  write(input: SettingsWriteInput): Promise<{ revision: number }>;
  watch(timeoutMs: number): Promise<{ changed: boolean; revision: number }>;
}

interface HostContext {
  webServer?: {
    register?: (r: { kind: string; path: string; handler: (req: unknown, res: unknown) => Promise<void> }) => void;
  } | null;
  /** 0.1.7：settings 为服务名，经 ctx.get 解析（旧 c.settings 属性访问已移除）。 */
  get?: (key: string) => unknown;
  on?: (event: string, listener: (...args: unknown[]) => void) => () => void;
  fiber?: { entry?: { options?: { id?: string } } };
  effect?: (fn: () => (() => void) | void, label?: string) => void;
}

/** 状态文件路径：`$DSH_HOME/profiles/<profile>/dsh-minesweeper/stats.json`。 */
export function resolveStateFile(): string {
  const home = dshHome();
  const profile = process.env.DSH_PROFILE || "web";
  return `${resolveStateDir(home, profile)}/stats.json`;
}

/**
 * 0.1.7 原生设置面：
 *   读 = 插件行 volatile 字段 `gameSettings`（loader 维护当前值）；
 *   写 = settings 服务 mutate（ns = 本插件 entry id，路径 ["gameSettings", key]，落用户层）；
 *   热更新 = loader/volatile-update（paths[0]==="gameSettings"）。
 * settings 服务缺失时只读降级（默认值），游戏与路由不受影响。
 */
function createSettingsCore(c: HostContext, config: { gameSettings?: { get?: () => Partial<{ flagModeDefault: boolean }> } } | undefined) {
  const settingsService = (typeof c.get === "function" ? c.get("settings") : undefined) as SettingsServiceLike | null | undefined;
  const settingsNs = c.fiber?.entry?.options?.id || SETTINGS_NAMESPACE;

  const getSettings = (): { flagModeDefault: boolean } => {
    try {
      const doc = (typeof config?.gameSettings?.get === "function" ? config.gameSettings.get() : undefined) ?? {};
      return { flagModeDefault: Boolean(doc.flagModeDefault) };
    } catch {
      return { flagModeDefault: false };
    }
  };

  const currentRevision = (): number => {
    try {
      const rows = settingsService?.describe?.() ?? [];
      const row = rows.find((r) => r?.ns === settingsNs);
      return typeof row?.revision === "number" ? row.revision : 0;
    } catch {
      return 0;
    }
  };

  const facade: SettingsFacade = {
    getSettings,
    currentRevision,
    async write(input: SettingsWriteInput) {
      for (const key of Object.keys(input.fields ?? {})) {
        if (key !== "flagModeDefault") throw new Error(`未知设置项：${key}`);
      }
      for (const key of input.clear ?? []) {
        if (key !== "flagModeDefault") throw new Error(`未知设置项：${key}`);
      }
      const ops: Array<{ op: "set" | "unset"; path: string[]; value?: unknown }> = [
        ...Object.entries(input.fields ?? {}).map(([k, v]) => ({ op: "set" as const, path: ["gameSettings", k], value: v })),
        ...(input.clear ?? []).map((k) => ({ op: "unset" as const, path: ["gameSettings", k], value: undefined })),
      ];
      if (ops.length === 0) throw new Error("fields/clear 至少其一");
      if (!settingsService?.mutate) throw new Error("settings 服务不可用，无法保存");
      await settingsService.mutate(settingsNs, ops, input.expectedRevision);
      return { revision: currentRevision() };
    },
    watch(timeoutMs: number) {
      return new Promise((resolve) => {
        let settled = false;
        const finish = (changed: boolean): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          off();
          resolve({ changed, revision: currentRevision() });
        };
        const timer = setTimeout(() => finish(false), Math.max(2000, Math.min(timeoutMs, 25_000)));
        const off = typeof c.on === "function"
          ? c.on("loader/volatile-update", (paths: unknown) => {
              const list = Array.isArray(paths) ? (paths as string[][]) : [];
              if (list.some((p) => p?.[0] === "gameSettings")) finish(true);
            })
          : () => {};
      });
    },
  };
  return { getSettings, facade };
}

export function apply(ctx: unknown, config?: { gameSettings?: { get?: () => Partial<{ flagModeDefault: boolean }> } }): void {
  const c = ctx as HostContext;
  const stateFile = resolveStateFile();

  /* ---- 0.1.7 原生设置面（服务缺失时 getSettings 仍可用，返回默认值） ---- */
  const { getSettings, facade } = createSettingsCore(c, config);

  /* ---- 路由（无 webServer 时静默跳过：插件在非 web profile 仍可加载） ---- */
  const register = (): void => {
    if (!c.webServer || typeof c.webServer.register !== "function") return;
    registerStatsRoutes(c.webServer, {
      stateFile,
      getSettings: () => getSettings(),
      version: VERSION,
      settingsFacade: facade,
    });
  };

  if (typeof c.effect === "function") {
    c.effect(() => {
      register();
    }, "dsh-minesweeper: routes");
  } else {
    register();
  }
}