# DSH Pocket 桌面端（macOS / Windows）

Worker 的 GUI 壳：**Worker 逻辑唯一真相源仍是 `dshc` CLI**（`packages/bridge`），桌面应用通过内置 node sidecar 调用它，不重写 supervisor/profile 逻辑。

## 双窗口架构

| 窗口 | 内容 | 打开方式 |
|---|---|---|
| **主窗口** | DeepSeek Harness 网页壳（webview 全屏内嵌，零 chrome） | 启动即开 / 托盘「打开 Harness 主窗口」 |
| **控制台窗口** | 全部管理面板（状态 / 账号 / dsh 版本 / 日志），shadcn UI | 托盘左键或菜单（独立窗口，与主窗口互不干扰） |

控制台窗口由 `desktop_multi_window` 创建（独立 Flutter 引擎），**应用启动时后台预热**
（`hiddenAtLaunch`，窗口保持隐藏），因此托盘点击是「显示一个已存在的窗口」：实测 1700ms → 约 50ms。
关闭 = 隐藏（引擎保留，再点仍是秒开）；显示时机由主引擎控制，子引擎不自行 show。

主引擎用 `ping` 探活子引擎的方法通道是否就绪（替代原先写死的 800ms 盲等 + 500ms×3 重试），
就绪后再 `navigate` 切面板并 `show`。托盘菜单项经 WindowMethodChannel 通知控制台切换面板。

## 账号登录（手机扫码授权，主路径）

控制台 →「账号」：**未登录时显示二维码**，用手机上的 DSH Pocket 扫码并确认，
这台电脑就登录到同一账号（手机端随即能看到它）。

- **为什么不是「电脑上输账号密码」**：auth 服务（`auth.zhongbei.tech`）不签发跨设备会话，
  桌面端也拿不到账号密码。所以登录走 gateway 的设备授权：手机把「这台电脑」授权给它自己的账号。
- **手机会话不被复制**：桌面端拿到的是 gateway 签发的**设备凭据**（`dshl_<code>.<secret>`，180 天，
  只存 sha256），不是手机的会话 token；桌面端可单独「退出登录」（同时解绑这台电脑）。
- 登录态写入 `~/.deepseek-harness-pocket/device-link.json`（0600），与 `account-session.json`
  （浏览器登录的 auth 会话）分开存放——后者会被 bridge 插件 uplink 读取上送。

### 扫码登录契约（三方：桌面端 / 手机 App / gateway）

二维码负载（协议包 `packages/bridge-protocol/src/device-link.ts`，桌面端 Dart 侧镜像同格式）：

```
dshp://link?v=1&c=<8位一次性链接码>&h=<电脑名>&p=<平台>&gw=<gateway 地址>
```

接口（gateway `POST /api/v1/devices/link/*`，见 `gateway/src/server/api.ts`）：

```
1. 桌面端（未登录，无需鉴权）
   POST /api/v1/devices/link/start   { hostKey, name, platform }
   → { code, secret, expiresAt, intervalMs }        # secret 只在桌面端本地，绝不进二维码

2. 手机 App（已登录，Bearer = 手机会话）
   POST /api/v1/devices/link/approve { code, email? }
   → { ok, workerId, workerName, alreadyBound }      # 服务端把该电脑绑定到手机账号
     410 码已过期 / 404 码不存在 / 422 电脑未连上 gateway

3. 桌面端轮询（凭 secret 证明是发起方）
   POST /api/v1/devices/link/poll    { code, secret }
   → { status: pending|expired } | { status: approved, account:{userId,email}, workerId, credential }

4. 桌面端退出登录
   POST /api/v1/devices/link/revoke  { code, secret }   # 解绑 + 作废凭据
```

- 链接码 5 分钟有效、一次性；`pending` 期间同一台电脑只保留最新一个码。
- 设备凭据可直接作为 Bearer 调 `/api/v1/workers` 等接口（gateway `authUser` 同时认 JWT 与设备凭据）；
  改库、吊销即失效。
