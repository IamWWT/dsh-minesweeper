#!/usr/bin/env node
// 快速诊断：3084 页面上 dsh-minesweeper client 是否已加载/注册
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
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + String(e).slice(0, 300)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200));
});
const url = "http://127.0.0.1:3084/" + (TOKEN ? `?token=${TOKEN}` : "");
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  const ml = window.__ModuleLoader__;
  let ids = null;
  if (ml) {
    try {
      ids = ml.ids ? Array.from(ml.ids()) : null;
    } catch {}
    if (!ids && ml.registry) {
      try {
        ids = Object.keys(ml.registry);
      } catch {}
    }
  }
  return {
    hasML: typeof ml,
    ids,
    msw: typeof ml !== "undefined" ? JSON.stringify((ml.loaded && Object.keys(ml.loaded)) || null).slice(0, 400) : null,
    expandBtn: document.querySelectorAll("[data-sidebar-right-expand]").length,
    expandAria: Array.from(document.querySelectorAll("button[aria-label]"))
      .map((b) => b.getAttribute("aria-label"))
      .filter(Boolean)
      .slice(0, 30),
  };
});
console.log(JSON.stringify(info, null, 2));
console.log("errors:", errors.slice(0, 10).join("\n") || "(none)");
await browser.close();