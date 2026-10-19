# 桌面端重设计：macOS 顶栏 · 控制台精简 · 启动逻辑与错误处理

> 对象：`desktop-tauri/`（Tauri 2.11.5 / tauri-runtime-wry 2.11.4 / wry 0.55.1 / tao 0.35.3，macOS 27.0.1 实测）
> 版本基线：`desktop-tauri` 0.2.6 · `tauri.conf.json` 0.2.13 · commit `59c753d`
> 本文回答四个问题：① macOS 顶栏为什么偏小 ② 设置类页面冗余 ③ error URL 进不可用界面 ④ 启动逻辑怎么设计
> 标记约定：**【实测】** 本机跑出来的数字 · **【已核实】** 读源码/代码得到的结论 · **【推断】** 尚未验证

---

## 0. 结论摘要

| # | 问题 | 根因（一句话） | 处置 |
|---|---|---|---|
| 1 | macOS 顶栏"比正常小" | 应用在 macOS 上有**三个互不一致的顶栏高度**（主窗口隐形拖拽条 28pt / 控制台自绘 40pt / 系统原生带 32pt），并且 Overlay 标题栏下**系统不会替内容留位** | 本轮统一：控制台 52pt（内部 32pt 行与原生带重合）、拖拽条 28→32pt；主窗口真实顶栏列入 P1（见 §1.4） |
| 2 | 设置类页面冗余 | 环境/账号/版本/参数/日志/修复这**六类信息被 7 个界面重复表达**（控制台 5 页 + 引导面 + 6 步向导 + 原生菜单/托盘），其中"dsh 版本"重复 4 处、"更新"重复 4 处、Worker 启停重复 5 处 | **已落地**（评分与逐条依据见 [worker-ui-feature-scorecard.md](worker-ui-feature-scorecard.md)）：5 页 → 3 页（运行 / 账号 / 版本），日志→运行页折叠区、设置→运行参数卡；面板 id `run/account/versions` + 旧 id 显式别名 + `focus` 深链 |
| 3 | error URL 直接进不可用界面 | `navigate_main` 的**去重水位在"发起导航"时就置位**，而 wry 的 macOS 委托**只上报成功**（无 `didFailProvisionalNavigation`），于是"加载失败"既不可观测、又永不重试 → 永久停在错误页；且 macOS 应用菜单**没有「引导页」逃生入口** | P0 已落地：导航状态机 + 探活 + 看门狗 + 失败回退 + macOS 逃生菜单（§3.5、§4.7） |
| 4 | 启动逻辑 | 导航权在 Rust 轮询器手里，前端只是旁观者：前端可能正跑向导却被导航走；三处状态真相源（轮询事件 / `bootstrapStatus` / 前端内存）时序不一致 | 改为**单一所有者状态机 + 前端握手导航**：Rust 是唯一权威，前端只在"我准备好接管"时请求进入 Web 界面（§4） |

**三条不变量**（后续任何改动都不得破坏）：

- **I1 页面二值性**：主窗口只允许停在两种页面之一 —— 本应用 SPA，或**已确认加载成功**的 dsh Web GUI。任何第三种状态必须在 8 秒内被自动纠正。
- **I2 导航单一所有者**：只有 Rust 能导航主窗口，且导航必须由"前端握手"或"用户显式动作"开启；轮询器不得盲导航。
- **I3 失败必带出口**：每个失败态都必须有用户可见的原因 + 至少一个出口（重新连接 / 回到引导页 / 导出诊断）。永不出现"只能退出应用"的界面。

---

## 1. macOS 顶栏为什么"比正常小"

### 1.1 实测数据（本机 macOS 27.0.1，Swift/AppKit 直接量）

用一段 AppKit 探针按 `tauri.conf.json` / `open_console` 的真实窗口参数建窗（`.titled + .fullSizeContentView`、`titlebarAppearsTransparent = true`、`titleVisibility = .hidden`）：

```
== Overlay(hiddenTitle) window ==
window.frame.height           = 680.00
contentLayoutRect             = (0.00, 0.00, 920.00, 648.00)
titlebar band (frame-content) = 32.00        ← 系统保留的标题栏带
close size=14.0x14.0  topInset=9.00  leftInset=9.00   centerY=16.00
min   size=14.0x14.0  topInset=9.00  leftInset=32.00  centerY=16.00
zoom  size=14.0x14.0  topInset=9.00  leftInset=55.00  centerY=16.00
== plain titled window ==      titlebar band = 32.00
== unified toolbar window ==   titlebar+toolbar band = 52.00
```

要点：**原生标题栏带 = 32pt**；红绿灯 14×14pt、上内边距 9pt、左内边距 9/32/55pt、视觉中心在 **y=16pt**；带统一工具栏的窗口 = **52pt**。

### 1.2 而应用里现在有三个数

| 位置 | 代码 | 值 | 与系统比 |
|---|---|---|---|
| 主窗口拖拽条 | `desktop-tauri/src/App.tsx:37` `h-7` | **28pt** | 比原生带 **少 4pt** |
| 控制台自绘标题栏 | `desktop-tauri/src/console/TitleBar.tsx:16`、`:56` `h-10` | **40pt** | 比原生带多 8pt，比工具栏标准少 12pt |
| dsh Web GUI 注入层 | `desktop-tauri/src-tauri/src/lib.rs:344` `height:28px` | **28pt** | 比原生带少 4pt |