- 电脑端**不需要** auth 会话即可被手机绑定：绑定是按 `hostKey` 在服务端完成的。

### 浏览器登录（备选）

控制台账号页仍保留「在浏览器中登录」：跳系统浏览器在掌鲸认证网页登录，
重定向回本机 loopback 回调后保存 auth 会话（`account-session.json`），
bridge uplink 随 `worker-register` 上送 token、gateway 验签后自动绑定。

```
GET {authApiUrl}/login?redirect_uri=http%3A%2F%2F127.0.0.1%3A<port>%2Fcallback&state=<随机串>
302 {redirect_uri}?state=<原样回传>&token=…&refresh_token=…&user_id=<可选>&email=<可选>
```

- `<port>` 优先 37900，被占用时自动改随机端口；回调只监听 127.0.0.1，一次性、5 分钟超时。
- 只写过 token、没有 `refresh_token` 的历史遗留会话（且 token 已过期）会被判为「未登录」并清理，
  界面回到扫码卡片——不会再出现「显示已登录、却什么都没有」的假登录态。

## 功能

- **状态面板**：运行状态 / pid / uptime / 在用 dsh 版本；启动 / 停止 / 重启
- **账号登录**：未登录显示二维码，手机扫码授权登录（见上）；登录方式 / 绑定状态 / 退出登录一目了然
- **dsh 版本管理**：安装到 `~/.deepseek-harness-pocket/runtimes/dsh/<版本>/`（npm `--prefix`，默认 npmmirror 源），多版本并存即时切换，不动系统 npm；也支持「系统 dsh」与「指定路径」
- **日志**：tail `~/.deepseek-harness-pocket/dshc.log`
- **开机自启**：应用注册为 macOS 登录项 / Windows 启动项，启动时自动确保 worker 在跑；
  托盘菜单 checkbox 与系统真实状态一致（每次弹出菜单前重新查询，系统设置里改过也能反映）
- **托盘常驻**：关窗收托盘；托盘只留主入口（控制台 / Harness / 启停 / 开机启动 / 退出），「检查更新」在控制台状态页
- **控制台窗口**：左侧栏可**拖拽调宽**（148–380px）、可**折叠为图标栏**，宽度与折叠态记忆在
  `desktop-settings.json`；双击分隔条也可折叠
- **秒开**：应用启动时后台预热控制台引擎（隐藏），托盘点击只剩「显示窗口」一步
  （实测 1700ms → 约 50ms，见下）
- **自更新**：GitHub Releases + auto_updater（macOS Sparkle / Windows WinSparkle）

## 调试开关（环境变量）

| 变量 | 作用 |
|---|---|
| `DSH_DEBUG_NOTIFY=1` | 立即发一条版本发现通知，验证通知通道 |
| `DSH_DEBUG_AUTOSTART=1` | 只读探测开机自启通道（打印 `isEnabled`）后退出 |
| `DSH_DEBUG_AUTOSTART=toggle` | 额外做一轮 enable→disable（会在系统后台项里留一条 disabled 记录） |
| `DSH_DEBUG_CONSOLE=cold` | 不预热直接打开控制台并打印耗时（复现冷启动） |
| `DSH_DEBUG_CONSOLE=warm` | 预热后打开并打印耗时（真实点击路径），随后退出 |
| `DSH_DEBUG_CONSOLE=stay` | 预热并打开控制台「账号」页且保持运行（人工观察/截图） |

实测（macOS 26.6，debug 构建）：冷启动 `open=1718ms`；预热后 `open=54ms`、重开 `14ms`。

### 开机自启的原生实现（macOS 重要说明）

`launch_at_startup` 这个 pub 包**在 macOS 上没有自带原生实现**（包里没有 `macos/` 目录），
README 要求宿主工程自行接入 `LaunchAtLogin` Swift Package。本项目此前缺这一步，
导致 Dart 侧抛 `MissingPluginException` → 托盘「开机启动」永远显示未勾选、点了也没反应。

