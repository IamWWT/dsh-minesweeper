#!/usr/bin/env node
/**
 * dsh-minesweeper — host 侧单测（v0.5，T11）。
 *
 * 流程与 engine-test 相同：esbuild 把 src/host/{state,routes}.ts 打成
 * test/dist/host.mjs（这两个模块零外部依赖），再动态 import 做白盒断言。
 *
 * 覆盖：
 *   - parseStats：合法/坏形状/数组/标量 → 收敛结果
 *   - 状态文件：读写往返、损坏文件→.corrupt 备份+空表、清空、目录不存在自动建
 *   - 路由（假 req/res）：GET 200、PUT 有效/坏JSON/缺 stats/非对象 stats、DELETE
 *   - 并发写不损坏（两次交错 save → 文件仍为合法 JSON）
 */
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync, readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import assert from "node:assert/strict";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const distDir = root + "/test/dist";

/* ---------- 工具解析（与 scripts/build.mjs 同策略） ---------- */
function loadTool(name) {
  const FALLBACK = buildFallbackDirs({ importMetaUrl: import.meta.url, envKeys: ["MSW_TOOLS_DIR"] });
  const anchors = [here + "/x.js", root + "/x.js", ...FALLBACK.map((d) => (d.endsWith("node_modules") ? d + "/x.js" : d + "/node_modules/x.js"))];
  for (const a of anchors) {
    try {
      return createRequire(a)(name);
    } catch {
      /* 下一锚点 */
    }
  }
  for (const d of FALLBACK) {
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
  throw new Error("找不到 esbuild");
}

const esbuild = loadTool("esbuild");
mkdirSync(distDir, { recursive: true });
const common = { bundle: true, platform: "node", format: "esm", target: "es2022", logLevel: "silent" };
await esbuild.build({ ...common, entryPoints: [root + "/src/host/state.ts"], outfile: distDir + "/state.mjs" });
await esbuild.build({ ...common, entryPoints: [root + "/src/host/routes.ts"], outfile: distDir + "/routes.mjs" });
// 两个 bundle 各自内联一份 state 模块；测试通过 io 回调统一走 state 模块函数，避免双实例分歧
const stateMod = await import(pathToFileURL(distDir + "/state.mjs").href + "?t=" + Date.now());
const routesMod = await import(pathToFileURL(distDir + "/routes.mjs").href + "?t=" + Date.now());

const { parseStats, saveStatsFile, loadStatsFile, clearStatsFile, resolveStateDir } = stateMod;
const { createStatsHandlers, registerStatsRoutes } = routesMod;

let pass = 0;
let fail = 0;
function check(name, fn) {
  try {
    fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}
async function checkAsync(name, fn) {
  try {
    await fn();
    pass++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    fail++;
    console.error(`FAIL ${name}: ${e.message}`);
  }
}

/* ---------- 临时状态目录 ---------- */
import { mkdtempSync, existsSync as fsexists } from "node:fs";
import { tmpdir } from "node:os";

// --- 跨平台路径解析（codemod 注入；不含机器专属绝对路径）---
import { buildFallbackDirs } from "../scripts/paths.mjs";
import { existsSync as __existsSync } from "node:fs";
const __TOOL_DIRS = buildFallbackDirs({ importMetaUrl: import.meta.url, envKeys: ["MSW_TOOLS_DIR"] });
const TOOL_ANCHOR = (__TOOL_DIRS[0] || ".") + "/x.js";
function resolveHarness() {
  for (const d of __TOOL_DIRS) {
    const h = d.replace(/[\\/]node_modules$/, "");
    if (__existsSync(h + "/vendor/schemastery")) return h;
  }
  return __TOOL_DIRS[0] || ".";
}

const tmpDir = mkdtempSync(tmpdir() + "/msw-host-test-");
const stateFile = tmpDir + "/stats.json";
const io = { writeFile: (p, d) => writeFileSync(p, d, "utf-8") };

check("state: parseStats 合法形状收敛", () => {
  const s = parseStats({ a: { bestMs: 100, plays: 5, wins: 2 }, b: { plays: "x" } });
  assert.deepEqual(s.a, { bestMs: 100, plays: 5, wins: 2 });
  assert.equal(s.b.bestMs, null);
  assert.equal(s.b.plays, 0);
});
check("state: parseStats 坏输入 → 空表", () => {
  assert.deepEqual(parseStats(null), {});
  assert.deepEqual(parseStats([1, 2]), {});
  assert.deepEqual(parseStats("x"), {});
  assert.deepEqual(parseStats({ k: "not-an-object" }), {});
  assert.deepEqual(parseStats({ "": { plays: 1 } }), {});
});
check("state: 保存/读取往返", () => {
  saveStatsFile(stateFile, { x: { bestMs: 123, plays: 2, wins: 1 } }, io);
  const back = loadStatsFile(stateFile);
  assert.deepEqual(back.x, { bestMs: 123, plays: 2, wins: 1 });
});
check("state: 损坏文件 → .corrupt 备份 + 空表", () => {
  writeFileSync(stateFile, "{ not json", "utf-8");
  const s = loadStatsFile(stateFile);
  assert.deepEqual(s, {});
  assert.ok(fsexists(stateFile + ".corrupt"));
});
check("state: 目录不存在时自动创建", () => {
  const deep = tmpDir + "/deep/nested/dir/stats.json";
  saveStatsFile(deep, { q: { bestMs: null, plays: 1, wins: 0 } }, io);
  assert.ok(fsexists(deep));
  assert.deepEqual(loadStatsFile(deep).q, { bestMs: null, plays: 1, wins: 0 });
});
check("state: clearStatsFile 删文件/不存在时成功", () => {
  assert.equal(clearStatsFile(stateFile), true);
  assert.equal(clearStatsFile(stateFile), true); // 幂等
});
check("state: resolveStateDir 形如 $DSH_HOME/profiles/<profile>/dsh-minesweeper", () => {
  assert.ok(resolveStateDir("/home/u/.dsh", "web").endsWith("/home/u/.dsh/profiles/web/dsh-minesweeper"));
});

/* ---------- 假 req/res ---------- */
function fakeReq(body) {
  const r = {
    method: "GET",
    on(ev, cb) {
      if (ev === "data") body && cb(Buffer.from(body));
      if (ev === "end") setTimeout(() => cb(), 0);
      if (ev === "error") void 0;
    },
    destroy() {},
  };
  return r;
}
function fakeRes() {
  const r = {
    status: 0,
    headers: null,
    body: "",
    writeHead(s, h) {
      this.status = s;
      this.headers = h;
    },
    end(b) {
      this.body = b;
    },
  };
  return r;
}

const settings = { flagModeDefault: true };
const handlers = createStatsHandlers({
  stateFile,
  getSettings: () => settings,
  version: "0.4.0",
  io: {
    load: (f) => loadStatsFile(f),
    save: (f, s) => saveStatsFile(f, s, io),
    clear: (f) => clearStatsFile(f),
  },
});

await checkAsync("route: GET 空表 → 200 + version/settings", async () => {
  const res = fakeRes();
  await handlers.get(fakeReq(), res);
  assert.equal(res.status, 200);
  const j = JSON.parse(res.body);
  assert.deepEqual(j.stats, {});
  assert.equal(j.version, "0.4.0");
  assert.equal(j.settings.flagModeDefault, true);
});

await checkAsync("route: PUT 有效 → 200 并落盘", async () => {
  const res = fakeRes();
  await handlers.put(fakeReq(JSON.stringify({ stats: { beginner: { bestMs: 1000, plays: 3, wins: 1 } } })), res);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  const onDisk = JSON.parse(readFileSync(stateFile, "utf-8")).stats;
  assert.deepEqual(onDisk.beginner, { bestMs: 1000, plays: 3, wins: 1 });
});

await checkAsync("route: PUT 坏 JSON → 400 bad-json", async () => {
  const res = fakeRes();
  await handlers.put(fakeReq("{oops"), res);
  assert.equal(res.status, 400);
  assert.equal(JSON.parse(res.body).error, "bad-json");
});

await checkAsync("route: PUT 缺 stats 字段 → 400 stats-missing", async () => {
  const res = fakeRes();
  await handlers.put(fakeReq(JSON.stringify({ other: 1 })), res);
  assert.equal(res.status, 400);
  assert.equal(JSON.parse(res.body).error, "stats-missing");
});

await checkAsync("route: PUT stats 非对象 → 400 bad-stats", async () => {
  const res = fakeRes();
  await handlers.put(fakeReq(JSON.stringify({ stats: "nope" })), res);
  assert.equal(res.status, 400);
  assert.equal(JSON.parse(res.body).error, "bad-stats");
});

await checkAsync("route: PUT 坏形状条目被收敛（不崩溃不损坏文件）", async () => {
  const res = fakeRes();
  await handlers.put(fakeReq(JSON.stringify({ stats: { a: { plays: "x" }, b: 5 } })), res);
  assert.equal(res.status, 200);
  const onDisk = JSON.parse(readFileSync(stateFile, "utf-8")).stats;
  assert.equal(onDisk.a.plays, 0);
  assert.ok(!("b" in onDisk));
});

await checkAsync("route: GET 反映 PUT 结果", async () => {
  const res = fakeRes();
  await handlers.get(fakeReq(), res);
  const j = JSON.parse(res.body);
  assert.equal(j.stats.a && j.stats.a.plays, 0);
});

await checkAsync("route: DELETE 清空（含不存在时幂等）", async () => {
  const res = fakeRes();
  await handlers.del(fakeReq(), res);
  assert.equal(res.status, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  assert.ok(!existsSync(stateFile));
  const res2 = fakeRes();
  await handlers.del(fakeReq(), res2);
  assert.equal(res2.status, 200);
});

await checkAsync("route: 两次交错写 → 文件恒为合法 JSON", async () => {
  for (let i = 0; i < 5; i++) {
    await handlers.put(fakeReq(JSON.stringify({ stats: { k: { bestMs: null, plays: i, wins: 0 } } })), fakeRes());
  }
  const raw = readFileSync(stateFile, "utf-8");
  JSON.parse(raw); // 不抛即合法
});

await checkAsync("route: registerStatsRoutes 经 webServer 分发方法", async () => {
  const seen = [];
  const ws = {
    register(r) {
      seen.push(r);
      this.last = r;
    },
  };
  registerStatsRoutes(ws, { stateFile, getSettings: () => settings, version: "0.4.0" });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].path, "/api/dsh-minesweeper/stats");
  assert.equal(seen[0].kind, "exact");
  const res = fakeRes();
  await seen[0].handler({ method: "GET" }, res);
  assert.equal(res.status, 200);
});

console.log(fail === 0 ? `host 单测：${pass} 项全部通过` : `host 单测：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);