### 1.3 机制：Overlay 下系统不会替你留位

**【已核实】** `tauri-runtime-wry-2.11.4/src/lib.rs:1211-1213`：

```rust
TitleBarStyle::Overlay => {
  self.inner = self.inner.with_titlebar_transparent(true);
  self.inner = self.inner.with_fullsize_content_view(true);   // ← content 覆盖整窗
}
```

`fullsizeContentView = true` 的含义是：webview 从 y=0 开始，**整个 32pt 标题栏带被压在内容之上**，红绿灯浮在（9,9)–(69,23) 这块区域。系统不会给 HTML 留任何位置，所有"顶栏"都得自己画、自己对齐。

这带来两个必然结论：

1. **28pt 的拖拽条 < 32pt 的原生带**：红绿灯底部在 23pt，视觉重心 16pt；28pt 的条子在视觉上偏窄，红绿灯几乎占满，看起来"顶栏被压扁了"。主窗口里这条还是**完全透明**的，所以用户看不到"顶栏"，只看到内容从最顶端开始。
2. **40pt 的自绘栏与 32pt 原生带不同轴**：红绿灯中心 16pt vs 标题行中心 20pt，差 4pt；同时 40pt 又比 macOS 用户熟悉的 52pt 工具栏窗口薄一截 —— 这是"比正常小"最直接的来源。

### 1.4 规范（本轮落地 + 待确认）

**统一 token：`--titlebar-h`**

| 平台 | 值 | 构成 | 状态 |
|---|---|---|---|
| macOS（自有窗口） | **52pt** | 顶部 32pt 行与原生标题栏带完全重合（标题、红绿灯同轴心 16pt）+ 下方 20pt 应用工具行 | 本轮落地（控制台） |
| macOS（自有 SPA 顶部的隐形拖拽区） | **32pt** | 与原生带等宽，红绿灯正好落在其中 | 本轮落地（`DragStrip`、Web GUI 注入层 28→32） |
| macOS（显示 dsh Web GUI 时） | 32pt 注入层 | 外部页面改不了内部布局，只能保证注入层与系统带同轴 | 本轮落地 |
| Windows | **40pt** | 自绘 Chrome 风格三键 | 保持现状 |

**P1（待你确认后做）**：主窗口目前的"顶栏"其实是 32pt 隐形条 + 居中卡片，用户看不到任何应用身份。建议按上表给主窗口一套真实 52pt 顶栏（左侧 DSH Pocket 字标、右侧 Worker 状态胶囊 + 控制台入口），这样引导面/向导/主界面三态共享同一套 chrome，也与控制台窗口观感一致。

**⚠️ 已知取舍**：注入到 dsh Web GUI 上的拖拽层是"整条 32pt 覆盖"，会吞掉该区域内的页面点击。这是 Overlay 方案的固有代价；若 dsh Web GUI 自己有顶部按钮，需要改为"仅在红绿灯左侧 80pt 区域可拖拽 + 其余 `pointer-events:none`"（P1 项，需先确认 dsh web 顶栏控件位置）。

---

## 2. 控制台 / 设置类页面冗余诊断

### 2.1 现状盘点

控制台 5 页（`ConsoleApp.tsx:18-24`）+ 引导面 + 6 步向导 + 原生菜单/托盘，共 7 个界面在讲同一批事：

| 页面 | 行数 | 解决的问题 | 独有内容 | 重复占比（粗估） |
|---|---|---|---|---|
| 运行状态 `StatusPage.tsx` | 376 | Worker 死活与启停 | 启停、修复、诊断、文件路径 | ~35% |
| 账号 `AccountPage.tsx` | 371 | 登录态 | 二维码、设备凭据 | ~30%（两张卡字段互重） |
| 版本 `VersionsPage.tsx` | 290 | dsh 多版本 | 已装列表、切换、删除 | ~25% |
| 日志 `LogsPage.tsx` | 111 | 看日志 | 日志正文 | ~70%（= 状态页诊断区展开版） |
| 设置 `SettingsPage.tsx` | 170 | 启动参数 | 端口/监听/名称可编辑 | ~60%（同一批参数在状态页只读展示） |
| 引导面 `GuidePage.tsx` | 241 | 环境修复 | 预检清单 + 内联修复 | 与向导 ~60% |
| 向导 `OnboardingWizard.tsx`+6 步 | 354+ | 首次安装 | 下载进度 | 与引导面 ~60% |

### 2.2 重复矩阵（证据）

