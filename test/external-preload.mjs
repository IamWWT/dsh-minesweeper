/**
 * dsh-minesweeper — ESM 外部包解析钩子（--import 预载）。
 *
 * 背景：host 产物 `lib/index.js` 以 external 方式 import `@deepseek-ai/*`
 * （运行时由 DSH profile 的 node_modules 提供）。构建门禁/冒烟从**插件目录**
 * 直接 `import(lib/index.js)` 时，Node 从插件目录向上解析不到这些包
 * （本插件按布局红线不放 node_modules）。此钩子把 `@deepseek-ai/*` 的解析
 * 固定到一个确定含该包的 node_modules（默认取共享解析器的候选目录，
 * 可用 DSH_MSW_NODE_MODULES 覆盖）。
 *
 * 用法：`node --import <本文件> <script>`；build.mjs / smoke-test.mjs
 * 会自动 re-exec 自己（见各自文件头），无需手工加参数。
 */
import { register, createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildFallbackDirs } from "../scripts/paths.mjs";

/**
 * 选一个「能真正解析到 @deepseek-ai/*」的 node_modules 作为解析基准。
 *
 * <p>判据不能只是「存在 `@deepseek-ai` 目录」：harness monorepo 根的 `node_modules`
 * 也有该目录，但里面只有 workspace 内的包、**没有** `schemastery` 这类 peer 依赖，
 * 选中它会让门禁报 `Cannot find package '@deepseek-ai/schemastery'`
 * （2026-09-25 实测踩坑）。故按「能否解析到 schemastery」来挑——它是本插件
 * 与同批插件通用的 peer 依赖，能解析到它说明该目录是完整的 DSH profile 依赖层。
 */
function pickBase() {
  if (process.env.DSH_MSW_NODE_MODULES) return process.env.DSH_MSW_NODE_MODULES;
  const dirs = buildFallbackDirs({ importMetaUrl: import.meta.url, envKeys: ["DSH_MSW_TOOLS_DIR"] });
  const canResolve = (d) => {
    try {
      createRequire(join(d, "x.js")).resolve("@deepseek-ai/schemastery");
      return true;
    } catch {
      return false;
    }
  };
  for (const d of dirs) {
    if (canResolve(d)) return d;
  }
  // 退一步：至少含 @deepseek-ai 目录（让后续解析按原样报错，语义保持可见）
  for (const d of dirs) {
    if (existsSync(join(d, "@deepseek-ai"))) return d;
  }
  // 兜底：取第一个候选
  return dirs[0] ?? "";
}

const BASE = pickBase();

register(
  `data:text/javascript,
    import { createRequire } from "node:module";
    import { pathToFileURL } from "node:url";
    const BASE = ${JSON.stringify(BASE)};
    const req = createRequire(BASE + "/package.json");
    export async function resolve(specifier, context, next) {
      if (specifier.startsWith("@deepseek-ai/")) {
        try {
          return { url: pathToFileURL(req.resolve(specifier)).href, shortCircuit: true };
        } catch {
          /* 解析不到 → 走默认解析（报错语义保持原样） */
        }
      }
      return next(specifier, context);
    }
  `,
  import.meta.url,
);
