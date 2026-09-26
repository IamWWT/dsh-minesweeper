#!/usr/bin/env node
/**
 * 临时实例（3084）UI 验证脚本：
 *   1) 打开带 token 的 URL，等待 DSH 外壳渲染
 *   2) 找到并点击「扫雷」右侧栏标签
 *   3) 点格开雷（左键点按）
 *   4) 长按开格 → 插旗（≥350ms 按住不动）
 *   5) 切难度（选择器选「中级」）
 *   每步截图到 docs/screenshots/，供人工/vision 复核。
 * 用法：node test/ui-verify.mjs [token]
 *   token 缺省时访问 http://127.0.0.1:3084/ 并自适应（若出现 token 页则从页面读取）。
 */
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

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

const BASE = process.env.MSW_BASE || "http://127.0.0.1:3084";
const TOKEN = process.argv[2] || "";
const SCREEN_DIR = new URL("../docs/screenshots/", import.meta.url).pathname;
const { mkdirSync } = await import("node:fs");
mkdirSync(SCREEN_DIR, { recursive: true });

// 浏览器可执行文件：仅在显式设置 MSW_CHROME 时指定，否则交给 Playwright 自动探测
const EXE = process.env.MSW_CHROME || "";
const browser = await chromium.launch({ ...(EXE ? { executablePath: EXE } : {}), headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.setDefaultTimeout(5000); // 任何等待最多 5s，防止禁用按钮卡死
setTimeout(() => {
  console.log("RESULT: TIMEOUT - 100s 看门狗触发");
  browser.close().finally(() => process.exit(3));
}, 100000).unref();
page.on("console", (m) => {
  if (m.type() === "error") console.log("[page-error]", m.text().slice(0, 200));
});
page.on("pageerror", (e) => console.log("[pageexception]", String(e).slice(0, 300)));

const shot = async (name) => {
  const f = SCREEN_DIR + name;
  await page.screenshot({ path: f });
  console.log("screenshot:", f);
};

try {
  const url = TOKEN ? `${BASE}/?token=${TOKEN}` : `${BASE}/`;
  console.log("goto", url.replace(/token=[^&]*/, "token=***"));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForTimeout(4000); // 等外壳/插件模块加载
  await shot("01-shell.png");

  // 首启引导：内测声明「继续」→ 工作区/API Key 页「稍后配置」→「保存并继续」
  async function clickFast(loc, ms = 800) {
    try {
      await loc.click({ timeout: 2500 });
      await page.waitForTimeout(ms);
      return true;
    } catch {
      return false;
    }
  }
  // 首启引导推进：按优先级点击可见可点按钮，直到扫雷标签出现或无可点项
  const ADVANCE = ["继续", "稍后配置", "保存并继续", "标准模式", "选择工作区", "创建", "下一步", "开始使用"];
  async function visibleButtons() {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll("button, [role=button]"))
        .filter((el) => el.offsetParent !== null)
        .map((el) => ({
          text: (el.textContent || "").trim().slice(0, 24),
          aria: el.getAttribute("aria-label") || "",
          title: el.getAttribute("title") || "",
          disabled: el.disabled === true,
        })),
    );
  }
  for (let round = 0; round < 8; round++) {
    const btns = await visibleButtons();
    if (btns.some((b) => (b.text + b.aria + b.title).includes("扫雷"))) break;
    const target = ADVANCE.find((t) => btns.some((b) => b.text === t && !b.disabled));
    if (!target) break;
    console.log(`onboard[r${round}] 点击「${target}」；当前按钮: ${btns.map((b) => b.text).join(" | ")}`);
    if (!(await clickFast(page.getByRole("button", { name: target, exact: true }).first(), 1200))) break;
  }
  const finalBtns = (await visibleButtons()).map((b) => `${b.text || b.aria || b.title}${b.disabled ? "(disabled)" : ""}`).join(" | ");
  console.log("最终按钮:", finalBtns);
  await page.waitForTimeout(1500);
  await shot("01b-after-onboarding.png");

  // 关闭可能残留的模式选择浮层
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(500);
  // 右侧栏开关在会话头部（data-sidebar-right-expand），需先有会话
  const newSession = page.getByRole("button", { name: /中新建会话|新建会话/ }).first();
  if (await newSession.count()) {
    await newSession.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(2000);
  }
  // 展开右侧栏（aria-label「打开右侧边栏」/ data-sidebar-right-expand）
  const expandBtn = page.locator('[data-sidebar-right-expand]').first();
  if (await expandBtn.count()) {
    await expandBtn.click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(1200);
    console.log("已展开右侧栏");
  } else {
    console.log("未找到 data-sidebar-right-expand 开关");
  }
  let tab = page.locator('text=扫雷').first();
  if ((await tab.count()) === 0) {
    for (const name of ["打开右侧边栏", "右侧栏", "侧边栏", "面板"]) {
      const b = page.getByRole("button", { name: name }).first();
      if (await b.count()) {
        await b.click({ timeout: 3000 }).catch(() => {});
        await page.waitForTimeout(1000);
        tab = page.locator('text=扫雷').first();
        if (await tab.count()) break;
      }
    }
  }
  await shot("01c-after-panel-toggle.png");

  // 若出现 token 门禁页，尝试从页面读取提示
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log("body(400):", bodyText.replace(/\n/g, " | "));

  // 找「扫雷」标签（右侧栏 tab）
  tab = page.locator('text=扫雷').first();
  if ((await tab.count()) === 0) {
    // 诊断：dump 所有按钮/标签页的可见文本，帮助定位右侧栏入口
    const labels = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll("button, [role=tab], [role=button]"))
          .map((el) => (el.textContent || "").trim().slice(0, 30))
          .filter(Boolean)
          .slice(0, 60),
      );
    console.log("buttons:", labels.join(" | "));
    const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 600));
    console.log("body(600):", bodyText.replace(/\n/g, " | "));
    console.log("RESULT: FAIL - 未找到扫雷标签（截图已存，需人工/vision 查看）");
    await shot("02-tab-missing.png");
    process.exitCode = 1;
  } else {
    await tab.click();
    await page.waitForTimeout(1200);
    await shot("02-tab-open.png");

    // 棋盘就绪
    const board = page.locator(".msw-root");
    if ((await board.count()) === 0) {
      console.log("RESULT: FAIL - 标签打开但无 .msw-root（插件渲染失败？）");
      await shot("03-board-missing.png");
    } else {
      const cells = page.locator(".msw-cell");
      const n = await cells.count();
      console.log("board cells:", n);

      // 1) 左键点按第一个未开格（开雷）
      const first = cells.nth(5);
      await first.click({ force: true });
      await page.waitForTimeout(400);
      await shot("04-after-first-reveal.png");

      // 2) 长按插旗：mouse down → 停 500ms → up
      const flagTarget = cells.nth(n - 1);
      const box = await flagTarget.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.waitForTimeout(500); // > 350ms 长按阈值
        await page.mouse.up();
        await page.waitForTimeout(300);
        await shot("05-after-longpress-flag.png");
      }

      // 3) 切难度 → 中级
      const sel = page.locator("select.msw-select").first();
      if (await sel.count()) {
        await sel.selectOption("intermediate");
        await page.waitForTimeout(600);
        await shot("06-intermediate.png");
      } else {
        console.log("RESULT: WARN - 未找到难度选择器");
      }

      // 终态信息
      const hud = await page.locator(".msw-hud").first().innerText().catch(() => "(hud 不可读)");
      console.log("hud:", String(hud).replace(/\n/g, " "));
      console.log("RESULT: UI 交互完成（截图见 docs/screenshots/）");
    }
  }
} catch (e) {
  console.error("RESULT: ERROR", e && e.message);
  await shot("99-error.png").catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}