| 事项 | 运行状态 | 账号 | 版本 | 日志 | 设置 | 引导面 | 向导 | 菜单/托盘 |
|---|---|---|---|---|---|---|---|---|
| Worker 启停 | `StatusPage.tsx:158-176` | | | | | `GuidePage.tsx:204-216` | | `lib.rs:410-411`、`616-617` |
| dsh 当前版本 | `StatusPage.tsx:236-245` | | `VersionsPage.tsx` activeVersion | | | | `HarnessStep` | |
| dsh 已装版本/切换/删除 | | | `VersionsPage.tsx:148-246` | | | | | |
| dshc 版本 + 更新 | `StatusPage.tsx:225-227` | | | | | `DshcUpdateCard` | `DshcUpdateCard` | `menu:update` `lib.rs:745-765` |
| 应用版本 + 更新 | `StatusPage.tsx:196-222` | | | | | | | `lib.rs:745-765` |
| 端口 / 监听 | `StatusPage.tsx:272-274`（只读） | | | | `SettingsPage.tsx:110+`（可编辑） | | | |
| 电脑名称 | `StatusPage.tsx:275` | | | | `SettingsPage.tsx` | | | |
| 网关地址 | `StatusPage.tsx:271` | | | | （隐式 `gatewayUrl`） | | | |
| 登录态 / 账号 | | `AccountPage.tsx:142-148`、`310-366` | | | | `AccountStep` | 向导登录步 | |
| 日志正文 | `StatusPage.tsx:352-363`（诊断块） | | | `LogsPage.tsx:96+` | | | | |
| 文件路径 | `StatusPage.tsx:285-308` | | | `LogsPage` 头 | | | | |
| 修复 | `StatusPage.tsx:314-350` | | | | | `GuidePage.tsx:91-111` | 各步 | |
| 环境预检 | | | | | | `GuidePage` preflight | 向导 step 序列 | |
| 开机自启 | | | | | | | | `lib.rs:412`、`606`、`639` |

### 2.3 冗余的真正代价

不是"多几个 tab"，而是**同一件事有多个入口，且各入口状态不同步**：

- 用户在「设置」改了端口 → 需要重启 Worker 生效（`SettingsPage.tsx:33`）→ 但「运行状态」页显示的是 `run.json` 的**旧**监听地址，两页打架。
- 「版本」页切换 dsh 版本后，`StatusPage` 的版本徽标要等下一次 3s 轮询才变。
- 「日志」页与状态页诊断块各拉一次 `read_log`，**Guideline**：同一份数据源被两个页面独立请求。

### 2.4 精简提案：5 页 → 3 页（推荐方案 A）

| 导航项 | 承载 | 被合并进来的东西 |
|---|---|---|
| **运行** | ① 状态头（状态点 + 启停 + 「进入 Web 控制台」）② 更新区（应用 / dshc / dsh，三卡合一）③ **运行参数**（端口/监听/名称/网关，原「设置」页，就地编辑 + 保存）④ *高级（折叠）*：文件位置、诊断文本、日志尾部、尝试修复、导出诊断 | `SettingsPage` 全部、`LogsPage` 全部、`StatusPage` 的路径/诊断/修复卡 |
| **账号** | 一张「登录状态」卡：未登录 → 扫码（三步指引 + 倒计时）；已登录 → 身份 + 凭据摘要；Token 细节（到期/写入/文件）折叠 | 去掉 `AccountPage` 两卡重复的 邮箱/用户ID/凭据文件 字段 |
| **版本** | 应用更新 + dshc 更新 + dsh 已装/可装 三区，统一"当前/可更新/操作"三列 | 状态页的两张更新卡、`DshcUpdateCard` 的第二处渲染 |

**兼容代价**（必须一并改）：

- `ConsoleApp.tsx:16` 的 `PanelId` 与 `:18-24` 的 `NAV`；
- 深链 `?panel=` 与 `open_console(panel)`：`lib.rs:708`（`menu:settings`）、`:768-770`（`console:<panel>`）、托盘 `lib.rs:400-403`、菜单 `lib.rs:610-614`；
- 旧值映射：`settings` → `run`（并滚动到参数区）、`logs` → `run`（展开高级）、`status` → `run`。

**方案 B（更激进，2 项）**：运行 / 账号，把「版本」整体并入"运行"的更新区。
**方案 C（只做减栏，不动结构）**：保留 5 页，但删「日志」页（并入诊断块）、把「设置」折进「运行状态」，导航 5 → 3，页面内容基本不动。

**推荐 A**：它同时解决"导航太多"和"数据源分散"，迁移面可控（只有 1 个文件 + 4 处菜单 id）；C 看着改动小，但两页架构性重复（只读展示 vs 可编辑）没解决。

### 2.5 反证（哪些"冗余"其实是必要的）

- **预检清单 vs 向导不是纯重复**：引导面给"逐项内联修复"，向导给"下载进度 + 分步叙事"，两者交互模型不同。合并的前提是把"下载进度"搬进引导面的卡片内联区。**建议 P2 再动，不与本轮混做。**
- **「版本」页不能删**：dsh 是多版本可切换的真实功能（`VersionsPage.tsx:148-246`），且是售后排查的第一入口。
- **`repair` / `export_diagnostics` 必须保留一个可发现入口**：这是"用户打不开控制台时的最后一根绳子"（`StatusPage.tsx:313-350`），合并后必须留在"运行"页顶层，不能埋进折叠区。

---

## 3. "error URL 直接进入不可用界面"根因链

### 3.1 as-is 时序

```
setup (lib.rs:2503-2576)
  ├ build_tray / install_menu
  ├ spawn boot 线程：read_status → !running → start_worker（`:2562-2574`）
  └ start_poller（`:2559`）
start_poller（`:505-599`）每 3s：
  ├ read_status → run.webUrl                                `:528-533`
  ├ 掉线自愈 start_worker（`:550-563`）
  ├ navigate_main(app, web_url)                             `:587`
  ├ selfheal_auth_probe(app, web_url)                       `:588`
  └ emit("worker-status")                                   `:589`
navigate_main（`:224-261`）：
  ├ LAST_WEB_URL 去重：`if *last == target { return }`       `:230-232`
  ├ 只放行 loopback                                         `:238-241`
  └ win.navigate(parsed).is_ok() → *last = target            `:243-246`
```

