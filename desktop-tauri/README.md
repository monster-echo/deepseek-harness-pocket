# desktop-tauri — DSH Pocket 桌面端（Tauri 2）

已完全取代原 `desktop/`（Flutter，已移除）。架构等价：**壳 + 内置 node sidecar + dshc CLI**；
Worker 逻辑仍唯一收敛在 `packages/bridge`，本应用只是壳。

## 跑起来

```sh
./tool/build-sidecar.sh    # 复用 desktop/node-sidecar/<triple>（APFS clonefile，秒级）
pnpm install && pnpm tauri dev

pnpm dev                   # 纯前端调试（走 mock 数据）
# http://localhost:1420/?window=console
```

## 结构

| 路径 | 作用 |
|---|---|
| `src/index.css` | 设计令牌，与手机端 `react-native/src/global.css` 同源 |
| `src/components/ui.tsx` | shadcn 风格原语 |
| `src/lib/worker.ts` | IPC 桥（Tauri 命令 + 浏览器 mock 降级） |
| `src/guide/GuidePage.tsx` | 主窗口引导面 |
| `src/console/` | ConsoleApp + 5 页（status/pairing/account/versions/logs） |
| `src-tauri/src/lib.rs` | 托盘 / 双窗口 / dshc 托管 / 轮询 / 数据命令 |
| `src-tauri/capabilities/default.json` | **必须同时授权 main 与 console 两个窗口** |

## 已实测验证（真实数据，非 mock）

在装有运行中 Worker 的机器上启动本应用，轮询实测输出：

```
[poll] running=true webUrl=http://127.0.0.1:3080/?token=…
```

一次性证明：应用带全部插件正常启动 → sidecar 解析成功 → `dshc status --json`
调通 → 状态解析正确 → 提取到实时 webUrl（带 token）→ 3 秒轮询正常。
`--minimized`（开机自启模式）实测：进程存活、轮询正常、窗口不弹出。

- `cargo build` 零错误（tauri 2.11.5 + 6 个插件）
- `pnpm build` 通过（tsc + vite 8；CSS 24 KB，JS 271 KB）
- 已注册：`single-instance` / `autostart` / `notification` / `process` / `updater`
- 更新签名密钥对已生成：`~/.tauri/dsh-pocket.key(.pub)`，公钥已写入
  `tauri.conf.json` 的 `plugins.updater`

## 未完成 / 待验证

| 项 | 说明 |
|---|---|
| Windows 运行时验证 | 已做**静态审计**（逐条对齐 Flutter 与 dshc）；真机运行仍需你在 Windows 上验一次 |
| dshc 的 Windows `.cmd` spawn | `packages/bridge/supervisor.ts` 的 `spawn(dshBin,…)` 无 `shell`/`.cmd` 分支，真机上可能起不来（**既有问题，非本次引入**）|
| 版本切换真机验证 | 代码已实现；因会中断当前会话而未实测 |
| 更新链路真发版 | 产物 + 签名 + 清单生成已实测；需配 `TAURI_SIGNING_PRIVATE_KEY` secret 后真发一版 |
| 续期成功路径 | 登录/登出/续期均已实现且错误路径实测；**成功路径**需真实 refreshToken |
| 公证 | 打包 + 签名已通（实测出 .app / .tar.gz / .sig）；macOS notarize 需 Apple 证书 |
| 控制台真实数据校验 | 视觉/布局已核验（走浏览器 mock）；接真实 dshc 数据的运行时表现未验 |
| 截图人工复核 | `docs/screenshots/` 12 张待你过目（当前模型不能读图）|
| ~~删除 `desktop/`（Flutter）~~ | ✅ **已完成**：Flutter 端已移除（在途改动先存档于 commit `6f9b5ac`）；`fetch-node.sh` / `bundle-bridge.sh` 已移入本仓库 `tool/`，sidecar 构建完全自持 |

## 本轮（Round 2）新增

- **账号登录（loopback OAuth）**：Rust 侧 `std::net::TcpListener` 起一次性回调服务 →
  系统浏览器 → 校验 `state` → 写 `account-session.json`（与 Flutter 端同构：
  `version/userId/email/token/refreshToken/updatedAt`），超时 180 秒。
  命令：`account_login` / `account_sign_out`。
- 账号页重写：登录态、用户 ID/邮箱、JWT `exp` 解析出的 Token 有效性与到期时间、
  等待回调的进行态提示、退出登录。
