#!/usr/bin/env node
// 3084 完整链路：onboarding → 会话 → 右栏 → 扫雷标签 → 开格
// 持久化 profile：/tmp/msw-pw-profile（首次跑完 onboarding 后，之后直接复用）
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
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

const TOKEN = process.env.DSH_TOKEN || process.argv[2] || "";
// 截图目录：相对插件根解析（跨平台，不写死机器路径）；可用 MSW_SHOT_DIR 覆盖
const SHOT = (process.env.MSW_SHOT_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "screenshots")) + "/";

const ctx = await chromium.launchPersistentContext(process.env.MSW_PW_PROFILE || join(tmpdir(), "msw-pw-profile"), {
  // 浏览器可执行文件：仅在显式设置 MSW_CHROME 时使用，否则交给 Playwright 自动探测
  ...(process.env.MSW_CHROME ? { executablePath: process.env.MSW_CHROME } : {}),
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
  viewport: { width: 1500, height: 900 },
});
const page = ctx.pages()[0] || (await ctx.newPage());
page.setDefaultTimeout(5000);
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));

await page.goto(`http://127.0.0.1:3084/?token=${TOKEN}`, { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: SHOT + "a1-initial.png" });

async function clickIfVisible(loc, name, extra = {}) {
  if (!(await loc.count())) return false;
  await loc.click({ timeout: 2500, ...extra }).catch(() => {});
  console.log("clicked:", name);
  await page.waitForTimeout(900);
  return true;
}

/* ---- onboarding 状态机（最多 12 轮） ---- */
for (let round = 0; round < 12; round++) {
  const state = await page.evaluate(() => {
    const t = document.body.innerText;
    return {
      apiDialog: !!document.querySelector('[role=dialog][aria-label*="API Key"]'),
      hasLater: t.includes("稍后配置"),
      hasSave: !!Array.from(document.querySelectorAll("button")).find((b) => t.includes("保存并继续") && (b.textContent || "").includes("保存并继续") && !b.disabled),
      hasMode: t.includes("标准模式"),
      hasWsPrompt: t.includes("选择一个工作区开始"),
      hasMsw: t.includes("扫雷"),
    };
  });
  if (state.hasMsw) { console.log(`round ${round}: 扫雷已可见`); break; }
  console.log(`round ${round}:`, JSON.stringify(state));

  if (state.hasApiDialog || state.hasLater) {
    if (await clickIfVisible(page.getByRole("button", { name: "稍后配置" }).first(), "稍后配置")) continue;
  }
  if (await clickIfVisible(page.getByRole("button", { name: "保存并继续", exact: true }).first(), "保存并继续")) continue;

  if (state.hasMode) {
    if (await clickIfVisible(page.getByRole("button", { name: "标准模式", exact: true }).first(), "标准模式卡")) continue;
  }
  if (state.hasWsPrompt) {
    if (await clickIfVisible(page.getByRole("button", { name: "选择工作区" }).last(), "选择工作区按钮")) {
      // 弹出的工作区 dialog 里选 deepseek
      await page.waitForTimeout(800);
      const dlg = page.locator("[role=dialog]").last();
      const wsItem = dlg.locator("text=deepseek").first();
      if (await wsItem.count()) {
        await wsItem.click({ timeout: 3000 }).catch(() => {});
        console.log("clicked: workspace=deepseek");
        await page.waitForTimeout(1200);
        // 可能有确认按钮
        const ok = dlg.getByRole("button", { name: /确认|确定|完成|继续/ }).first();
        if (await ok.count() && (await ok.isEnabled().catch(() => false))) {
          await ok.click({ timeout: 2500 }).catch(() => {});
          await page.waitForTimeout(1200);
        }
      }
      continue;
    }
  }
  if (await clickIfVisible(page.getByRole("button", { name: "继续", exact: true }).first(), "继续")) continue;
  break;
}
await page.screenshot({ path: SHOT + "a2-after-onboarding.png" });

/* ---- 会话 → 右栏 → 扫雷 ---- */
await clickIfVisible(page.getByRole("button", { name: "新建会话" }).first(), "新建会话");
const expand = page.locator("[data-sidebar-right-expand]").first();
if (await expand.count()) {
  await expand.click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1500);
  console.log("已展开右侧栏");
} else {
  console.log("未找到 [data-sidebar-right-expand]（可能面板已展开或无会话头）");
}
await page.screenshot({ path: SHOT + "a3-after-expand.png" });

const mswTab = page.getByText("扫雷", { exact: false }).first();
let found = (await mswTab.count()) > 0;
if (!found) {
  // 兜底：按标签页按钮找
  const tabBtn = page.getByRole("button", { name: /扫雷/ }).first();
  if (await tabBtn.count()) {
    await tabBtn.click({ timeout: 2500 }).catch(() => {});
    found = true;
  }
}
console.log("扫雷标签:", found ? "已找到" : "未找到");
if (found) {
  await page.waitForTimeout(800);
  await page.screenshot({ path: SHOT + "a4-minesweeper-tab.png" });
  const board = page.locator(".msw-root").first();
  if ((await board.count()) > 0) {
    const cells = page.locator(".msw-cell");
    console.log("棋盘格数:", await cells.count());
    await cells.nth(5).click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    await page.screenshot({ path: SHOT + "a5-first-reveal.png" });
    const hud = await page.locator(".msw-hud").first().innerText().catch(() => "");
    console.log("HUD:", String(hud).replace(/\n/g, " "));
    console.log("RESULT: 完整链路 OK（onboarding→会话→右栏→扫雷标签→开格）");
  } else {
    console.log("RESULT: 标签可见但棋盘未渲染（.msw-root 缺失）");
  }
}
await page.screenshot({ path: SHOT + "a6-final.png" });
console.log("pageerrors:", errors.slice(0, 5).join(" ; ") || "(none)");
await ctx.close();
process.exit(0);