### 3.2 致命点：失败既不可观测、又永不重试

**（a）`navigate()` 的 `Ok` 只代表"导航已发起"**，不代表页面可用。`*last = target` 在第 243-246 行**发起时**就置位。

**（b）失败在 Tauri 侧完全不可观测——但两个平台的原因不同，这一点必须分清**（独立复核纠正了我最初的"一刀切"结论）：

| 平台 | 源码 | 失败时发生什么 |
|---|---|---|
| macOS / WKWebView | `wry-0.55.1/src/wkwebview/navigation.rs:20-46`：只实现 `did_commit_navigation → Started`、`did_finish_navigation → Finished`，**没有 `didFailProvisionalNavigation` / `didFailNavigation`** | 连接被拒时连 `didCommit` 都不触发 → **连 `Started` 都收不到**。只能靠"发起导航时上表的超时看门狗"发现失败 |
| Windows / WebView2 | `wry-0.55.1/src/webview2/mod.rs:654-668`：`add_NavigationCompleted` 的回调**丢掉了 `IsSuccess` 参数**，无条件报 `Finished` | 失败也走 `Finished` → 若只看"Finished + 同源"就会判 **Live**，看门狗永不触发。必须靠**页面内容自证**（错误页专有错误码/文案）兜底 |

改动前整个应用**没有任何一处**注册 `on_page_load`（`grep on_page_load desktop-tauri/` 无结果，现已注册，见 §4.7），所以这两条信号都没用上。

**（c）两个致命点叠加** ⇒ 一旦导航到一个当时不可用的 URL：

1. `*last = target` 已置位；
2. worker 随后恢复，`run.json` 的 `webUrl` **字符串没变**（token/端口相同）；
3. 下一个 tick `*last == target` → `return`，**永不重试**；
4. `selfheal_auth_probe`（`:324-358`）只匹配页面文案 `/authentication required/i`（`:338`）——WKWebView 的网络错误页 `document.body.innerText` 里没有这句话，不匹配；
5. macOS 应用菜单（`:632-654`）里**没有 `menu:guide`**（`menu:guide` 只存在于非 macOS 分支 `:662`）→ 用户没有"回引导面"的菜单出口；
6. `⌘R` → `reload_main_webview`（`:266-279`）要求"当前 origin == 目标 origin"才 reload → 错误页同源 → reload 后又失败。

**结论：这是一条"进去了就永久出不来"的路径，与用户描述完全吻合。**

### 3.3 触发它的现实场景（按概率排序）

| # | 场景 | 证据 |
|---|---|---|
| 1 | **残留 `run.json` + 工具链缺失**：`read_status` 的降级分支（`:203-218`）在 `dshc status` 调不动时，只要 `run.json` 里有 `webUrl` 就上报 `running:true, toolchainMissing:true` → 轮询器拿这个**上次会话的旧 webUrl** 去导航 | `lib.rs:203-218` + `:528-533` |
| 2 | **dsh web 正在起**：URL 由 dsh 进程打印 `dsh web: http://127.0.0.1:PORT/?token=…` 时写入 `run.json`（`node-sidecar/bridge/dist/cli/index.js:264` `mergeRunInfo({webUrl})`），写入与"端口真能连上"之间有窗口期 | `index.js:252-265` |
| 3 | **401 页 + 自动重认证失败**：dsh web 认证后会把 token 从 URL 剥离，`location.reload()`（`:278`、`:302`）会打到无 token 的 401 页；重认证一次不成功就卡住 | `lib.rs:321-323` 注释 + `:351-357` |
| 4 | **向导被导航打断**：前端在 `phase==="wizard"` 时，轮询器照样导航走（无门控） | `App.tsx:52-77` vs `lib.rs:587` |
| 5 | **`APP_URL` 捕获到非应用地址**：`setup` 在 `win.url()` 仍是 `about:blank` 时捕获（`:2544-2550`），`navigate_main("")` 会导航到空白页 | `lib.rs:2544-2550`、`:249-259` **【推断】** 未实测竞态 |

### 3.4 现有恢复机制为什么救不了

| 机制 | 位置 | 能救 | 救不了错误页的原因 |
|---|---|---|---|
| 掉线自动重启 | `lib.rs:550-563` | worker 崩了 | 与"主窗口导航失败"正交 |
| 401 探针自愈 | `:324-358` | 成功加载的 401 页 | 网络错误页无该文案；且必须在**已加载**的页面上跑 eval |
| 回焦整页刷新 | `:283-303` | 长驻页面事件流僵死 | 刷新的是错误页本身 |
| `⌘R` 刷新界面 | `:266-279` | dsh web 页面僵死 | 同源判定通过 → 继续刷新错误页 |
| `repair` 一键修复 | `StatusPage.tsx:321` | 端口/工具链问题 | **只在控制台窗口里**，而控制台要用户先能点到 |
| `export_diagnostics` | `StatusPage.tsx:325` | 取证 | 同上 |
| 托盘「打开主界面」 | `lib.rs:399`、`:688-693` | 窗口被隐藏 | 只 show/focus，不纠正页面 |

### 3.5 修复思路（本轮已落地）

把"导航"从一次性动作改造成**有状态、有探活、有看门狗、有回退**的流程：

