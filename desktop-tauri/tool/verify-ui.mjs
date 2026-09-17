#!/usr/bin/env node
/**
 * 控制台 UI 无人核验：渲染 dist/ 后检查令牌、布局、层级与交互态。
 *
 * 为什么需要它：这套 UI 曾经因为 @theme 映射缺失而「工具类全部不生成」，
 * 页面渲染成无样式却**不报任何错**。肉眼可能误判成「设计难看」，
 * 而这个脚本会直接指出背景色/layout 不对。
 *
 * 用法: node tool/verify-ui.mjs [--shots]
 *   --shots  同时把 12 张截图写到 docs/screenshots/
 * 依赖: playwright-core（用系统已装的 Chrome，不下载浏览器）
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "dist");
const SHOT_DIR = path.join(ROOT, "docs/screenshots");
const WANT_SHOTS = process.argv.includes("--shots");
const PANELS = ["status", "account", "versions", "logs", "settings"];
const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2",
};

let fail = 0;
const ok = (cond, msg) => {
  console.log(`  ${cond ? "✅" : "❌"} ${msg}`);
  if (!cond) fail++;
};

/** Chrome 会把计算色原样返回为 oklch(...)，统一映射到 0..1 的亮暗标量 */
function brightness(s) {
  const str = String(s);
  if (str.startsWith("oklch")) {
    const m = str.match(/oklch\(\s*([\d.]+)(%?)/);
    if (m) {
      const L = parseFloat(m[1]);
      return m[2] === "%" ? L / 100 : L;
    }
  }
  const n = (str.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  return n.length === 3 ? (0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2]) / 255 : NaN;
}

function serve() {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split("?")[0]);
    if (p === "/") p = "/index.html";
    const f = path.join(DIST, p);
    if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404);
      return res.end("not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(f)] || "application/octet-stream" });
    fs.createReadStream(f).pipe(res);
  });
  return new Promise((r) => server.listen(0, "127.0.0.1", () => r(server)));
}

const { chromium } = await import("playwright-core");

if (!fs.existsSync(DIST)) {
  console.error("找不到 dist/，先跑 `pnpm build`");
  process.exit(1);
}

const server = await serve();
const port = server.address().port;
const browser = await chromium.launch({ channel: "chrome" });
const errors = [];

if (WANT_SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });

for (const scheme of ["light", "dark"]) {
  const ctx = await browser.newContext({
    viewport: { width: 1000, height: 720 }, colorScheme: scheme, deviceScaleFactor: 2,
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[${scheme}] ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`[${scheme}] ${m.text()}`));
  const url = (panel) =>
    `http://127.0.0.1:${port}/index.html?window=console&panel=${panel}`;
  console.log(`\n===== ${scheme}：令牌 / 布局 =====`);

  for (const panel of PANELS) {
    await page.goto(url(panel), { waitUntil: "networkidle" });
    await page.waitForTimeout(320);
    if (WANT_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, `${scheme}-${panel}.png`) });
    const r = await page.evaluate(() => {
      const aside = document.querySelector("aside");
      const cards = [...document.querySelectorAll("div")].filter(
        (d) => getComputedStyle(d).borderTopWidth === "1px");
      return {
        bg: getComputedStyle(document.body).backgroundColor,
        asideW: aside ? Math.round(aside.getBoundingClientRect().width) : 0,
        h1: document.querySelector("h1")?.textContent.trim() ?? null,
        cards: cards.length,
        overflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    const L = brightness(r.bg);
    const wantLight = scheme === "light" ? L > 0.9 : L < 0.3;
    ok(wantLight && r.h1 && r.asideW === 224 && r.cards > 0 && r.overflowX <= 0,
       `${panel.padEnd(9)} bg=${r.bg.padEnd(20)} 侧栏=${r.asideW} h1=${r.h1 ?? "—"} 卡片=${r.cards} 溢出=${r.overflowX}`);
  }
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 720 }, colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[detail] ${e.message}`));
  const url = (panel) => `http://127.0.0.1:${port}/index.html?window=console&panel=${panel}`;

  console.log("\n===== 导航选中态 =====");
  for (const panel of ["status", "logs"]) {
    await page.goto(url(panel), { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const items = await page.evaluate(() =>
      [...document.querySelectorAll("aside nav button")].map((b) => ({
        label: b.textContent.trim(),
        active: b.getAttribute("aria-current") === "page",
        bg: getComputedStyle(b).backgroundColor,
      })));
    const act = items.find((x) => x.active);
    const oth = items.find((x) => !x.active);
    ok(act && oth && act.bg !== oth.bg,
       `${panel}: 选中「${act?.label}」bg=${act?.bg} vs 未选 bg=${oth?.bg}`);
  }

  console.log("\n===== 文本层级 / 等宽 / 交互态 =====");
  await page.goto(url("status"), { waitUntil: "networkidle" });
  await page.waitForTimeout(320);
  const h = await page.evaluate(() => ({
    h1: getComputedStyle(document.querySelector("h1")).color,
    muted: getComputedStyle(document.querySelector(".text-muted-foreground")).color,
    mono: [...document.querySelectorAll("*")].filter((e) =>
      getComputedStyle(e).fontFamily.toLowerCase().includes("mono")).length,
    tabular: document.querySelectorAll(".tabular").length,
  }));
  ok(h.h1 !== h.muted, `标题色 ${h.h1} ≠ 次要色 ${h.muted}`);
  ok(h.mono > 0, `等宽字体元素 ${h.mono} 个`);
  ok(h.tabular > 0, `tabular-nums 元素 ${h.tabular} 个`);

  const btn = page.locator("button:has-text('启动'), button:has-text('停止')").first();
  const before = await btn.evaluate((e) => getComputedStyle(e).backgroundColor);
  await btn.hover();
  await page.waitForTimeout(200);
  const after = await btn.evaluate((e) => getComputedStyle(e).backgroundColor);
  ok(before !== after, `按钮 hover 变色 ${before} → ${after}`);
  await btn.focus();
  await page.waitForTimeout(150);
  const outline = await btn.evaluate((e) => getComputedStyle(e).outlineStyle);
  ok(outline.includes("solid"), `键盘焦点环 outline-style=${outline}`);

  console.log("\n===== 日志 =====");
  await page.goto(url("logs"), { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const lg = await page.evaluate(() => {
    const pre = document.querySelector("pre");
    return { text: pre?.textContent.trim().slice(0, 40) ?? "",
             mono: pre ? getComputedStyle(pre).fontFamily.toLowerCase().includes("mono") : false };
  });
  ok(lg.text.length > 0 && lg.mono, `日志等宽渲染「${lg.text.replace(/\n/g, " / ")}」`);

  console.log("\n===== 主窗口引导页 =====");
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  if (WANT_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, "light-guide.png") });
  const g = await page.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent.trim() ?? null,
    aside: document.querySelectorAll("aside").length,
  }));
  ok(g.h1 && g.aside === 0, `引导页 标题=「${g.h1}」侧栏=${g.aside}（应为 0）`);
  await ctx.close();
}

await browser.close();
server.close();
if (errors.length) { console.log("\n控制台错误:\n" + errors.join("\n")); fail += errors.length; }
console.log(fail ? `\n❌ ${fail} 项不通过` : "\n✅ 全部通过");
process.exit(fail ? 1 : 0);