- **dsh 多版本管理**：`dsh_versions_available`（npm view，新→旧）、
  `dsh_install_version`（内置 npm 装到 `runtimes/dsh/<版本>/`，30 分钟超时，
  ETARGET 自动强刷重试一次，失败清理半成品目录）、`dsh_remove_version`。
  版本页重写：已安装列表（体积/时间/当前使用徽章/两步确认删除）+ 可安装列表。
- **修复 CSS 工具类未生成**（见下「踩过的坑」）——这是本轮最关键的修复。

## 本轮（Round 3）新增

- **版本切换**：`dsh_switch_version` —— `dshc stop` → 轮询等进程真退出（最多 15s）
  → `dshc start --detached --dsh <托管 bin>`。UI 上每个非当前版本多一个「切换」按钮。
  ⚠️ **未做真机切换测试**：当前运行的 Worker 正是支撑 DSH 会话的进程，停掉会中断会话。
- **应用自更新打通**：`check_update` / `install_update`（下载安装后 `app.restart()`）；
  状态页在**有新版本时**才显示更新横幅。
- **发布流水线** `.github/workflows/desktop-tauri-release.yml`：双平台矩阵构建 →
  收 dmg/nsis/tar.gz 与 `.sig` → 生成 `latest.json` → 建 Release。
  触发用 `desktop-v*`（原 Flutter 流水线已移除，本流水线接管该前缀）。
- **`latest.json` 生成器** `.github/scripts/make-latest-json.py`：已用假产物实测，
  覆盖正常路径与缺 `.sig` 的报错路径。
- `build-sidecar.sh` 改为**自给自足**：有预置产物就复用，没有就自己拉 node + 构建 bridge，
  CI 与本地同一套脚本。
- 配置开启 `bundle.createUpdaterArtifacts: true`。

## 本轮（Round 4）：补上目视盲区

**背景**：macOS `screencapture` 被 TCC 拒绝（`could not create image from display`，
缺「屏幕录制」权限，无法用程序授予），原生窗口截图这条路走不通；
且当前模型不支持读图，即使有截图我也看不到。

**做法**：绕开原生窗口，用无头 Chrome 渲染 `dist/` 做**程序化视觉核验**
（`worker.ts` 本就有浏览器 mock 降级，正好派上用场），再导出截图供人眼复核。

```sh
pnpm build && pnpm verify:ui          # 核验
pnpm verify:ui:shots                  # 核验 + 导出 12 张截图到 docs/screenshots/
```

**核验覆盖**（全部通过）：

| 项 | 断言 |
|---|---|
| 令牌生效 | 浅色 `oklch(1 0 0)`、深色 `oklch(0.145 0 0)` —— 精确等于 token 值 |
| 布局 | 侧栏 224px、每页有 h1、卡片有 1px 边框、**零横向溢出** |
| 导航选中态 | 选中项 `bg=oklch(0.97 0 0)` vs 未选 `transparent` |
| 文本层级 | 标题 `oklch(0.145)` ≠ 次要 `oklch(0.556)` |
| 等宽 / 数字 | 路径 URL 等宽 5 处、`tabular-nums` 3 处 |
| 交互态 | 按钮 hover 变色、键盘焦点环 `outline-style: solid` |
| 配对二维码 | 168px、33×33 模块、含定位图案路径 |
| 日志页 | 内容渲染 + 等宽字体 |
| 主窗口引导页 | 标题正确、无侧栏（与控制台区分） |
| 控制台错误 | 0 条 |

这套断言的价值在**第 2 轮那个 bug 上得到印证**：当时工具类全部不生成、页面无样式
却**不报任何错**——肉眼容易误判成「设计难看」，而它会直接报背景色/布局不对。

## 本轮（Round 5）：打包验证 + 三个会导致「装上也用不了」的问题

### 抓到的问题（都会让发布包不可用）

1. **`tauri.conf.json` 是脚手架原版**——第 1 轮写的配置整体丢失，只剩第 3 轮补丁
   （updater 那几项）叠在脚手架上。后果：`productName=desktop-tauri`、
   `identifier=com.echo.desktop-tauri`、`version=0.1.0`、控制台窗口定义丢失、
   **`bundle.resources` 丢失**。
2. **资源路径写错**：`node-sidecar/**/*` 是相对 `src-tauri/` 解析的，而 sidecar 在项目根，
   必须写 `../node-sidecar/**/*`。原来那样写只会警告 `path not found`，**打包不含 dshc**。