```
探测（TCP 探活，1.5s）→ 导航 → 看门狗（8s 等 Finished）→ 成功=Live / 失败=回退到 SPA + 恢复卡
                     ↑                                                      │
                     └──────────── 退避重试（2s→4s→8s→16s→封顶 30s）────────┘
```

---

## 4. 启动逻辑重设计

### 4.1 设计原则（对应"使用习惯"）

| 习惯 | 现状 | 设计 |
|---|---|---|
| 双击图标要立刻看到东西 | 前端 `phase==="checking"` 显示"正在启动…"（`App.tsx:116-125`） | 首帧直接出引导面骨架（清单占位 + 骨架条），状态到了再填充；`checking` 不再是一个空屏状态 |
| 首次使用要一次装完 | 引导面与向导两套流程，用户要自己选 | 首启（无 `onboarding-done.json`）直接进向导；已有环境时引导面只显示"缺什么 + 一键补" |
| 开机自启要安静 | `--minimized` 隐藏窗口（`:2552-2556`） | 保留；并**禁止**在窗口不可见时导航（自启时导航没意义，还会在用户打开窗口的瞬间暴露一个未验证的页面） |
| 关窗≠退出 | `on_window_event` prevent_close + hide（`:2579-2583`） | 保留；补：托盘/菜单「打开主界面」时若窗口停在非预期页面，先纠正再显示 |
| 第二次启动只聚焦 | 单实例插件聚焦窗口（`:2446-2452`） | 保留；补：若当前停在本应用 SPA，顺带请求一次"进入 Web 界面" |
| 永远留一条退路 | macOS 无 `menu:guide` | 所有平台都加「回到引导页」（macOS `⌘⇧G`） |

### 4.2 目标状态机

Rust 侧唯一权威（前端只渲染）：

```
                 ┌──────────────────────────────────────────────┐
  ColdStart ──►  │ Probing          读 toolchain / onboarding / run.json，不导航
                 └───────┬──────────────────────────┬───────────┘
                         │ 环境不齐                  │ 环境齐
                         ▼                          ▼
                 ┌──────────────┐          ┌──────────────────┐
                 │ NeedsSetup   │          │ WorkerDown       │ 自动拉起 + 退避
                 │ (硬门槛向导)  │          └────────┬─────────┘
                 └──────┬───────┘                   │ webUrl 出现
                        │ 用户修完                    ▼
                        │                  ┌──────────────────┐
                        └─────────────────►│ Connecting       │ 探活(1.5s) → 导航
                                           └────────┬─────────┘
                                        ┌───────────┴────────────┐
                                  8s 内 Finished            8s 超时/探活失败
                                        ▼                        ▼
                                 ┌──────────┐            ┌──────────────┐
                                 │ Live     │            │ Unreachable  │ 回退 SPA + 恢复卡
                                 └────┬─────┘            └──────┬───────┘
                                      │ 401/掉线/唤醒                │ 退避重试
                                      ▼                            │
                                 ┌──────────┐                      │
                                 │ Recover  │◄─────────────────────┘
                                 └──────────┘
```

### 4.3 转移表（判定条件与动作）

| 当前 | 条件 | 下一状态 | 动作 |
|---|---|---|---|
| ColdStart | `bootstrap` 完成，缺 node/bridge/dsh | NeedsSetup | 前端向导（硬门槛），**禁止导航** |
| ColdStart | 环境齐，worker 未跑 | WorkerDown | `start_worker`，退避 1s→…→10min（沿用 `restart_interval`） |
| WorkerDown | `run.json.webUrl` 非空且探活 OK | Connecting | `win.navigate(webUrl)`，`armed_at=now` |
| WorkerDown | `webUrl` 空持续 >60s | WorkerDown | 前端显示"启动较慢"卡 + 看日志/重试出口 |
| Connecting | 收到 `Finished` 且 origin == target | Live | 清 attempts，前端撤掉恢复卡 |
| Connecting | `armed_at.elapsed() > 8s`（`Pending` 期间轮询压到 1s，所以真的是 ~8s） | Unreachable | `navigate(APP_URL)` + emit `web-surface-failed`；attempts+1 |
| Unreachable | 退避到点且探活 OK | Connecting | 重试（用户点「重新连接」= 立即重试） |
| Connecting/Live | 页面自证是错误页（标题打标命中） | Unreachable | 同上（Windows 的失败 `Finished` 靠这条兜） |
| Live | 前端/用户请求回引导 | NeedsSetup/Idle | `navigate(APP_URL)`，清 target |
| Live | 401 探针命中 | Connecting | 强制重导航（沿用 `selfheal_auth_probe`，但现在受看门狗保护） |
| Live | worker 掉线 | WorkerDown | 自动重启（沿用），重启后 webUrl 变化 → 新 target |

### 4.4 导航权收归前端握手（解决"向导被导航走"）

新增 Tauri 命令：

- `enter_web_surface()`：前端在"我已准备好让出窗口"时调用（`phase==="guide"`、非向导模态、且 `status.run.webUrl` 非空）。
- `web_surface_state()`：返回 `{ phase, target, attempts, reason }`，供恢复卡渲染。
- 事件 `web-surface-failed`：Rust 回退到 SPA 后携带原因（`unreachable` / `timeout` / `auth`），前端据此显示恢复卡。

