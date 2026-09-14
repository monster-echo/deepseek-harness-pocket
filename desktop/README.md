# DSH Pocket Worker 桌面端（macOS / Windows）

Worker 的 GUI 壳：**Worker 逻辑唯一真相源仍是 `dshc` CLI**（`packages/bridge`），桌面应用通过内置 node sidecar 调用它，不重写 supervisor/profile 逻辑。

## 双窗口架构

| 窗口 | 内容 | 打开方式 |
|---|---|---|
| **主窗口** | DeepSeek Harness 网页壳（webview 全屏内嵌，零 chrome） | 启动即开 / 托盘「打开 Harness 主窗口」 |
| **控制台窗口** | 全部管理面板（状态 / 账号 / 配对 / dsh 版本 / 日志），shadcn UI | 托盘左键或菜单（独立窗口，与主窗口互不干扰） |

控制台窗口由 `desktop_multi_window` 创建（独立 Flutter 引擎），关闭 = 隐藏（托盘再点秒开）；托盘菜单项经 WindowMethodChannel 通知控制台切换面板。

## 账号登录（免扫码）

- 控制台 →「账号」：用与手机 App **相同的掌鲸账号**登录（auth.zhongbei.tech）。
- 登录后会话写入 `~/.deepseek-harness-pocket/account-session.json`（0600）：
  - bridge 插件 uplink 每次连接 gateway 时随 `worker-register` 上送 token，gateway 验签后**自动绑定**账号；
  - 桌面端也会主动调 `POST /api/v1/workers/bind`（hostKey 定位）立即生效。
- 同账号手机端直接看到这台电脑，**无需扫码配对**；「配对」页仅用于共享给其他账号。
- 手机端解绑后会留墓碑（自动绑定不复活），电脑端重新登录或点「绑定这台电脑」可恢复。

## 功能

- **状态面板**：运行状态 / pid / uptime / 在用 dsh 版本；启动 / 停止 / 重启
- **账号登录**：同账号免扫码互联（见上）；登录/登出/绑定状态一目了然
- **配对二维码**：共享给其他账号时的兜底路径；可 rotate 配对 token
- **dsh 版本管理**：安装到 `~/.deepseek-harness-pocket/runtimes/dsh/<版本>/`（npm `--prefix`，默认 npmmirror 源），多版本并存即时切换，不动系统 npm；也支持「系统 dsh」与「指定路径」
- **日志**：tail `~/.deepseek-harness-pocket/dshc.log`
- **开机自启**：应用注册为登录项（launch_at_startup），启动时自动确保 worker 在跑；托盘菜单 checkbox 显示勾选态
- **托盘常驻**：关窗收托盘；托盘菜单 打开控制台/主窗口、启停、开机启动勾选、退出
- **自更新**：GitHub Releases + auto_updater（macOS Sparkle / Windows WinSparkle）

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
      console_window.dart  控制台窗口创建/唤起/跨窗口导航（主引擎侧）
      tray.dart            托盘（双窗口入口 + 开机启动 checkbox）
      worker/runtime/proc/paths/autostart/updater
    ui/
      main_window.dart 主窗口（webview 壳 + 引导面）
      console_app.dart 控制台窗口壳（shadcn + 侧栏导航）
      pages/           status / account / pairing / versions / logs
  tool/
    build-sidecar.sh    一键准备 sidecar（fetch node + bundle bridge）
    fetch-node.sh       下载 node 发行版 + 装 pnpm 到 sidecar node 前缀
    bundle-bridge.sh    构建 packages/bridge 并暂存（dist + 运行时依赖）
    make-appcast.py     生成 appcast（CI 用）
    make-icons.py       图标生成
  macos/ windows/      平台壳（MainFlutterWindow.swift 等注册多窗口插件回调）
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