3. **Tauri 会把 `..` 消毒成 `_up_`**：写成 `../node-sidecar/**/*` 后实际落在
   `Resources/_up_/node-sidecar/`，与解析器找的 `<resource_dir>/node-sidecar` 不一致。
   解析器已加 `_up_` 回退。

另外：`tauri.conf.json` 省略 `version` **不会**回落到 `Cargo.toml`（实测仍报 0.1.0），
必须显式写。

### 为什么之前没暴露

控制台窗口是 Rust 里 `WebviewWindowBuilder` 动态创建的，不依赖配置；
托盘也是 Rust 建的。所以配置缺一堆东西，开发态照样跑得通——
**只有真打包才会露馅**。

### 已实测

```
# 打包后的应用（从 DSH Pocket.app 内运行）
[startup] sidecar=true autostart=false version=0.1.8
[poll] running=true webUrl=http://127.0.0.1:3080/?token=…
```

- `tauri build --debug --bundles app` → 生成 `DSH Pocket.app`（246 MB，含 sidecar）
  与 `DSH Pocket.app.tar.gz`（66 MB，更新用）+ `.sig`（408 B）
- **打包后的应用能自己找到 sidecar 并读到实时 Worker 数据**——修复前装上也用不了
- 通知链路运行时验证：用 `HOME` 指向临时目录 + 伪造 pid 文件制造
  「未运行 → 运行」跃迁，实测 `[notify] 已发出: …`（真实 worker 全程未受影响）
- **开机自启端到端验证**：新增 `--autostart=on|off`（脚本化部署用，无 GUI 也能开关），
  实测创建 `~/Library/LaunchAgents/DSH Pocket.plist`，内容为
  `ProgramArguments=[<bin>, --minimized]` + `RunAtLoad=true`
  —— 自启时静默进托盘不弹窗。验证后已 `off` 复原。

### 注意：DMG 打包在本机失败

`bundle_dmg.sh` 需要 Finder/AppleScript 控制以美化磁盘映像窗口，无 GUI 会话时会失败。
CI 的 macOS runner 有 GUI 会话，通常没问题；但把 `dmg` 从 targets 里去掉只出
`app` + `nsis` 也是可接受的选择。

## 本轮（Round 6）：账号续期 + CI 版本守卫

### 账号 Token 续期（账号功能最后一块）

与原 Flutter 端 `account.dart` 的 `refresh()` 对齐：
`POST {authBase}/api/v1/auth/refresh`，body `{refreshToken}`，头带
`X-App-Id: dshcompanion` / `X-App-Environment: production` / `X-Platform` / `Accept-Language`；
响应取 `{token, refreshToken}`（兼容 `data` 嵌套），**userId/email 沿用当前会话**，重写
`account-session.json`。

UI：Token 过期时按钮高亮；打开账号页若已过期但仍有 refreshToken，**静默自动续一次**
（只试一次，避免死循环）。

新增 `--refresh-account`（脚本化 / 排查用），已实测三条路径：

| 用例 | 结果 |
|---|---|
| 无会话文件 | `[refresh] 失败: 尚未登录`（exit 1）|
| refreshToken 为空 | `[refresh] 失败: 会话缺少 refreshToken，需重新登录`（exit 1）|
| 伪造 token 打**真实端点** | `[refresh] 失败: 登录状态已过期`（exit 1）|

第三条是决定性的：说明 **DNS + TLS + HTTP 全链路打通**（rustls provider 装对）、
拿到了服务端返回的真实错误消息、且 **`system-proxy` 生效**（请求走了系统代理）。
成功路径需真实 refreshToken，未测。

依赖注意：reqwest **0.13 的特征名是 `rustls` 而非 `rustls-tls`**；本仓库显式声明
`rustls-no-provider` + 自带 `rustls/ring` provider，不依赖 updater 的特征并集。

### CI 版本守卫

`tauri.conf.json` 的 `version` 决定更新器比对基准。若 tag 与它不一致，
会出现「更新后版本号没变 → 又被提示更新」的**无限循环**。工作流已加一步，
断言 `tag == tauri.conf.json == Cargo.toml` 三者一致，不一致直接失败。

## 本轮（Round 7）：Windows 路径静态审计

"macOS/Windows 双端一致"是具名要求，但本机只有 macOS，无法运行时验证。
于是把所有平台分支逐个对照 Flutter 端与 dshc 的实现审了一遍。

