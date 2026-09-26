#!/usr/bin/env node
/**
 * 双端 tsc --noEmit（Host：tsconfig.json；Client：tsconfig.client.json）。
 *
 * tsc 与 typeRoots 解析走共享的跨平台解析器（env → 同级 harness → DSH home profile），
 * **不含任何机器专属绝对路径**。
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildFallbackDirs, findTsc, findTypeRoots } from "./paths.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

// 各插件历史沿用的工具目录环境变量名；只有实际设置的那个会命中。
const dirs = buildFallbackDirs({
  importMetaUrl: import.meta.url,
  envKeys: ["SUD_TOOLS_DIR", "DRS_TOOLS_DIR", "MINES_TOOLS_DIR", "DSH_TOOLS_DIR"],
});

const tsPath = findTsc(root, dirs);
if (!tsPath) {
  console.error("[typecheck] 找不到 tsc（可设 DSH_HARNESS_ROOT 或在同级放置 deepseek-harness）");
  process.exit(1);
}

// 插件按布局红线不放 node_modules，tsconfig 的相对 typeRoots 解析不到；
// 用解析器找出的实际目录注入 --typeRoots。
const typeRoots = findTypeRoots(root, dirs);

let failed = false;
for (const cfg of ["tsconfig.json", "tsconfig.client.json"]) {
  const args = ["-p", root + "/" + cfg, "--noEmit"];
  if (typeRoots.length > 0) args.push("--typeRoots", typeRoots.join(","));
  const r = spawnSync(process.execPath, [tsPath, ...args], { encoding: "utf-8" });
  if (r.status !== 0) {
    console.error(`[typecheck] ${cfg} 失败（exit ${r.status}）`);
    if (r.stdout) console.error(r.stdout);
    if (r.stderr) console.error(r.stderr);
    failed = true;
  } else {
    console.log(`[typecheck] ${cfg} 通过（0 错误）`);
  }
}
process.exit(failed ? 1 : 0);