轮询器**不再**直接调用 `navigate_main`；它只更新状态并 emit。这样：

- 向导永远不会被导航打断（开关没打开）；
- 自动进入 Web 界面仍然存在（前端在 guide 态自动握手一次）；
- 失败回退后前端能渲染原因，而不是空白。

### 4.5 错误分类与恢复矩阵

| 层 | 检测方式 | 用户看到 | 出口 |
|---|---|---|---|
| 工具链缺失 | `toolchain::resolve` 失败 | 向导（硬门槛） | 一键安装 |
| 未登录 | 预检 `account` 项 | 引导面扫码 | 扫码 / 浏览器登录 |
| Worker 未运行 | `run.json` / `status` | 引导面「启动 Harness」 | 自动拉起 + 手动重试 |
| Worker 启动失败 | `dshc start` 返回 / 超时 | 引导面错误卡（原因原文） | 重试 / 尝试修复 / 导出诊断 |
| webUrl 迟迟不出现 | 计时 >60s | "Harness 启动较慢"卡 | 看日志 / 重试 / 导出诊断 |
| 端口被占 | `port_cleanup` / 预检 | 端口冲突卡 | 一键清场 |
| **webUrl 不可达** | 探活失败 / 8s 看门狗超时 | **恢复卡**："本机控制台没有响应" | 重新连接 / 回到引导页 / 导出诊断 |
| 401 认证失效 | 标题探针（沿用） | 无感（通知"已自动重新认证"） | 自动重导航 |
| 前端自身白屏 | Rust 侧兜底（见 §4.6） | 恢复卡 | 重新加载界面 |

### 4.6 前端白屏兜底【P1】

前端加载完成后立刻 `invoke("frontend_ready")`；Rust 侧记录主窗口 SPA 的每次导航，若导航到 `APP_URL` 后 5s 内没收到 `frontend_ready`，则判定前端崩了，`eval` 一次 `location.reload()` 并最多重试 2 次，仍失败则 emit 一个纯 Rust 生成的兜底提示（`win.eval` 直接写 `document.body.innerHTML`）。

### 4.7 本轮已落地（P0）

| 项 | 文件 |
|---|---|
| 导航状态机 `NavPhase/NavState` + 纯函数决策 + 单测 | `src-tauri/src/lib.rs` |
| 导航前 TCP 探活（1.5s，仅 loopback，**零副作用**：只连 socket 不发 HTTP，避免探测消耗 token） | `src-tauri/src/lib.rs` |
| 导航看门狗（8s 无 `Finished` → 回退 + 事件） | `src-tauri/src/lib.rs` |
| 全局 `on_page_load` 注册（成功即 Live / 记录 APP_URL） | `src-tauri/src/lib.rs`（`run()`） |
| 前端握手 `enter_web_surface` / `web_surface_state` / `leave_web_surface` | `src-tauri/src/lib.rs` + `src/lib/worker.ts` |
| 恢复卡 UI（重新连接 / 打开诊断 / 回到引导页） | `src/App.tsx` |
| macOS 菜单补「回到引导页」`⌘⇧G`（原只有 Windows/Linux 有） | `src-tauri/src/lib.rs` |
| `⌘R` 在应用 SPA 上也生效；在 Web 界面上改为"带 token 重新导航"（裸 reload 会打到 401） | `src-tauri/src/lib.rs` |
| 窗口不可见（`--minimized` 自启）时不导航，闸门保持，打开窗口后接上 | `src-tauri/src/lib.rs` |
| 探活连续失败 `NAV_PROBE_FAIL_LIMIT`(6) 次后亮恢复卡并关闸——否则用户会永远停在"正在启动…"上（不变量 I3） | `src-tauri/src/lib.rs` |
| **页面自证不可达**（`UNREACHABLE_PROBE_JS` → 标题打标）：兜住 Windows（失败也报 Finished）与"HTTP 成功但内容就是错误页" | `src-tauri/src/lib.rs` |
| 前端声明意图 `set_web_surface_intent`：向导/模态盖住窗口时关闸，杜绝"闸门粘滞"（I2） | `src-tauri/src/lib.rs` + `src/App.tsx` |
| 用户显式重试 `retry_web_surface`：**握手不再清失败水位**（否则上限永不生效 → 无限弹回） | `src-tauri/src/lib.rs` + `src/App.tsx` |
| `Live` 落在 SPA 上的死角修正：SPA 加载完成即把相位从 Live 降为 Failed | `src-tauri/src/lib.rs` |
| "目标消失 → 回引导面"改用 **origin 比对**（原用 loopback 判定，dev 下每 3s 重载引导面） | `src-tauri/src/lib.rs` |
| `APP_URL` 记录**放开 loopback**（dev 态 SPA 就是 localhost:1420；早先的排除会让 dev 下逃生入口全失效） | `src-tauri/src/lib.rs` |
| 看门狗节流：`Pending` 期间轮询周期压到 1s，保证"8s 内纠正"不被轮询退避拖成 60s+ | `src-tauri/src/lib.rs` |
| 单实例聚焦 / 托盘「打开主界面」`nav_nudge`（兑现 §4.1 的承诺） | `src-tauri/src/lib.rs` |
| `autoRetry` 直接取闸门状态（原按阈值推算，会出现"卡上写已用尽、Rust 还在重试"） | `src-tauri/src/lib.rs` + `src/lib/worker.ts` |
| 回退失败不再静默：`APP_URL` 缺失时打日志 | `src-tauri/src/lib.rs` |
| `nav-state` 事件接进恢复卡（原 `onNavState` 是死代码） | `src/App.tsx` |
| 并发加固 ①：**先置位再导航**（`Finished` 回调在主线程可能先到，否则目标页会被误记成 APP_URL） | `src-tauri/src/lib.rs` |
| 并发加固 ②：loopback 页面绝不写入 `APP_URL`（dsh Web GUI 也在 loopback，写错会形成回退死循环）；setup 阶段拒收 `about:blank` | `src-tauri/src/lib.rs` |
| macOS 顶栏 52pt（内部 32pt 行与原生带重合）/ 拖拽条 28→32pt / 注入层 28→32px | `src/console/TitleBar.tsx`、`src/App.tsx`、`src-tauri/src/lib.rs` |
| 浏览器态调试入口 `?onboarded`（引导面形态）、`?navfail`（恢复卡形态） | `src/lib/worker.ts` |
| `verify:ui` 修正：主窗口断言曾只认 `h1`，而 mock 落向导态（无 h1）→ **改动前后都误报 ❌**；改为覆盖两种合法形态 + 新增引导面/恢复卡两项检查 | `tool/verify-ui.mjs` |

