#!/usr/bin/env node
/**
 * dsh-minesweeper 构建脚本：
 *   Host   → lib/index.js（Node ESM；node:* 与 @deepseek-ai/* external）
 *   Client → lib/client.js（浏览器 IIFE，经 window.__ModuleLoader__ 注册）
 * 用法：node scripts/build.mjs [--no-typecheck]
 *
 * 产物门禁（构建后立即执行，任一不过 → exit 1）：
 *   - 顶层布局卫生（禁止旧扁平残留 / node_modules 软链）
 *   - lib/index.js 动态 import 断言导出（name/apply/inject/VERSION，inject 必须为 []）
 *   - lib/client.js 断言 __ModuleLoader__ 注册 + 插件 id + 侧栏注册面
 */
import { createRequire } from "node:module";
import { buildFallbackDirs, findEsbuild, findTypeRoots } from "./paths.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

/* ---- 自举：host 产物 external 引用 @deepseek-ai/*（运行时由 DSH profile 提供）；
   从插件目录直跑门禁时解析不到 → 用 --import 预载钩子重跑自己。

   2026-09-23 修正：判定"本地能否解析"不能只看 createRequire，因为 `pnpm run/exec` 会注入
   NODE_PATH 指向 harness 的 vendor 目录 → 此处 resolve 成功（于是跳过钩子），但门禁里
   用动态 import() 加载 lib/index.js 时走的解析链又不含它 → ERR_MODULE_NOT_FOUND。
   （症状：`node scripts/build.mjs` 绿、`pnpm check` 红。）因此改成**总是**带钩子重跑一次，
   钩子只负责把 @deepseek-ai/* 指到确定含该包的 node_modules，对已可解析的环境也无害。 ---- */
