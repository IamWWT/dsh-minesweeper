/**
 * dsh-minesweeper — Client 入口（浏览器侧，DSH ModuleLoader 握手）。
 *
 * 注册（T1 占位版；T3/T4 补全 UI 与长按/和弦交互）：
 *   ① `sidebarRightTabs.register`：右侧栏「🎮 扫雷」标签
 *      （kind=minesweeper，guide order=41，避开既有插件占用的 21/22/23/30–35）；
 *   ② `sidebar.right.pane.tab`（key `dsh-minesweeper`）：标签主体（GameApp）；
 *   ③ 不自动 openTab（D2：经指南页手动打开，不打扰主对话面）。
 *
 * 硬约束：
 *   - React 只能经 factory 的 require 取得（宿主注入），禁止 bundle 第二份 React；
 *   - 禁止声明与核心同名的子插槽（会 "slot is already declared" 崩加载）；
 *   - 颜色一律走 --dsw-* 主题 token（见 css.ts），禁止写死色值。
 */
import { createGameUI } from "./ui.ts";
import { createSettingsCard, type SettingsScopeLike } from "./settings-card.ts";
import { createApiSettingsScope } from "./settings-api.ts";
import { CSS_TEXT } from "./css.ts";

declare global {
  interface Window {
    __ModuleLoader__?: {
      load: (reg: { id: string; factory: (require: (m: string) => unknown) => unknown }) => void;
    };
  }
}

type RequireFn = (id: string) => any;

window.__ModuleLoader__?.load({
  id: "dsh-minesweeper",
  factory: (require: RequireFn) => {
    const React = require("react") as any;
    const ui = createGameUI(React);
    const App = ui.App as unknown as (props: Record<string, unknown>) => unknown;
    const pluginExports: Record<string, unknown> = {};

    pluginExports.name = "minesweeper";
    // client 侧 ctx 依赖：slots（标签主体 + 设置卡片）+ sidebarRightTabs（标签类型）
    // + settingsScope（设置卡片读写命名空间，缺失时卡片降级只读提示）。
    // 0.1.7：settingsScope 服务已移除；设置卡片改走插件自有 REST API（settings-api.ts）。
    pluginExports.inject = ["slots", "sidebarRightTabs"];
    pluginExports.VERSION = "0.5.3";

    pluginExports.apply = function apply(ctx: any): void {
      const get = (k: string) => (ctx && typeof ctx.get === "function" ? ctx.get(k) : undefined);
      const srt = get("sidebarRightTabs") as
      | { register?: (def: object) => void }
      | undefined;
      const slots = get("slots") as
      | { inject: (name: string, f: () => unknown) => () => void; register: (o: object, f: (p?: unknown) => unknown) => () => void }
      | undefined;
      if (!srt?.register || !slots) return;

      // 设置卡片数据面：插件自有 REST API（/api/dsh-minesweeper/settings*），0.1.7 原生。
      const scope = createApiSettingsScope("/api/dsh-minesweeper") as unknown as SettingsScopeLike;
      const { Card: SettingsCard } = createSettingsCard({ React: React as never, scope });

      // 阶段一：登记标签类型（必须在 apply 顶层，不进 effect）。
      srt.register({
        id: "dsh-minesweeper",
        kind: "minesweeper",
        priority: "extension",
        title: () => "🎮 扫雷",
        guide: [
          {
            order: 41,
            title: () => "扫雷",
            description: () => "经典扫雷：首点安全 / 插旗 / 和弦；三档 + 自定义网格",
          },
        ],
      });

      // 阶段二：样式 + 标签主体（effect 生命周期自动回收）。
      ctx.effect?.(() => {
        const styleEl = document.createElement("style");
        styleEl.id = "msw-style";
        styleEl.textContent = CSS_TEXT;
        document.head.appendChild(styleEl);
        const disps: (() => void)[] = [
          () => {
            styleEl.remove();
          },
        ];
        const d = slots.inject("sidebar.right.pane.tab", () =>
          slots.register(
            { name: "sidebar.right.pane.tab", key: "dsh-minesweeper", inject: () => ({}) },
            () => React.createElement(App, {}),
          ),
        );
        if (typeof d === "function") disps.push(d as () => void);

        // 插件页配置区（v0.6）：`plugins.bundle.config`，key = **包名**。
        // 上游 0.1.7-rc.1（commit 90af3110b7，2026-09-16）退役了旧槽
        // `settings.plugin.item`；注册到退役槽位不报错但永不渲染（表现为卡片凭空消失）。
        const dc = slots.inject("plugins.bundle.config", () =>
          slots.register(
            { name: "plugins.bundle.config", key: "dsh-minesweeper" },
            (props?: unknown) =>
              ((props as { view?: string } | undefined)?.view === "page"
                ? React.createElement(SettingsCard as () => unknown, {})
                : null),
          ),
        );
        if (typeof dc === "function") disps.push(dc as () => void);
        return () => {
          for (const x of disps) x();
        };
      });
    };

    return pluginExports;
  },
});

export {};