### 审计结论：与 Flutter 端逐条一致

| 位置 | Windows | macOS | 判定 |
|---|---|---|---|
| sidecar node | `node/node.exe` | `node/bin/node` | ✅ 与 `fetch-node.sh` 一致 |
| npm-cli | `node/node_modules/npm/bin/npm-cli.js` | `node/lib/node_modules/npm/…` | ✅ 与 `AppPaths` 一致 |
| pnpm PATH 前置 | `node/` | `node/bin/` | ✅（pnpm 就装在这两处）|
| 托管 dsh bin | `node_modules/.bin/dsh.cmd` | `…/.bin/dsh` | ✅ 与 `managedDshBin` 一致 |
| 资源目录 | `resource_dir()/_up_/node-sidecar` | 同左 | ✅ 已加 `_up_` 回退 |

### 抓到并修掉的两个打包 bug（两端都受影响）

1. **托盘图标没打进包**：`load_tray_icon` 的开发态回退用的是
   **编译期 `CARGO_MANIFEST_DIR`**——我本机有源码树所以能找到，
   用户机器上没有，**图标找不到 → `build_tray` 失败 → 应用起不来**。
   已把两个图标加进 `bundle.resources`。
   实测方式：把源码里的图标临时移走（模拟用户机器），打包后的应用**仍然存活**。
2. **Windows 托盘图标是单色的**：只复制了 macOS 的 template 图标
   （实测 0/432 带色像素）。Windows 下 `icon_as_template=false` 会当彩色图标用，
   纯黑图标在深色任务栏上几乎不可见。已按平台分别加载（彩色版 432/432 带色）。

### 顺带发现：共享 worker 层的两处 Windows 缺口（既有问题，非本次引入）

1. **`dshc install` 在 Windows 上是空操作**——`autostart.ts` 直接返回
   「Windows 自启暂未自动化：请将 `dshc start` 加入启动项」。
   即 **Flutter 端的 Windows 开机自启从来没生效过**。
   → 本轮实现**没有**这个问题：走 `tauri-plugin-autostart`（Windows 写注册表 Run 键、
   macOS 写 LaunchAgent），完全不碰 `dshc install`。**这一项比 Flutter 端更好。**
2. **`spawn(dshBin, …)` 无 Windows `.cmd` 处理**——`supervisor.ts` 里既无 `shell: true`
   也无 `.cmd` 分支，而 Windows 下 `dshBin` 就是 `dsh.cmd`；Node 的 `spawn` 不带 shell
   无法启动 `.cmd`。这属于 `packages/bridge`，两端同样受影响，**需在真实 Windows 上核实**。

## 踩过的坑（避免重犯）

- **capabilities 必须列出两个窗口**：控制台是独立窗口，只写 `["main"]`
  会让它拿不到 `core:event:allow-listen`，事件订阅静默失效。
- **回退导航不可硬编码 `tauri://localhost`**：Windows 是 `http://tauri.localhost`。
  已改为启动时从主窗口捕获 `APP_URL`。
- **updater 插件缺 `plugins.updater` 配置会直接 panic**（不是警告），必须配 endpoints + pubkey。
- 系统代理 `127.0.0.1:7897`；Rust 在 `~/.cargo` 未进 PATH。
- **`@theme inline` 缺失 = 工具类静默不生成**：Vite 会把 `@import "tailwindcss"`
  当普通 CSS 内联，产物里能看到 Tailwind 的主题变量却**一个工具类都没有**，
  页面渲染成无样式——很容易被误判成「设计难看」。判据：产物中 `.bg-background` 应为 1。
  另：`vite.config.ts` 必须挂 `@tailwindcss/vite` 插件。
- **CSS 类名核验要先反转义**：产物里 `.` `[` `]` `/` 会被写成 `\.` `\[` `\]` `\/`，
  直接 grep 原类名会得到一堆假阳性。
- **单条 bash 写入上限约 2.5 KB**：超过会静默截断或整条丢弃（结果不回显 = 没执行）。
  长文件必须分片追加，且每片写完要在同一命令里 `wc -l` / 括号配平验证。
  本仓库 `lib.rs`（约 800 行）与 `VersionsPage.tsx` 都是这么拼出来的。
- **产物名含空格会打断自动更新**：`productName` 是「DSH Pocket」，Tauri 产出的
  `DSH Pocket.app.tar.gz` 直接拼进 URL 会带空格（Flutter 端产物是连字符无空格，
  这是迁移引入的回归）。`latest.json` 生成器已对文件名做 `quote()` 编码。
