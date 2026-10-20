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
const PANELS = ["run", "account", "versions"];
/** 每个面板的期望标题：id 迁移漏改会在这里立刻暴露（不要放宽成"有 h1 就算过"） */
const PANEL_TITLE = { run: "运行", account: "账号", versions: "版本" };
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
    ok(wantLight && r.h1 === PANEL_TITLE[panel] && r.asideW === 224 && r.cards > 0 && r.overflowX <= 0,
       `${panel.padEnd(9)} bg=${r.bg.padEnd(20)} 侧栏=${r.asideW} h1=${r.h1 ?? "—"}（期望「${PANEL_TITLE[panel]}」）卡片=${r.cards} 溢出=${r.overflowX}`);
  }
  await ctx.close();
}

{
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 720 }, colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`[detail] ${e.message}`));
  const url = (panel) => `http://127.0.0.1:${port}/index.html?window=console&panel=${panel}`;

  console.log("\n===== 面板深链与未知 id（护栏 P0）=====");
  // 为什么要这一组：`ConsoleApp` 原来对未知 panel 会 `?? "status"` 静默回退——
  // id 迁移漏改一处不会报错，只会悄悄打开错的页。护栏的作用是"改错就红"。
  const DEEP_LINKS = [
    ["run", "运行"], ["account", "账号"], ["versions", "版本"],
    // 旧 id 必须**显式映射**（合并后仍要能打开对的面板，而不是靠兜底）
    ["status", "运行"], ["logs", "运行"], ["settings", "运行"],
  ];
  for (const [panel, title] of DEEP_LINKS) {
    await page.goto(url(panel), { waitUntil: "networkidle" });
    await page.waitForTimeout(220);
    const h1 = await page.evaluate(() => document.querySelector("h1")?.textContent.trim() ?? null);
    ok(h1 === title, `深链 panel=${panel.padEnd(9)} → 「${h1 ?? "—"}」（期望「${title}」）`);
  }
  await page.goto(url("nope"), { waitUntil: "networkidle" });
  await page.waitForTimeout(220);
  const unknown = await page.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent.trim() ?? null,
    body: document.body.innerText || "",
  }));
  ok(
    !unknown.h1 && /面板不存在|未知面板/.test(unknown.body),
    unknown.h1
      ? `未知 panel=nope 静默回退到「${unknown.h1}」❌（id 迁移漏改会变暗坑）`
      : `未知 panel=nope 显式报错 ✅`,
  );

  console.log("\n===== 导航选中态 =====");
  for (const panel of ["run", "account"]) {
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
  await page.goto(url("run"), { waitUntil: "networkidle" });
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

  console.log("\n===== 日志（已并入运行页的高级折叠区）=====");
  await page.goto(url("run"), { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  const lg = await page.evaluate(() => {
    // 展开所有 details（日志尾默认收起），再找等宽日志块
    document.querySelectorAll("details").forEach((d) => (d.open = true));
    const pres = [...document.querySelectorAll("pre")];
    const hit = pres.find((p) => (p.textContent || "").includes("dshc"));
    return {
      text: hit?.textContent.trim().slice(0, 40) ?? "",
      mono: hit ? getComputedStyle(hit).fontFamily.toLowerCase().includes("mono") : false,
      folds: document.querySelectorAll("details").length,
    };
  });
  ok(lg.text.length > 0 && lg.mono && lg.folds > 0,
     `日志等宽渲染「${lg.text.replace(/\n/g, " / ")}」折叠区=${lg.folds}`);

  console.log("\n===== 防回潮断言（合并后的形状）=====");
  {
    // 账号页：原「扫码授权」重复卡已删、详情并入折叠区、页面级「刷新」已删
    await page.goto(url("account"), { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const acc = await page.evaluate(() => ({
      body: document.body.innerText || "",
      buttons: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()),
      folds: document.querySelectorAll("details").length,
    }));
    ok(!acc.body.includes("扫码授权") && !acc.buttons.includes("刷新"),
       `账号页：无重复「扫码授权」卡 ✅ 无页面级「刷新」✅（按钮：${acc.buttons.slice(0, 6).join("/")}）`);

    // 版本页：过期「待接入」文案已删；页面级「刷新」已删；可安装列表收进折叠区
    await page.goto(url("versions"), { waitUntil: "networkidle" });
    await page.waitForTimeout(300);
    const ver0 = await page.evaluate(() => ({
      body: document.body.innerText || "",
      buttons: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()),
    }));
    ok(!ver0.body.includes("待接入") && !ver0.buttons.includes("刷新"),
       `版本页：无过期「待接入」✅ 无页面级「刷新」✅`);

    // 运行页：故障恢复必须在（不折叠），高级默认收起，日志尾在折叠区里
    await page.goto(url("run"), { waitUntil: "networkidle" });
    await page.waitForTimeout(400);
    const run0 = await page.evaluate(() => ({
      body: document.body.innerText || "",
      folds: [...document.querySelectorAll("details")].map((d) => d.querySelector("summary")?.textContent.trim() ?? ""),
      openCount: [...document.querySelectorAll("details")].filter((d) => d.open).length,
    }));
    ok(run0.body.includes("故障恢复") && run0.folds.some((s) => s.startsWith("高级")) && run0.openCount === 0,
       `运行页：故障恢复常驻 ✅ 折叠区=[${run0.folds.join(" / ")}] 默认收起=${run0.openCount === 0} ✅`);

    // focus=logs 深链：引导面「打开控制台·日志」按钮靠它"落在原处"。
    // 没有这条断言的话，合并会把"点日志看日志"退化成"点日志到运行页，自己找折叠区"。
    await page.goto(
      `http://127.0.0.1:${port}/index.html?window=console&panel=run&focus=logs`,
      { waitUntil: "networkidle" },
    );
    await page.waitForTimeout(400);
    const focusLogs = await page.evaluate(() =>
      [...document.querySelectorAll("details")].filter((d) => d.open)
        .map((d) => d.querySelector("summary")?.textContent.trim() ?? ""));
    ok(focusLogs.some((s) => s.includes("dshc.log")),
       `focus=logs 深链直接展开日志区 ✅（展开=[${focusLogs.join("/")}]）`);

    // Worker 环境体检：两类"照做了却没反应"的告警必须出现（浏览器 mock 造了这两种样本）
    await page.goto(url("run"), { waitUntil: "networkidle" });
    await page.waitForTimeout(500);
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
    await page.waitForTimeout(400);
    const env = await page.evaluate(() => document.body.innerText || "");
    ok(env.includes("上游禁止写文件") && env.includes("GIT_PAGER"),
       `环境导入：点名"不可导入（会让 Harness 拒绝启动）"的键 ✅`);
    ok(env.includes("写了也不生效") && env.includes("TMPDIR"),
       `环境导入：提示"已被系统提供"的键 ✅`);
    ok(env.includes("移动开发") && env.includes("ANDROID_HOME") && env.includes("导入选中的"),
       `环境导入：分组候选 + 导入按钮 ✅`);
    ok(env.includes("来自登录 shell"),
       `环境体检：显示 PATH 来源（登录 shell / 回退）✅`);
  }

  console.log("\n===== 运行页分区顺序随健康态变化（评分卡 §7）=====");
  {
    const order = async (qs) => {
      await page.goto(`http://127.0.0.1:${port}/index.html?window=console&panel=run${qs}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(400);
      return page.evaluate(() => {
        // 按**元素**定位而不是 innerText.indexOf：页头描述里也出现了"运行参数/故障恢复"
        // 这些词，用文本下标会拿到描述的位置，断言就失去意义（第一版就踩了这个）。
        const topOfCard = (label) => {
          const heading = [...document.querySelectorAll("h1,h2,h3,h4,p,span,div")]
            .find((e) => e.children.length === 0 && (e.textContent || "").trim() === label);
          const card = heading?.closest("div.rounded-xl, div.rounded-lg, section") ?? heading?.parentElement;
          return card ? Math.round(card.getBoundingClientRect().top) : -1;
        };
        const openFolds = [...document.querySelectorAll("details")].filter((d) => d.open)
          .map((d) => d.querySelector("summary")?.textContent.trim() ?? "");
        return { recovery: topOfCard("故障恢复"), params: topOfCard("运行参数"), openFolds };
      });
    };

    const healthy = await order("");
    ok(healthy.recovery > 0 && healthy.params > 0 && healthy.params < healthy.recovery,
       `健康态：运行参数在前（y=${healthy.params}）< 故障恢复（y=${healthy.recovery}）· 展开的折叠=[${healthy.openFolds.join("/")}]`);
    ok(healthy.openFolds.length === 0, `健康态：所有折叠区默认收起 ✅`);

    const down = await order("&workerdown");
    ok(down.recovery > 0 && down.params > 0 && down.recovery < down.params,
       `故障态：故障恢复置顶（y=${down.recovery}）< 运行参数（y=${down.params}）`);
    ok(down.openFolds.some((s) => s.includes("dshc.log")),
       `故障态：日志尾默认展开 ✅（展开的折叠=[${down.openFolds.join("/")}]）`);
  }

  console.log("\n===== 主窗口（引导面 / 向导）=====");
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  if (WANT_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, "light-guide.png") });
  // 主窗口有两种合法形态：环境齐全 → 引导面（有 h1）；未完成引导 → 向导（无 h1，只有步骤条）。
  // 浏览器 mock 是"未完成引导"，所以落向导——原断言只认 h1，于是一直误报 ❌（改动前后都红）。
  // 这里改为判「挂载成功」：无控制台侧栏 + 品牌图出现 + 有正文，两种形态都覆盖。
  const g = await page.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent.trim() ?? null,
    logo: document.querySelector('img[alt="DSH Pocket"]') !== null,
    textLen: (document.body.innerText || "").trim().length,
    aside: document.querySelectorAll("aside").length,
  }));
  ok(
    g.aside === 0 && g.logo && g.textLen > 40,
    `主窗口挂载 标题=「${g.h1 ?? "（向导态，无 h1）"}」侧栏=${g.aside}（应为 0）正文=${g.textLen} 字`,
  );

  // 引导面（环境齐全态）：?onboarded 走 bootstrap 的"已完成引导"mock。
  // 这是主窗口最常驻的形态，也是恢复卡唯一会渲染的相位。
  await page.goto(`http://127.0.0.1:${port}/index.html?onboarded`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  if (WANT_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, "light-guide-onboarded.png") });
  const gd = await page.evaluate(() => ({
    h1: document.querySelector("h1")?.textContent.trim() ?? null,
    aside: document.querySelectorAll("aside").length,
    body: document.body.innerText || "",
    buttons: [...document.querySelectorAll("button")].map((b) => (b.textContent || "").trim()),
  }));
  ok(Boolean(gd.h1) && gd.aside === 0, `引导面 标题=「${gd.h1}」侧栏=${gd.aside}（应为 0）`);
  // 启动引导横幅：终端里有可导入的变量时必须出现（"启动时引导用户导入环境变量"的落点）
  ok(
    gd.body.includes("个环境变量可导入") && gd.buttons.includes("一键导入") && gd.buttons.includes("稍后"),
    `启动横幅：检测到可导入变量 + 一键导入/稍后 ✅`,
  );
  // 一键导入的范围必须排除密钥（mock 在默认分组里放了一个 PUB_TOKEN 来钉这条策略）
  ok(
    gd.body.includes("不含") && gd.body.includes("密钥"),
    `启动横幅：一键导入明确排除密钥 ✅`,
  );

  // 平台说明（Windows 真机才出现）：不能把"没解析到登录 shell"报成超时
  await page.goto(`http://127.0.0.1:${port}/index.html?step=env&winenv`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const winNote = await page.evaluate(() => document.body.innerText || "");
  ok(
    winNote.includes("Windows 不需要导入") && !winNote.includes("超时或没有 $SHELL"),
    `平台说明：Windows 不误报为超时 ✅`,
  );

  // 向导「环境变量」步骤（?step=env 直达）：分组候选与导入按钮要真的渲染出来
  await page.goto(`http://127.0.0.1:${port}/index.html?step=env`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const envStep = await page.evaluate(() => ({
    body: document.body.innerText || "",
    nav: [...document.querySelectorAll("nav[aria-label='引导步骤'] *")].map((e) => e.textContent || "").join(" "),
    checks: document.querySelectorAll("input[type=checkbox]").length,
  }));
  ok(envStep.nav.includes("环境变量"), `向导步骤条含「环境变量」✅`);
  ok(
    envStep.body.includes("移动开发") && envStep.body.includes("导入选中的") && envStep.checks > 0,
    `向导环境步：分组 ${envStep.checks} 个勾选项 + 导入按钮 ✅`,
  );

  // 恢复卡（设计文档不变量 I3：进入 Web 界面失败必须留下出口，不能出现"只能退出"的界面）
  await page.goto(`http://127.0.0.1:${port}/index.html?onboarded&navfail`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  if (WANT_SHOTS) await page.screenshot({ path: path.join(SHOT_DIR, "light-recovery.png") });
  const rec = await page.evaluate(() => ({
    body: document.body.innerText || "",
    buttons: Array.from(document.querySelectorAll("button")).map((b) => (b.textContent || "").trim()),
  }));
  const exits = ["重新连接", "打开诊断", "回到引导页"];
  const missing = exits.filter((t) => !rec.buttons.includes(t));
  ok(
    rec.body.includes("暂时连不上本机控制台") && missing.length === 0,
    `恢复卡 标题=${rec.body.includes("暂时连不上本机控制台") ? "✅" : "❌"} 出口=${exits.join("/")}${missing.length ? `（缺 ${missing.join("、")}）` : ""}`,
  );
  await ctx.close();
}

await browser.close();
server.close();
if (errors.length) { console.log("\n控制台错误:\n" + errors.join("\n")); fail += errors.length; }
console.log(fail ? `\n❌ ${fail} 项不通过` : "\n✅ 全部通过");
process.exit(fail ? 1 : 0);
