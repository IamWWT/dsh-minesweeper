#!/usr/bin/env node
// 运行时验证：3084 页面上插件 client 的 apply 效果是否执行（style#msw-style 注入）。
import { createRequire } from "node:module";

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

const req = createRequire(TOOL_ANCHOR);
const { chromium } = req("playwright-core");
const TOKEN = process.argv[2] || "";
const browser = await chromium.launch({
  // 仅在显式设置 MSW_CHROME 时指定；否则交给 Playwright 自动探测
  ...(process.env.MSW_CHROME ? { executablePath: process.env.MSW_CHROME } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 300)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
});
await page.goto("http://127.0.0.1:3084/" + (TOKEN ? `?token=${TOKEN}` : ""), { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(9000); // 等模块加载与 apply 效果
const probe = await page.evaluate(() => {
  const s = document.getElementById("msw-style");
  return {
    mswStyle: !!s,
    mswCssLen: s ? s.textContent.length : 0,
    mswHasRoot: s ? s.textContent.includes(".msw-root") : false,
    hasML: typeof window.__ModuleLoader__,
  };
});
console.log("probe:", JSON.stringify(probe));
console.log("errors:", errors.slice(0, 8).join(" ; ") || "(none)");
const ok = probe.mswStyle && probe.mswHasRoot && probe.mswCssLen > 500;
console.log(ok ? "RESULT: PASS - 插件 client 已在真实 harness 中 apply（style#msw-style 注入，CSS 生效）" : "RESULT: FAIL - 插件 client 未注入样式");
await browser.close();
process.exit(ok ? 0 : 1);