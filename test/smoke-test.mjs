#!/usr/bin/env node
/**
 * 冒烟测试：不依赖 DSH 运行时，只验证构建产物的安装前契约。
 *   - host 产物：可加载、导出齐全（name/inject/VERSION/apply）
 *   - client 产物：经 __ModuleLoader__ 注册、插件 id、侧栏注册面齐全、未打包第二份 React
 *   - cordis.patch.yml 声明的插件 id 与 host 导出一致
 * 用法：node test/smoke-test.mjs（需先跑过 build）
 *
 * 自举：host 产物 external 引用 @deepseek-ai/*（运行时由 DSH profile 提供）；
 * 本脚本从插件目录直跑时解析不到 → 若本地无法解析则自动以
 * `node --import test/external-preload.mjs` 重跑自己（把 @deepseek-ai/*
 * 解析固定到 harness node_modules，与构建工具同一约定）。
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

/* ---- 自举：总是带预载钩子重跑自己（只跳一次）。

   2026-09-23 修正：原来只在"本地解析不到"时才带钩子；但 `pnpm run/check` 会注入 NODE_PATH
   指向 harness vendor，使这里的 createRequire().resolve() 成功 → 跳过钩子，而后续
   `import(lib/index.js)` 的解析链又不含它 → ERR_MODULE_NOT_FOUND
   （症状：`node test/smoke-test.mjs` 绿、`pnpm check` 红）。改为无条件带钩子重跑。 ---- */
if (!process.env.__DSH_MSW_PRELOAD) {
  const r = spawnSync(
    process.execPath,
    ["--import", pathToFileURL(resolve(dirname(fileURLToPath(import.meta.url)), "external-preload.mjs")).href, ...process.argv.slice(1)],
    { stdio: "inherit", env: { ...process.env, __DSH_MSW_PRELOAD: "1" } },
  );
  if (r.error) {
    console.error(`✘ 无法带预载钩子重跑：${r.error.message}`);
    process.exit(1);
  }
  process.exit(r.status ?? 0);
}

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const hostFile = root + "/lib/index.js";
const clientFile = root + "/lib/client.js";
const pkgPath = root + "/package.json";
const patchPath = root + "/cordis.patch.yml";

let pass = 0;
let fail = 0;
function check(name, ok, extra = "") {
  if (ok) {
    pass++;
  } else {
    fail++;
    console.error(`✘ ${name}${extra ? " — " + extra : ""}`);
  }
}

/* ---- 前置：产物存在 ---- */
for (const f of [hostFile, clientFile, pkgPath, patchPath]) {
  if (!existsSync(f)) {
    console.error(`✘ 缺少 ${f}（请先运行 node scripts/build.mjs）`);
    process.exit(1);
  }
}

/* ---- host 产物 ---- */
const host = await import(pathToFileURL(hostFile).href + "?smoke=" + Date.now());
check("host: 导出 name === 'minesweeper'", host.name === "minesweeper", `实际 ${JSON.stringify(host.name)}`);
check("host: 导出 VERSION", typeof host.VERSION === "string" && host.VERSION.length > 0, String(host.VERSION));
check(
  "host: inject 含 webServer+settings（v0.5）",
  Array.isArray(host.inject) && host.inject.includes("webServer") && host.inject.includes("settings"),
  JSON.stringify(host.inject),
);
check("host: apply 是函数", typeof host.apply === "function");
check("host: 导出设置命名空间 dsh-minesweeper", host.SETTINGS_NAMESPACE === "dsh-minesweeper");

const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
check(
  "host: VERSION 与 package.json 同步",
  host.VERSION === pkg.version,
  `host=${host.VERSION} pkg=${pkg.version}`,
);
check(
  "package.json: dsh.bundle.patch 指向 cordis.patch.yml",
  pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === "./cordis.patch.yml",
);
check(
  "package.json: dsh.client.platform === web",
  pkg.dsh && pkg.dsh.client && pkg.dsh.client.platform === "web",
);
check("package.json: main 指向 lib/index.js", pkg.main === "./lib/index.js");
check(
  "package.json: exports./client 指向 lib/client.js",
  pkg.exports && pkg.exports["./client"] === "./lib/client.js",
);

/* ---- cordis.patch.yml 与 host 的 id 一致 ---- */
const patch = readFileSync(patchPath, "utf-8");
check("cordis.patch.yml: 声明 dsh-minesweeper 插件", /dsh-minesweeper/.test(patch));
check("cordis.patch.yml: 声明的插件 id 为 minesweeper", /\bid:\s*minesweeper\b/.test(patch));

/* ---- client 产物 ---- */
const clientSrc = readFileSync(clientFile, "utf-8");
check("client: 经 __ModuleLoader__ 注册", clientSrc.includes("__ModuleLoader__"));
check("client: 含插件 id dsh-minesweeper", clientSrc.includes("dsh-minesweeper"));
check("client: 注册 sidebarRightTabs", clientSrc.includes("sidebarRightTabs"));
check("client: 注册 sidebar.right.pane.tab", clientSrc.includes("sidebar.right.pane.tab"));
check("client: 含标签引导 guide", clientSrc.includes("guide"));
check(
  "client: 通过 ModuleLoader require react（未打包第二份 React）",
  /require\d*\("react"\)/.test(clientSrc),
);
check("client: 未打包 React 运行时", !clientSrc.includes("ReactCurrentOwner"));
check("client: 使用主题 token 而非硬编码色值", clientSrc.includes("--dsw-alias-") && !/#[0-9a-fA-F]{6}\b/.test(clientSrc));
check("client: 含 v0.2 标记模式开关", clientSrc.includes("标记模式"));
check("client: 含操作提示行", clientSrc.includes("msw-hint"));
check("client: v0.3 全屏（msw-fs）", clientSrc.includes("全屏") && clientSrc.includes("msw-fs"));
check("client: v0.3 表头带标签（剩余雷/用时）", clientSrc.includes("剩余雷") && clientSrc.includes("用时"));
check("client: v0.3 成绩胜负语义（胜/负/暂无记录）", clientSrc.includes("暂无记录") && clientSrc.includes("胜"));

/* ---- v0.5：host 状态 API + 设置卡片 ---- */
check("host: 产物含状态 API 路径", clientSrc.includes("/api/dsh-minesweeper/stats") || readFileSync(hostFile, "utf-8").includes("/api/dsh-minesweeper/stats"));
check("client: 含 host 状态 API 调用路径", clientSrc.includes("/api/dsh-minesweeper/stats"));
check("client: 注册 plugins.bundle.config（插件页配置区，key = 包名）", clientSrc.includes("plugins.bundle.config"));
check("client: 不再依赖 settingsScope 服务（0.1.7 已移除），改走插件自有 REST API", !clientSrc.includes("settingsScope") && clientSrc.includes("/api/dsh-minesweeper"));
check("client: 含默认标记模式开关文案", clientSrc.includes("默认开启标记模式"));
check("host: 导出 resolveStateFile", typeof host.resolveStateFile === "function");
check("host: state 目录形如 profiles/<profile>/dsh-minesweeper", /profiles\/.*\/dsh-minesweeper/.test(host.resolveStateFile.call({ env: { DSH_HOME: "/tmp/fake-home", HOME: "/h" } })));

console.log(fail === 0 ? `smoke：${pass} 项全部通过` : `smoke：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);