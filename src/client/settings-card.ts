/**
 * dsh-minesweeper — v0.5 设置页卡片（spec D7/A13）。
 *
 * 形态：`plugins.bundle.config`（keyed，key = **包名** `dsh-minesweeper`）下的一张
 * 小型卡片，唯一字段「默认开启标记模式」（host settings 命名空间
 * `dsh-minesweeper.flagModeDefault`，经 settingsScope binder 读写）。
 *
 * 数据面：
 *   - scope 可用：读 `getSnapshot().value.flagModeDefault`，写 `scope.set`；
 *   - scope 不可用：卡片降级为只读提示（不崩、不误导）。
 * 颜色全部走 --dsw-* token（css.ts 的 .msw-card-* 规则）。
 */
type ReactLike = {
  createElement: (...args: unknown[]) => unknown;
  useState: <T>(init: T | (() => T)) => [T, (v: T | ((p: T) => T)) => void];
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => void;
};

/** settingsScope 绑定面（宿主 ui-settings 提供；缺失时为 null）。 */
export interface SettingsScopeLike {
  getSnapshot(): { status?: string; value?: Record<string, unknown> } | null;
  subscribe(listener: () => void): () => void;
  set(field: string, value: unknown): Promise<void>;
}

export interface SettingsCardDeps {
  React: ReactLike;
  /** 命名空间作用域；不可用时为 null。 */
  scope: SettingsScopeLike | null;
}

export interface SettingsCardUI {
  Card: (props: Record<string, unknown>) => unknown;
}

export function createSettingsCard(deps: SettingsCardDeps): SettingsCardUI {
  const { React: R, scope } = deps;
  const h = R.createElement as (t: unknown, p?: Record<string, unknown> | null, ...c: unknown[]) => unknown;

  const Card = function Card(_props: Record<string, unknown>) {
    const [ready, setReady] = R.useState(
      () => scope !== null && typeof scope.getSnapshot === "function",
    );
    const [flagModeDefault, setFlagModeDefault] = R.useState<boolean>(() => {
      if (!scope) return false;
      try {
        const snap = scope.getSnapshot();
        return Boolean(snap?.value?.flagModeDefault);
      } catch {
        return false;
      }
    });
    const [, setTick] = R.useState(0);

    R.useEffect(() => {
      if (!scope || typeof scope.subscribe !== "function") return;
      const un = scope.subscribe(() => {
        try {
          const snap = scope.getSnapshot();
          setFlagModeDefault(Boolean(snap?.value?.flagModeDefault));
        } catch {
          /* 快照异常：忽略，保持上一次值 */
        }
      });
      return () => {
      try {
          un();
        } catch {
          /* 卸载失败忽略 */
        }
      };
    }, []);

    async function onToggle(next: boolean): Promise<void> {
      setFlagModeDefault(next); // 乐观更新；失败回滚
      if (!scope) return;
      try {
        await scope.set("flagModeDefault", next);
      } catch {
        setFlagModeDefault(!next);
      }
    }

    if (!scope) {
      return h(
        "div",
        { className: "msw-card" },
        h("div", { className: "msw-card-title" }, "扫雷"),
        h("div", { className: "msw-card-note" }, "设置服务不可用，无法调整默认值（游戏功能不受影响）。"),
      );
    }

    return h(
      "div",
      { className: "msw-card" },
      h("div", { className: "msw-card-title" }, "扫雷"),
      h(
        "div",
        { className: "msw-card-row" },
        h("span", { className: "msw-card-label" }, "默认开启标记模式"),
        h("label", { className: "msw-switch" },
          h("input", {
            type: "checkbox",
            checked: flagModeDefault,
            onChange: (e: { target: { checked: boolean } }) => {
            void onToggle(e.target.checked);
          },
          "aria-label": "默认开启标记模式",
        }),
          h("span", { className: "msw-switch-track" }),
        ),
      ),
      h(
        "div",
        { className: "msw-card-note" },
        "开启后，每次打开「扫雷」标签时标记模式默认开启（左键点格 = 插旗/取消旗）；游戏内仍可随时手动切换。",
      ),
    );
  };

  return { Card };
}