if (!process.env.__DSH_MSW_PRELOAD) {
  const r = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(resolve(here, "../test/external-preload.mjs")).href, ...process.argv.slice(1)],
    { stdio: "inherit", env: { ...process.env, __DSH_MSW_PRELOAD: "1" } },
  );
  if (r.error) {
    console.error(`[gate] ✘ 无法带预载钩子重跑：${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 0);
}

const FALLBACK_DIRS = buildFallbackDirs({
  importMetaUrl: import.meta.url,
  envKeys: ["MINES_TOOLS_DIR"],
});

function loadTool(name) {
  const anchors = [
    here + "/x.js",
    root + "/x.js",
    ...FALLBACK_DIRS.map((d) => (d.endsWith("node_modules") ? d + "/x.js" : d + "/node_modules/x.js")),
  ];
  for (const a of anchors) {
    try {
      return createRequire(a)(name);
    } catch {
      /* 下一个锚点 */
    }
  }
  if (name === "esbuild") {
    for (const d of FALLBACK_DIRS) {
      const pnpm = d.replace(/node_modules$/, "node_modules/.pnpm");
      if (!existsSync(pnpm)) continue;
      for (const dir of readdirSync(pnpm).filter((x) => x.startsWith("esbuild@")).sort().reverse()) {
        const p = `${pnpm}/${dir}/node_modules/esbuild`;
        try {
          return createRequire(p + "/x.js")(p);
        } catch {
          /* 下一版本 */
        }
      }
    }
  }
  throw new Error(`找不到 ${name}（需 node_modules 中可解析 esbuild/typescript；harness 仓库需已 pnpm install）`);
}

const fail = (msg) => {
  console.error(`[gate] ✗ ${msg}`);
  process.exit(1);
};

/** 顶层布局卫生：禁止会污染 link 安装的旧扁平布局残留。 */
function checkLayoutHygiene() {
  const forbidden = [
    { path: root + "/index.ts", why: "顶层 index.ts（旧扁平布局残留；正确位置是 src/index.ts）" },
    { path: root + "/client.js", why: "顶层 client.js（旧扁平布局残留；正确位置是 lib/）" },
    { path: root + "/build.mjs", why: "顶层 build.mjs（旧扁平布局残留；正确位置是 scripts/）" },
    { path: root + "/client", why: "顶层 client/ 目录残留（旧扁平布局）" },
    { path: root + "/node_modules", why: "顶层 node_modules（会遮蔽 profile 依赖）" },
  ];
  const bad = forbidden.filter((f) => existsSync(f.path));
  for (const f of bad) {
    let kind = "文件/目录";
    try {
      if (statSync(f.path).isSymbolicLink()) kind = "软链";
    } catch {
      /* ignore */
    }
    console.error(`[gate] ✗ 顶层布局卫生：发现${kind} ${f.path}`);
    console.error(`      ${f.why}`);
  }
  if (bad.length > 0) {
    console.error("[gate] 请先清理残留再构建（link 安装会把它们带进 profile）。");
    process.exit(1);
  }
  console.log("[gate] 顶层布局卫生 ✔");
}

/** 产物门禁：双产物存在、host 可加载且导出齐全、client 注册面完整。 */
async function verifyArtifacts() {
  const hostFile = root + "/lib/index.js";
  const clientFile = root + "/lib/client.js";
  for (const f of [hostFile, clientFile]) {
    if (!existsSync(f)) fail(`缺少构建产物 ${f}（旧布局？请完整重建）`);
    if (statSync(f).size <= 0) fail(`构建产物为空 ${f}`);
  }

  // 版本单一事实源 = package.json；以下版本断言都由它推导，避免「门禁里写死版本号」漏检。
  // 教训：v0.5.2 之前门禁只查 host VERSION 与客户端徽章字面量，`src/client/entry.ts` 的
  // `pluginExports.VERSION` 长期停在 0.1.0 而门禁全绿（sudoku 同样漏过，已一并补断言）。
  const pkgVersion = JSON.parse(readFileSync(root + "/package.json", "utf-8")).version;
  const entrySrc = readFileSync(root + "/src/client/entry.ts", "utf-8");
  if (!entrySrc.includes(`pluginExports.VERSION = "${pkgVersion}"`)) {
    fail(`src/client/entry.ts 的 pluginExports.VERSION 应与 package.json 同步为 "${pkgVersion}"`);
  }

  // host：动态 import 断言导出（loader 加载的就是这个入口）。
  try {
    const m = await import(pathToFileURL(hostFile).href + "?gate=" + Date.now());
    for (const k of ["apply", "inject", "name", "VERSION"]) {
      if (!(k in m)) fail(`lib/index.js 缺少导出 ${k}`);
    }
    if (m.name !== "minesweeper") fail(`lib/index.js 的 name 应为 "minesweeper"，实际 ${JSON.stringify(m.name)}`);
    if (m.VERSION !== pkgVersion) fail(`lib/index.js 的 VERSION 应为 ${pkgVersion}（= package.json），实际 ${m.VERSION}`);
    if (!Array.isArray(m.inject) || m.inject.length !== 2 || !m.inject.includes("webServer") || !m.inject.includes("settings")) {
      fail(`lib/index.js 的 inject 应含 webServer+settings（v0.5），实际 ${JSON.stringify(m.inject)}`);
    }
  } catch (e) {
    fail(`lib/index.js 无法加载：${String(e)}`);
  }

  // client：注册面文本断言。
  const clientSrc = readFileSync(clientFile, "utf-8");
  if (!clientSrc.includes("__ModuleLoader__")) fail("lib/client.js 未注册 window.__ModuleLoader__");
  if (!clientSrc.includes("dsh-minesweeper")) fail("lib/client.js 未包含插件 id dsh-minesweeper");
  if (!clientSrc.includes("sidebarRightTabs")) fail("lib/client.js 未注册 sidebarRightTabs（右侧栏标签）");
  if (!clientSrc.includes("sidebar.right.pane.tab")) fail("lib/client.js 未注册 sidebar.right.pane.tab（标签主体）");
  if (!clientSrc.includes(`dsh-minesweeper v${pkgVersion}`)) {
    fail(`lib/client.js 缺少版本徽章字面量 dsh-minesweeper v${pkgVersion}（= package.json）`);
  }
  console.log("[gate] 产物可加载 ✔（host 导出齐全 + client 注册面完整 + 版本三处一致）");
}

const noTypecheck = process.argv.includes("--no-typecheck");
checkLayoutHygiene();

const esbuild = loadTool("esbuild");

await Promise.all([
  esbuild.build({
    entryPoints: [root + "/src/index.ts"],
    outfile: root + "/lib/index.js",
    bundle: true,
    format: "esm",
    platform: "node",
    target: "es2022",
    charset: "utf8",
    external: ["node:*", "@deepseek-ai/*"],
    logLevel: "warning",
  }),
  esbuild.build({
    entryPoints: [root + "/src/client/entry.ts"],
    outfile: root + "/lib/client.js",
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2022",
    charset: "utf8",
    logLevel: "warning",
  }),
]);
console.log("[build] lib/index.js + lib/client.js 已生成");

await verifyArtifacts();

if (!noTypecheck) {
  // 复用与 esbuild 相同的锚点链（env → 同级 harness → DSH profile 农场）。
  // 原实现只查 `<插件>/node_modules/typescript/bin/tsc`，而本插件按布局红线**不放**
  // node_modules ⇒ 该路径永不成立，`npm run check` 在未装本地依赖的机器上恒失败
  // （2026-09-25 实测：`[gate] ✗ 找不到 tsc`）。
  // 另：用当前 Node 执行 `lib/tsc.js` 而不是 `bin/tsc` —— 后者是无扩展名的 Node 脚本，
  // Windows 上直接 spawn 会 ENOENT。
  const tsPath = (() => {
    const anchors = [
      here + "/x.js",
      root + "/x.js",
      ...FALLBACK_DIRS.map((d) => (d.endsWith("node_modules") ? d + "/x.js" : d + "/node_modules/x.js")),
    ];
    for (const a of anchors) {
      try {
        const pkg = createRequire(a).resolve("typescript/package.json");
        const libTsc = pkg.replace(/[\\/]package\.json$/, "") + "/lib/tsc.js";
        if (existsSync(libTsc)) return libTsc;
      } catch {
        /* 下一个锚点 */
      }
    }
    return "";
  })();
  if (!tsPath) fail("找不到 tsc（需 harness 仓库已 pnpm install，或设置 MINES_TOOLS_DIR）");
  // @types 解析：本插件按布局红线不放 node_modules，`@types/node` 只在 harness / DSH profile 层，
  // 而 tsconfig 里的 typeRoots 只能写相对路径 ⇒ 必须由这里显式传入，否则报
  // `TS2688: Cannot find type definition file for 'node'`。已存在的本地 @types 排在首位。
  const typeRoots = findTypeRoots(root, FALLBACK_DIRS);
  for (const cfg of ["tsconfig.json", "tsconfig.client.json"]) {
    const args = [tsPath, "-p", root + "/" + cfg, "--noEmit"];
    if (typeRoots.length) args.push("--typeRoots", typeRoots.join(","));
    const r = spawnSync(process.execPath, args, { encoding: "utf-8" });
    if (r.status !== 0) {
      console.error(`[typecheck] ${cfg} 失败（exit ${r.status}）`);
      if (r.error) console.error(r.error.message);
      if (r.stdout) console.error(r.stdout);
      if (r.stderr) console.error(r.stderr);
      process.exit(1);
    }
    console.log(`[typecheck] ${cfg} 通过（0 错误）`);
  }
}
console.log("[build] 完成（门禁全部通过）");