### 4.8 后续（P1/P2）

- **P1**：主窗口真实 52pt 顶栏（§1.4）；注入拖拽层改为"仅左侧 80pt 可拖拽 + 其余 `pointer-events:none`"；前端白屏兜底（§4.6）；`Probing` 首帧骨架。
- **P2**：控制台 5 页 → 3 页（§2.4 方案 A）；引导面与向导合并为一套流程（§2.5）。

### 4.9 明确不做（以及为什么）

- **不删 `LAST_NAVIGATED_AT` / 回焦自愈**：它治的是"页面活着但事件流僵死"，与导航失败正交，两套机制并存。
- **不在探活里发 HTTP**：会与 `?token=` 的语义耦合（万一是一次性 token，探测就把真导航废了）；TCP 连得上就足够判定"端口在听"。
- **不做"多窗口各一份导航状态"**：只有主窗口会离开本应用 SPA，控制台窗口永远是 SPA，加维度只会增加状态不一致的风险。

---

## 5. 验证方式与结果

| 层 | 命令 | 覆盖 | 本轮结果 |
|---|---|---|---|
| Rust 纯逻辑 | `cargo test --lib`（`src-tauri/`） | 导航决策/退避/看门狗/loopback 白名单 + 既有 recovery/toolchain 测试 | **44 passed / 0 failed**（新增 5 例） |
| Rust 编译 | `cargo check --lib --all-targets` | 全量类型检查（含测试目标） | 通过，无警告 |
| 稳定性 | `cargo test --lib` × 6 连跑 | 排除偶发失败 | 6/6 通过（顺带修掉 `MockMirror` 的两个测试基础设施缺陷：accept 循环里阻塞读、请求分片被当成路径 → 详见下） |
| 前端构建 | `pnpm --dir desktop-tauri build` | `tsc` + Vite | 通过 |
| UI 无人核验 | `pnpm --dir desktop-tauri verify:ui` | 令牌/布局/层级/交互态 + 主窗口两形态 + 恢复卡出口 | **全部通过**（新增 3 项） |
| 端到端 | 手动：① worker 停着打开 → 停在 SPA 恢复卡而非错误页；② worker 起来 → 自动进入 Web GUI；③ 停在 Web GUI 时 `dshc stop` → 回引导面（`webUrl` 清空分支）；④ `⌘R` 两种页面都有效；⑤ macOS 菜单「回到引导页」可用；⑥ 故意把 `run.json` 的 webUrl 端口改成空端口 → 应探活不过、**不离开** SPA | 见 §3.3 场景表 | 待你在真机跑一遍（本轮未启 GUI：改动涉及真实 Worker 生命周期） |

> ⚠️ 端到端必须真机跑一遍才算完成——单元测试只能覆盖纯逻辑，`navigate/on_page_load/看门狗` 这三条是 I/O 路径。

### 5.1 顺带修掉的测试基础设施缺陷（`toolchain.rs` 的 `MockMirror`）

新加的状态机测试让整套 `cargo test --lib` 被反复连跑，才暴露出这个 e2e mock 镜像的一串问题
（与导航改动无关，但会让"绿/红"失去可信度）。整个过程是三次迭代 + 抓现场，最后定位到**四个真因**：

| # | 真因 | 现场证据 | 修法 |
|---|---|---|---|
| 1 | **accept 循环里做阻塞读**：accepted stream 是阻塞的，只建连接不发请求的客户端会把整条循环挂住 | 偶发超时 | 每条连接单独起线程 |
| 2 | **读超时后仍然回 404**：请求还没到时先写了响应，客户端随后在同一连接上发请求 → 读到预写的 404 | `[mock] short-read bytes=0 raw=""` 紧跟 404 | 没读到请求就不回应、直接关；并把空闲容忍拉到 ~60s（代理会复用上游连接） |
| 3 | **系统 HTTP 代理代理了 loopback**：本机 `scutil --proxy` → `127.0.0.1:7897`，reqwest 的 system-proxy 把 127.0.0.1 的请求也交给代理 → 代理转发用"绝对形式"请求行（`GET http://…/path`）→ 路由匹配失败；代理自身失败则 502 | `502 Bad Gateway`；`raw` 为绝对 URL | mock 兼容绝对形式；**下载客户端对 loopback 一律 `.no_proxy()`**（`http_client()`，本机镜像不走代理本身也是对的语义） |
| 4 | **并发 + 真下载的竞态**：4 个 e2e 用例并行各自起 mock 并真下载压缩包，10 核机器满负荷时偶发内容/时序异常 | 20 轮里偶发 1 次「189 字节全零 / tar 头非法」 | 这四个用例显式串行化（`e2e_lock()`）；并发对被测逻辑没有价值 |

