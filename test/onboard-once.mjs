#!/usr/bin/env node
// 一次性首跑：用持久化浏览器 profile 走完 3084 的 onboarding，之后 ui-verify 复用该 profile 目录。
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
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

const req = createRequire(TOOL_ANCHOR);
const { chromium } = req("playwright-core");

const TOKEN = process.argv[2] || "";
// 截图目录：相对插件根解析（跨平台，不写死机器路径）；可用 MSW_SHOT_DIR 覆盖
const SHOT_DIR = process.env.MSW_SHOT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots");
mkdirSync(SHOT_DIR, { recursive: true });
const UD = process.env.MSW_PW_PROFILE || join(tmpdir(), "msw-pw-profile");
const ctx = await chromium.launchPersistentContext(UD, {
  // 浏览器可执行文件：仅在显式设置 MSW_CHROME 时使用，否则交给 Playwright 自动探测
  ...(process.env.MSW_CHROME ? { executablePath: process.env.MSW_CHROME } : {}),
  headless: true,
  viewport: { width: 1500, height: 900 },
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = ctx.pages()[0] || (await ctx.newPage());
page.setDefaultTimeout(5000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await page.goto("http://127.0.0.1:3084/" + (TOKEN ? `?token=${TOKEN}` : ""), { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(4000);

async function clickName(name, ms = 1000) {
  const b = page.getByRole("button", { name, exact: true }).first();
  if (!(await b.count())) return false;
  if (!(await b.isEnabled().catch(() => false))) return false;
  await b.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(ms);
  return true;
}
const seq = ["继续", "稍后配置", "保存并继续", "选择工作区", "开始使用"];
for (let i = 0; i < 10; i++) {
  const done = await page.evaluate(() => document.body.innerText.includes("扫雷") || document.querySelector("[data-sidebar-right-expand]") != null);
  if (done) break;
  let acted = false;
  for (const name of ["继续", "稍后配置", "保存并继续", "下一步", "开始使用"]) {
    if (await clickName(name)) {
      console.log("clicked:", name);
      acted = true;
      break;
    }
  }
  if (!acted) {
    if (await clickName("选择工作区")) {
      console.log("clicked: 选择工作区 (picker)");
      await page.waitForTimeout(800);
      const ws = page.getByRole("button", { name: "deepseek" }).first();
      if (await ws.count()) {
        await ws.click({ timeout: 3000 }).catch(() => {});
        console.log("clicked: workspace deepseek");
        acted = true;
      } else {
        await page.getByText("deepseek", { exact: false }).first().click({ timeout: 3000 }).catch(() => {});
        console.log("clicked: text deepseek");
        acted = true;
      }
    }
  }
  if (!acted) {
    const btns = await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .filter((el) => el.offsetParent !== null)
        .map((el) => (el.textContent || "").trim().slice(0, 20))
        .filter(Boolean),
    );
    console.log("stuck. buttons:", btns.join(" | "));
    break;
  }
  await page.waitForTimeout(1500);
}
await page.waitForTimeout(1500);
await page.screenshot({ path: join(SHOT_DIR, "99-onboarding-final.png") });
const body = await page.evaluate(() => document.body.innerText.slice(0, 300));
console.log("final body:", body.replace(/\n/g, " | "));
console.log("errors:", errors.slice(0, 5).join(" ; ") || "(none)");
await ctx.close();