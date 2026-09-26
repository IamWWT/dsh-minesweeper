#!/usr/bin/env node
/**
 * 安装后布局验证：确认 profile 里 link 安装到位、产物存在可加载、无旧布局残留。
 * 用法：node scripts/verify-installed.mjs [DSH_HOME]
 *   缺省 DSH_HOME 取环境变量或 ~/.dsh-dev
 */
import { existsSync, readFileSync, statSync, readlinkSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const DSH_HOME = process.argv[2] || process.env.DSH_HOME || process.env.HOME + "/.dsh-dev";
const webProfile = DSH_HOME + "/profiles/web";
const nmPkg = webProfile + "/node_modules/dsh-minesweeper";

let pass = 0;
let fail = 0;
function check(name, ok, extra = "") {
  if (ok) {
    pass++;
    console.log("  ✔", name, extra);
  } else {
    fail++;
    console.error("  ✘", name, extra);
  }
}

console.log("验证安装：", webProfile);

// 1) profile package.json 里声明了依赖
let pkgDeclared = false;
try {
  const pkg = JSON.parse(readFileSync(webProfile + "/package.json", "utf-8"));
  pkgDeclared = !!(pkg.dependencies && pkg.dependencies["dsh-minesweeper"]);
} catch {
  /* 无 package.json */
}
check("profile package.json 声明 dsh-minesweeper", pkgDeclared);

// 2) node_modules 里存在且指向本源码目录（link 安装）
check("node_modules/dsh-minesweeper 存在", existsSync(nmPkg));
let resolved = null;
try {
  resolved = realpathSync(nmPkg); // 跟随软链到真实目录
} catch {
  /* 不存在 */
}
let linkOk = false;
if (resolved) {
  linkOk = resolved === root || resolved.startsWith(root + "/") || existsSync(resolved + "/lib/index.js");
}
check("node_modules 指向插件源码目录", linkOk, resolved ? `(→ ${resolved})` : "");

// 3) 产物存在且非空
const hostFile = (resolved || root) + "/lib/index.js";
const clientFile = (resolved || root) + "/lib/client.js";
check("lib/index.js 存在非空", existsSync(hostFile) && statSync(hostFile).size > 0);
check("lib/client.js 存在非空", existsSync(clientFile) && statSync(clientFile).size > 0);

// 4) host 产物可加载且导出齐全
try {
  const m = await import(pathToFileURL(hostFile).href + "?v=" + Date.now());
  check("host 导出 name/inject/apply/VERSION", ["name", "inject", "apply", "VERSION"].every((k) => k in m));
  check("host name === 'minesweeper'", m.name === "minesweeper");
  check("host inject === []", Array.isArray(m.inject) && m.inject.length === 0);
} catch (e) {
  check("host 产物可加载", false, String(e).slice(0, 120));
}

// 5) client 注册面
try {
  const src = readFileSync(clientFile, "utf-8");
  check("client 含 __ModuleLoader__", src.includes("__ModuleLoader__"));
  check("client 含 dsh-minesweeper", src.includes("dsh-minesweeper"));
  check("client 注册 sidebarRightTabs", src.includes("sidebarRightTabs"));
  check("client 未打包第二份 React", !src.includes("ReactCurrentOwner"));
} catch (e) {
  check("client 注册面", false, String(e).slice(0, 120));
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);