修完 **连跑 20 次整套 44 个用例全绿**（≈880 次执行，0 失败）。

**判据**：如果以后在 CI 里看到 `install_*_from_mirror` / `install_fails_when_shasums_missing` 偶发失败，
先按上表 1→4 的顺序查；尤其别再把 loopback 交给系统代理。

---

## 6. 独立对抗性复核结论与处置

本轮的导航改动跑了一轮独立复核（只读、独立取证）。结论：**macOS 打包态主路径修掉了，但最初版本不是不留死角**。
下面是全部发现与处置，未修的明确标注原因。

| # | 复核结论 | 我的核实 | 处置 |
|---|---|---|---|
| B-4 | **无限弹回**：回退是整页导航 → 新 SPA 又握手；而 `setPhase` 在 `webSurfaceState()` 之前、`nav_request` 又在 Failed 时清零 attempts → 上限永不生效，窗口每 ~10s 弹回错误页 | 成立（时序确实如此） | ✅ 修：状态读取提到 `setPhase` 前；握手分支**不再清 attempts**；新增 `retry_web_surface` 专供显式重试 |
| B-5-1 | **dev 下每 3s 重载引导面**：`!target_present` 分支用 `is_loopback(win.url())` 判"人在 Web 界面"，而 dev SPA 自己就是 loopback | 成立（原 `LAST_WEB_URL` 恰好挡住了这个） | ✅ 修：改判"当前 origin == 刚才的目标 origin" |
| A-③ | **dev 下 APP_URL 恒为 None**：SPA 是 loopback 被拒记 + setup 时可能还是 about:blank → 回退/⌘⇧G/恢复卡全变 no-op | 机制成立（真机待验） | ✅ 修：放开 loopback 记录（"别把 Web GUI 记成应用自身"由同源分支 + 先置位再导航保证）；缺失时打日志 |
| A-① | **Windows 上失败也报 `Finished`**（wry webview2 丢掉 `IsSuccess`）→ 判 Live → 看门狗永不触发 | 成立（已读 wry 源码确认） | ✅ 部分修：新增**页面自证**（错误页错误码/文案打标 → 按失败回退重试）。**WebView2 真机未验**，列为 D-4 |
| B-3 | **闸门粘滞破 I2**：成功一次后进入向导仍会被导航走 | 成立 | ✅ 修：新增 `set_web_surface_intent`，向导/模态占住窗口时显式关闸 |
| B-3 | **"8s 看门狗"受轮询退避牵制**（最坏 ~68s） | 成立 | ✅ 修：`Pending` 期间轮询压到 1s |
| B-5 | **Live 落在 SPA 上的死角**：此后自动导航永久失效 | 成立（我 16:43 的复核只收窄了窗口） | ✅ 修：SPA 加载完成即把 Live 降为 Failed |
| B-6 | **静默失败 + canRetry 与探活上限不一致** | 成立 | ✅ 修：`autoRetry` 改取闸门状态；APP_URL 缺失打日志 |
| B-6 | 首退避实际是 2s，注释/文档写 1s | 成立 | ✅ 修：注释与文档改为 2s 起（2/4/8/16/30s） |
| B-7 | 锁顺序 / emit 主线程 / `drop(s)` / `PageLoadEvent` 路径 / 看门狗先于可见性判断 | 复核确认无问题 | 保持 |
| — | `verify-ui` 那条被改的断言 | 复核实跑确认：旧断言在改动前必红，新断言是**变对**而非变松 | 保持 |
| A-④ | 同源 500/404/空白页判 Live、target 变空丢看门狗、单实例/托盘不纠正页面、⌘R 触发面放大 | 部分成立 | ✅ 部分修：点④前三项（错误页自证、`nav_nudge`、origin 比对）。⏳ 未修：dsh 自己渲染的 500 页（非浏览器错误页）识别不了；⌘R/401 探针在高频 401 下仍可能形成"重导航+通知"节奏（**老代码已有**，已记录） |
| C | `nav_tick`/闸门/APP_URL/竞态**零自动化覆盖**（44 个 `#[test]` 里仅 5 例是导航/直连的纯函数）；`nav-state` 是死代码 | 成立 | ✅ 部分修：`nav-state` 已接进恢复卡。⏳ 未修：mock runtime 集成测试——四个障碍（全局静态需串行、`notify` 需插件 state、MockRuntime 不触发 `on_page_load`、`is_visible()` 恒 true）+ 需要给 `nav_tick` 注入 `now`，属于一轮独立工作 |
| D | 建议在 `[poll]` 日志补 `phase/attempts/has_app_url/win.url()` | 认同 | ⏳ 未做（与 §5 的真机清单配套，建议同批做） |