现在由 `macos/Runner/MainFlutterWindow.swift` 里的 `AutostartChannel` 直接实现同名 channel：

- macOS 13+：`SMAppService.mainApp`（与「系统设置 → 通用 → 登录项」一致，实测 ad-hoc 签名也可注册）；
- 注册失败或旧系统：回落到 `~/Library/LaunchAgents/<bundle-id>.plist`（RunAtLoad，经 `/usr/bin/open -a` 拉起）；
- 用户在系统设置里关掉后 `status == .requiresApproval`：抛可读错误（系统通知提示去系统设置允许），不静默失败。

Windows 侧仍由该包的纯 Dart 路径（`win32_registry`）负责，无需原生注册。

## 新版本自动发现（桌面通知）

- **自动发现**：应用启动时后台检查一次 appcast，之后每日定时检查（`UpdaterService.init`）。
- **桌面通知**：发现新版本即发系统通知（local_notifier；macOS 通知中心 / Windows toast），
  文案形如「DSH Pocket 有新版本 0.1.9」，点击通知打开控制台状态页。
- **手动入口**：控制台 →「状态」→「检查更新」（Sparkle/WinSparkle 系统对话框）。
- ⚠️ **未签名构建无法静默自动安装**：Sparkle 2 会比对新旧版本的代码签名，
  ad-hoc 签名（当前状态，cdhash 随构建变化）不满足，安装会被拒绝——
  发现与下载正常，但需要用户手动安装。**补上 Developer ID 签名后**，
  这条链路自动升级为静默安装，代码无需改动（appcast 的 EdDSA 校验已就位）。
- 调试通知通道：以 `DSH_DEBUG_NOTIFY=1` 启动应用会立即发一条测试通知。

## UI