- **updater 产物命名**：更新用的是 `*.app.tar.gz`（macOS）与 `*.nsis.zip`（Windows），
  不是 `.dmg` / `-setup.exe` 本体；清单平台键为 `darwin-aarch64` / `windows-x86_64`。
- **写视觉断言时别把浏览器返回色当 rgb 解析**：Chrome 111+ 对 `oklch()` 值
  会**原样返回** `oklch(1 0 0)`，按 rgb 抽数字会得到 `[1,0,0]`（被当成红色），
  于是浅色模式全判失败——是测试错，不是应用错。
- **二维码 SVG 的 `viewBox` 是模块数不是像素**：`viewBox="0 0 33 33"`，
  像素尺寸在 `width/height`（168）。按 viewBox 大小过滤会误判「二维码没渲染」。
- **改完 `tauri.conf.json` 必须回读确认**：本仓库出现过配置整体丢失、只剩脚手架版本，
  而开发态照样跑（托盘与控制台窗口都是 Rust 动态建的），**只有真打包才露馅**。
  打包后务必确认 `.app/Contents/Resources/` 下有 `node-sidecar`（或 `_up_/node-sidecar`）。
- **`bundle.resources` 的相对路径基准是 `src-tauri/`**，不是项目根；
  写 `..` 会被 Tauri 消毒成 `_up_` 目录名。
- **reqwest 0.13 的特征名与 0.12 不同**：TLS 是 `rustls`（不是 `rustls-tls`），
  还有 `rustls-no-provider`。写错会直接 `failed to select a version` 而非编译错误。
- **别只靠别人的特征并集拿 TLS provider**：本仓库显式声明 `rustls-no-provider` 并自己
  `install_default()`，否则 updater 将来改默认特征会静默打断自己的 HTTPS。
- **开发态回退路径用了编译期常量 = 定时炸弹**：`load_tray_icon` 曾回退到
  `env!("CARGO_MANIFEST_DIR")/icons/…`。本机有源码树，所以开发态和本机打包都正常；
  用户机器上没有源码树，**图标找不到 → 托盘构建失败 → 应用起不来**。
  凡是运行时读的资源，都必须进 `bundle.resources`，回退路径只当成开发便利。
- **跨平台资源要按平台分别验证**：macOS 的 template 托盘图标是单色的，
  直接拿到 Windows 用会变成深色任务栏上的一个黑块。判据：数一下不透明像素里
  有多少是「带色」的（`max(r,g,b)-min(r,g,b) > 12`）。

## 本轮新增：手机扫码授权登录（Telegram 同款）

未登录时账号页直接显示**活的二维码**：手机 DSH Pocket「扫码」对准 → 手机上出现
「登录到 DSH Pocket？」确认卡（设备名/平台/来源 IP，**以服务端已注册的 Worker 名为准**，
伪造二维码骗不出假身份）→ 确认后 gateway 把这台电脑绑定到手机账号，并给桌面端签发
独立设备凭据（`device-link.json`，0600，180 天）。手机会话不复制到电脑；
电脑端「退出登录」= 解绑 + 吊销凭据。二维码 5 分钟过期会**自动换新码**，不用手动刷。

| 侧 | 改动 |
|---|---|
| Rust | `device_link_start / device_link_poll / device_link_revoke / read_device_link`（reqwest blocking，复用 `desktop-settings.json` 的 gatewayUrl 推 REST 基地址、`bridge-state.json` 的 hostKey） |
| 前端 | `AccountPage` 未登录 → 二维码卡（三步指引 + 链接码 + 倒计时 + 等待态 + 过期自动刷新）；已授权 → 「手机授权」徽标 + 凭据信息卡 + 退出登录；浏览器登录保留为备选 |
| 依赖 | gateway `/api/v1/devices/link/{start,preview,approve,poll,revoke}`（**需先发布新版 gateway**）；手机 App 扫码确认（见 `react-native/src/features/workers/QrPairScreen.tsx`） |

核验：`cargo check` 零错误；`pnpm build` 通过；playwright 流程核验 13/13
（二维码渲染/secret 不上屏/mock 确认后切登录卡/无页面错误），
截图在 `docs/screenshots/light-account-qr.png`、`light-account-linked.png`。
浏览器态可用 `?panel=account&loggedout` 看到未登录卡片。