控制台窗口（及主窗口引导面）基于 [flutter-shadcn-ui](https://github.com/nank1ro/flutter-shadcn-ui)（`shadcn_ui` 包）：ShadApp / ShadCard / ShadButton / ShadInput / ShadBadge / ShadSelect / ShadRadioGroup / sonner toast，默认 zinc 色板 + 品牌主色 `#4D6BFE`，跟随系统深浅色。

## 目录结构

```
desktop/
  lib/
    main.dart          入口：主窗口引擎 / 控制台引擎分流
    app_nav.dart       面板注册表（托盘/控制台/调试路由共用）
    providers.dart     Riverpod 装配
    services/
      account.dart         账号登录/刷新/绑定/登出（写 account-session.json）
      device_link.dart     手机扫码登录：申请链接码/轮询/吊销（写 device-link.json）
      console_window.dart  控制台窗口创建/预热/探活/跨窗口导航（主引擎侧）
      tray.dart            托盘（双窗口入口 + 开机启动 checkbox）
      worker/runtime/proc/paths/autostart/updater
    ui/
      main_window.dart 主窗口（webview 壳 + 引导面）
      console_app.dart 控制台窗口壳（shadcn + 可拖拽/可折叠侧栏）
      pages/           status / account（扫码登录）/ versions / logs
  test/
    device_link_test.dart        二维码格式 golden（与 TS 侧对齐）+ 设置持久化 + 会话可用性
    device_link_live_test.dart   活体测试：直连真实 gateway（需 DSH_TEST_GATEWAY）
    account_page_test.dart       账号页组件测试（二维码 → 手机确认 → 账号卡片）
  tool/
    build-sidecar.sh    一键准备 sidecar（fetch node + bundle bridge）
    fetch-node.sh       下载 node 发行版 + 装 pnpm 到 sidecar node 前缀
    bundle-bridge.sh    构建 packages/bridge 并暂存（dist + 运行时依赖）
    make-appcast.py     生成 appcast（CI 用）
    make-icons.py       图标生成
  macos/ windows/      平台壳（MainFlutterWindow.swift：多窗口插件回调 + 开机自启原生实现）
  node-sidecar/        构建产物（gitignore，不入库）
    darwin-arm64/{node,bridge}
    windows-x64/{node,bridge}
```

## 开发

```sh
export PATH="…/flutter/bin:$PATH"
flutter create --platforms=macos .   # 已创建，无需重复
flutter pub get
desktop/../desktop/tool/build-sidecar.sh current   # 或从仓库根：desktop/tool/build-sidecar.sh darwin-arm64
flutter run -d macos
```

注意：**sidecar 未准备时控制台顶部有红色提示**，worker 功能不可用。

设置持久化在 `~/.deepseek-harness-pocket/desktop-settings.json`（与 CLI 侧状态同目录）。gateway / 监听地址 / npm registry / 认证服务地址（`authApiUrl`、`authAppId`、`authAppEnvironment`）属内部配置不在界面暴露，需要时直接手改该文件。图标由 `tool/make-icons.py` 生成（改版后重跑脚本）。

## 发布（CI）

打 tag 触发 `.github/workflows/desktop-release.yml`：

```sh
git tag desktop-v0.1.0 && git push origin desktop-v0.1.0
```

产物：macOS zip（Sparkle 更新用）+ dmg、Windows Inno 安装器 + zip、`appcast-macos.xml` / `appcast-windows.xml`，全部挂在 GitHub Release 上。
feed 稳定地址：`https://github.com/monster-echo/deepseek-harness-pocket/releases/latest/download/appcast-{macos,windows}.xml`。

### 需要的一次性配置

1. **GitHub Secrets**（repo 为 public 时 `releases/latest/download/…` 才可匿名访问）：
   - `SPARKLE_ED_PRIVATE_KEY`：`~/.deepseek-harness-pocket/keys/sparkle-ed-private.key` 的内容（macOS EdDSA 私钥）
   - `WINSPARKLE_DSA_PRIVATE_KEY`：`~/.deepseek-harness-pocket/keys/winsparkle-dsa-priv.pem` 的内容（Windows DSA 私钥）
2. 公钥已入库：macOS `SUPublicEDKey` 在 `macos/Runner/Info.plist`；Windows `dsa_pub.pem` 经 `windows/runner/Runner.rc` 的 `DSAPub DSAPEM` 资源嵌入。
3. 若以后仓库转 private：feed 换成 gateway 托管（`dsh-pocket.zhongbei.tech` 静态目录）或 ghproxy 镜像。

### 签名密钥的来历（备忘）

- macOS：`macos/Pods/Sparkle/bin/generate_keys`（写入 keychain），`-x <file>` 导出私钥
- Windows：LibreSSL 生成 1024-bit DSA（OpenSSL 3 无法生成但可签名）：
  ```sh
  /usr/bin/openssl dsaparam -out dsaparam.pem 1024
  /usr/bin/openssl gendsa -out dsa_priv.pem dsaparam.pem
  /usr/bin/openssl dsa -in dsa_priv.pem -pubout -out dsa_pub.pem
  ```
- 私钥文件保留在 `~/.deepseek-harness-pocket/keys/`（0600），勿入库勿外传

## 平台细节

- **macOS**：仅 arm64 包；沙箱已关闭（要 spawn 内置 node 子进程、共享 `~/.deepseek-harness-pocket`）；未签名（Gatekeeper 首次右键打开），后续有 Developer ID 再签名公证
- **Windows**：`dsh-pocket-worker.exe` + Inno 安装器（per-user 安装免管理员）；更新时 WinSparkle 下载 setup.exe 运行
- sidecar 进 app 包：macOS 走 Xcode「Copy node sidecar」Run Script phase；Windows 由发布流水线在 `flutter build` 后拷进 Release 目录（`Bundle sidecar` 步骤）
- `dsh plugin` 需要 pnpm：sidecar node 前缀里装了 pnpm（fetch-node.sh），spawn 时 PATH 前置
