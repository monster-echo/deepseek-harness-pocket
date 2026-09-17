//! DSH Pocket 桌面端（Tauri 2）
//!
//! 职责（与原 Flutter 端对等）：
//!   - 主窗口：内嵌 dsh 自带 Web GUI（loopback only），未就绪时显示引导面
//!   - 控制台窗口：状态 / 账号 / 配对 / 版本 / 日志（独立窗口，由托盘进入）
//!   - 托盘：常驻，承载全部管理入口
//!   - Worker 托管：以受管/系统 Node 运行 dshc CLI，轮询状态并驱动 UI
//!
//! Worker 逻辑唯一收敛在 dshc（packages/bridge），本进程只是壳。
//! v0.2.0 起安装包不内置 Node/bridge：首次启动由向导经网络组装（见 toolchain.rs）。

mod toolchain;

use std::path::PathBuf;
use std::process::Command;
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// 状态轮询间隔（与 Flutter 端一致量级）
const POLL_INTERVAL: Duration = Duration::from_secs(3);
/// 轮询连续失败时的退避上限（3→6→…→60s；避免环境坏掉时每 3s 冷启动一个 node 空转）
const POLL_MAX_INTERVAL: Duration = Duration::from_secs(60);

/// 上一次已加载的 dsh Web URL —— 变了才导航（dsh 重启后 token 必变）
static LAST_WEB_URL: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

/// 本应用前端自身的 URL（启动时从主窗口捕获）。
/// 不能硬编码 `tauri://localhost`：Windows 上是 `http://tauri.localhost`，双端不同。
static APP_URL: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

// ───────────────────────── 路径 ─────────────────────────

/// 与 dshc CLI 共享的主目录（supervisor.ts `dshcDir()` 同源）
fn pocket_home<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    Ok(home.join(".deepseek-harness-pocket"))
}

// ──────────────────── dshc 进程调用 ─────────────────────

/// Windows 上 GUI 程序 spawn console 子系统程序（node.exe）会闪控制台黑框，
/// 一律压掉（0x0800_0000 = CREATE_NO_WINDOW）。非 Windows 无操作。
#[cfg(windows)]
fn no_window(cmd: &mut Command) {
    use std::os::windows::process::CommandExt;
    // 独立常量避免为这一个标志引入 winapi 依赖
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(windows))]
fn no_window(_cmd: &mut Command) {}

/// 以受管/系统 Node 运行 dshc CLI，返回 stdout。
/// node+bridge 从网络引导（toolchain.rs），本函数不再依赖安装包内置的 sidecar。
fn run_dshc<R: Runtime>(app: &AppHandle<R>, args: &[&str]) -> Result<String, String> {
    let home = pocket_home(app)?;
    let tc = toolchain::resolve(&home)?;
    let path_env = toolchain::path_env(&home, &tc.node.node_bin_dir)?;

    let mut cmd = Command::new(&tc.node.node);
    no_window(&mut cmd);
    let out = cmd
        .arg(&tc.cli)
        .args(args)
        .env("PATH", path_env)
        .output()
        .map_err(|e| format!("启动 dshc 失败: {e}"))?;

    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(if stderr.trim().is_empty() { stdout } else { stderr.to_string() });
    }
    Ok(stdout)
}

/// `dshc status --json` → WorkerStatus（失败时降级为 running:false + 错误说明）。
/// 工具链缺失但旧版 detached supervisor 仍在跑（升级过渡期）：按 running 上报，
/// 让已就绪的 Web GUI 继续用，同时带 toolchainMissing 标记让前端弹补装向导。
fn read_status<R: Runtime>(app: &AppHandle<R>) -> serde_json::Value {
    match run_dshc(app, &["status", "--json"]) {
        Ok(text) => serde_json::from_str::<serde_json::Value>(text.trim())
            .unwrap_or_else(|e| serde_json::json!({ "running": false, "parseError": e.to_string() })),
        Err(e) => {
            if let Ok(run) = serde_json::from_str::<serde_json::Value>(
                &std::fs::read_to_string(pocket_home(app).ok().unwrap_or_default().join("run.json"))
                    .unwrap_or_default(),
            ) {
                let web_url = run.get("webUrl").and_then(|u| u.as_str()).unwrap_or_default();
                if !web_url.is_empty() {
                    return serde_json::json!({
                        "running": true, "toolchainMissing": true, "degraded": true,
                        "error": e, "run": run,
                    });
                }
            }
            serde_json::json!({ "running": false, "toolchainMissing": true, "error": e })
        }
    }
}

// ───────────────────────── 导航 ─────────────────────────

/// 把主窗口导航到 dsh Web GUI；URL 为空则回到引导面（本应用前端）。
fn navigate_main<R: Runtime>(app: &AppHandle<R>, web_url: &str) {
    let mut last = match LAST_WEB_URL.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    let target = if web_url.is_empty() { None } else { Some(web_url.to_string()) };
    if *last == target {
        return; // 未变化，不打扰当前页面
    }
    let Some(win) = app.get_webview_window("main") else { return };

    match &target {
        Some(url) => {
            // 只放行 loopback：token 不出本机
            let is_loopback = url.starts_with("http://127.0.0.1") || url.starts_with("http://localhost");
            if !is_loopback {
                return;
            }
            if let Ok(parsed) = tauri::Url::parse(url) {
                if win.navigate(parsed).is_ok() {
                    *last = target;
                }
            }
        }
        None => {
            let app_url = APP_URL.lock().ok().and_then(|g| g.clone());
            if let Some(url) = app_url {
                if let Ok(parsed) = tauri::Url::parse(&url) {
                    if win.navigate(parsed).is_ok() {
                        *last = target;
                    }
                }
            }
        }
    }
}

// ───────────────────── 托盘与控制台窗口 ─────────────────────

/// 托盘图标：打包资源目录优先，开发态回退源码目录。
/// macOS 用 template 图标（纯黑+alpha），由系统按明暗主题着色。
fn load_tray_icon<R: Runtime>(app: &AppHandle<R>) -> Result<tauri::image::Image<'static>, String> {
    // macOS 用单色 template 图标（系统按明暗主题着色）；
    // Windows 必须用彩色版——单色黑图标在深色任务栏上几乎不可见。
    let fname = if cfg!(target_os = "macos") {
        "icons/tray-icon.png"
    } else {
        "icons/tray-icon-color.png"
    };
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(res) = app.path().resource_dir() {
        candidates.push(res.join(fname));
    }
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(fname));

    for p in candidates {
        if p.exists() {
            return tauri::image::Image::from_path(&p).map_err(|e| format!("读取托盘图标失败: {e}"));
        }
    }
    Err("托盘图标缺失：icons/tray-icon.png".to_string())
}

/// 构建托盘菜单；独立成函数是为了「开机自启」状态变化后能重建菜单。
fn tray_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    let open_main = MenuItemBuilder::with_id("open-main", "打开主界面").build(app)?;
    let console_status = MenuItemBuilder::with_id("console:status", "运行状态").build(app)?;
    let console_account = MenuItemBuilder::with_id("console:account", "账号").build(app)?;
    let console_pairing = MenuItemBuilder::with_id("console:pairing", "配对").build(app)?;
    let console_versions = MenuItemBuilder::with_id("console:versions", "版本").build(app)?;
    let console_logs = MenuItemBuilder::with_id("console:logs", "日志").build(app)?;
    let console = SubmenuBuilder::new(app, "控制台")
        .item(&console_status)
        .item(&console_account)
        .item(&console_pairing)
        .item(&console_versions)
        .item(&console_logs)
        .build()?;
    let worker_start = MenuItemBuilder::with_id("worker:start", "启动 Worker").build(app)?;
    let worker_stop = MenuItemBuilder::with_id("worker:stop", "停止 Worker").build(app)?;
    let autostart = CheckMenuItemBuilder::with_id("autostart", "开机自启")
        .checked(autostart_enabled(app))
        .build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "退出 DSH Pocket").build(app)?;

    MenuBuilder::new(app)
        .item(&open_main)
        .separator()
        .item(&console)
        .separator()
        .item(&worker_start)
        .item(&worker_stop)
        .separator()
        .item(&autostart)
        .separator()
        .item(&quit)
        .build()
}

fn autostart_enabled<R: Runtime>(app: &AppHandle<R>) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

/// 自启状态变化后重建托盘菜单（勾选态需重建才刷新）
fn refresh_tray_menu<R: Runtime>(app: &AppHandle<R>) {
    if let (Some(tray), Ok(menu)) = (app.tray_by_id("main-tray"), tray_menu(app)) {
        let _ = tray.set_menu(Some(menu));
    }
}

fn build_tray<R: Runtime>(app: &AppHandle<R>) -> Result<(), Box<dyn std::error::Error>> {
    let menu = tray_menu(app)?;
    let icon = load_tray_icon(app)?;

    TrayIconBuilder::with_id("main-tray")
        .icon(icon)
        .icon_as_template(cfg!(target_os = "macos"))
        .tooltip("DSH Pocket")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, event| {
            let id = event.id().as_ref().to_string();
            match id.as_str() {
                "quit" => app.exit(0),
                "open-main" => {
                    if let Some(win) = app.get_webview_window("main") {
                        let _ = win.show();
                        let _ = win.set_focus();
                    }
                }
                "autostart" => {
                    use tauri_plugin_autostart::ManagerExt;
                    let al = app.autolaunch();
                    let now = al.is_enabled().unwrap_or(false);
                    let res = if now { al.disable() } else { al.enable() };
                    if let Err(e) = res {
                        notify(app, "开机自启设置失败", &e.to_string());
                    }
                    refresh_tray_menu(app);
                }
                "worker:start" => {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        let _ = start_worker(&app);
                    });
                }
                "menu:update" => {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        use tauri_plugin_updater::UpdaterExt;
                        let r = app.updater().and_then(|u| {
                            tauri::async_runtime::block_on(async move {
                                u.check().await.map(|x| x.map(|y| y.version).unwrap_or_default())
                            })
                        });
                        match r {
                            Ok(v) if !v.is_empty() => notify(&app, "DSH Pocket", &format!("新版本 {v} 可用，请在「版本」页查看")),
                            Ok(_) => notify(&app, "DSH Pocket", "已是最新版本"),
                            Err(e) => notify(&app, "检查更新失败", &e.to_string()),
                        }
                    });
                }
                "menu:reload" => {
                    if let Some(win) = app.get_webview_window("main") {
                        if let Ok(u) = win.url() { let _ = win.navigate(u); }
                    }
                }
                "worker:stop" => {
                    let app = app.clone();
                    std::thread::spawn(move || {
                        let _ = run_dshc(&app, &["stop", "--json"]);
                    });
                }
                other => {
                    // console:<panel> → 打开控制台窗口并定位到该页
                    if let Some(panel) = other.strip_prefix("console:") {
                        open_console(app, panel);
                    }
                }
            }
        })
        .build(app)?;
    Ok(())
}

/// 打开（或聚焦）控制台窗口，并把面板名发给前端
fn open_console<R: Runtime>(app: &AppHandle<R>, panel: &str) {
    if let Some(win) = app.get_webview_window("console") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
        let _ = win.emit("console-panel", panel);
        return;
    }
    let url = format!("index.html?window=console&panel={panel}");
    if let Ok(win) = WebviewWindowBuilder::new(app, "console", WebviewUrl::App(url.into()))
        .title("控制台")
        .inner_size(920.0, 680.0)
        .min_inner_size(760.0, 520.0)
        .build()
    {
        let _ = win.set_focus();
    }
}

// ──────────────────── 轮询：状态 → UI ─────────────────────

/// 桌面通知。失败静默——通知不在关键路径上。
fn notify<R: Runtime>(app: &AppHandle<R>, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let res = app.notification().builder().title(title).body(body).show();
    #[cfg(debug_assertions)]
    match &res { Ok(()) => eprintln!("[notify] 已发出: {title} / {body}"), Err(e) => eprintln!("[notify] 失败: {e}") }
    let _ = res;
}

fn start_poller<R: Runtime>(app: AppHandle<R>) {
    std::thread::spawn(move || {
    let mut prev_running: Option<bool> = None;
    let mut consecutive_failures: u32 = 0;
    loop {
        // 工具链缺失（新机器/未完成引导）时不 spawn node：60s 重探。
        // 否则「环境坏掉」的机器上每 3s 冷启动一个 node，永不停止。
        let home = pocket_home(&app);
        let status = match home.as_ref().map(|h| toolchain::resolve(h)) {
            Ok(Ok(_)) => read_status(&app),
            Ok(Err(e)) => serde_json::json!({
                "running": false,
                "toolchainMissing": true,
                "error": e,
            }),
            Err(e) => serde_json::json!({ "running": false, "toolchainMissing": true, "error": e }),
        };
        let failed = status.get("error").is_some() || status.get("parseError").is_some();
        consecutive_failures = if failed { consecutive_failures.saturating_add(1) } else { 0 };
        let running = status.get("running").and_then(|v| v.as_bool()).unwrap_or(false);
        let web_url = status
            .get("run")
            .and_then(|r| r.get("webUrl"))
            .and_then(|u| u.as_str())
            .unwrap_or("")
            .to_string();

        // 只在状态跃迁时打扰用户，避免每 3 秒一次的通知
        if let Some(prev) = prev_running {
            if prev != running {
                if running {
                    notify(&app, "DSH Pocket", "Worker 已就绪，手机端现在可以连上这台电脑");
                } else {
                    notify(&app, "DSH Pocket", "Worker 已停止");
                }
            }
        }
        prev_running = Some(running);

        #[cfg(debug_assertions)]
        {
            let err = status.get("error").and_then(|v| v.as_str()).unwrap_or("");
            eprintln!(
                "[poll] running={running} webUrl={} failures={consecutive_failures} {}",
                if web_url.is_empty() { "(none)" } else { &web_url },
                if err.is_empty() { String::new() } else { format!("err={err}") }
            );
        }
        navigate_main(&app, &web_url);
        let _ = app.emit("worker-status", &status);
        // 失败时指数退避（1<<1 … 1<<5），成功即回 3s
        let interval = if consecutive_failures == 0 {
            POLL_INTERVAL
        } else {
            (POLL_INTERVAL * (1u32 << consecutive_failures.min(5))).min(POLL_MAX_INTERVAL)
        };
        std::thread::sleep(interval);
    }
    });
}

/// 应用原生菜单（Windows：标题栏下的菜单条；macOS：屏幕顶部菜单栏）。
/// 承载的是「DSH Pocket 自己的功能」，与 dsh Web GUI 内部的 UI 互不干扰。
fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem};

    let open_main = MenuItem::with_id(app, "menu:open-main", "打开主界面", true, None::<&str>)?;
    let console_status = MenuItem::with_id(app, "console:status", "运行状态", true, None::<&str>)?;
    let console_account = MenuItem::with_id(app, "console:account", "账号", true, None::<&str>)?;
    let console_pairing = MenuItem::with_id(app, "console:pairing", "配对", true, None::<&str>)?;
    let console_versions = MenuItem::with_id(app, "console:versions", "版本", true, None::<&str>)?;
    let console_logs = MenuItem::with_id(app, "console:logs", "日志", true, None::<&str>)?;
    let console = SubmenuBuilder::new(app, "控制台")
        .item(&console_status).item(&console_account)
        .item(&console_pairing).item(&console_versions).item(&console_logs)
        .build()?;

    let worker_start = MenuItem::with_id(app, "worker:start", "启动 Worker", true, None::<&str>)?;
    let worker_stop = MenuItem::with_id(app, "worker:stop", "停止 Worker", true, None::<&str>)?;
    let worker = SubmenuBuilder::new(app, "Worker")
        .item(&worker_start).item(&worker_stop).build()?;

    let check_update = MenuItem::with_id(app, "menu:update", "检查更新…", true, None::<&str>)?;
    let reload = MenuItem::with_id(app, "menu:reload", "重新加载主界面", true, None::<&str>)?;

    let edit = SubmenuBuilder::new(app, "编辑")
        .undo().redo().separator()
        .cut().copy().paste().select_all()
        .build()?;

    Menu::with_items(app, &[
        &open_main,
        &console,
        &worker,
        &check_update,
        &reload,
        &PredefinedMenuItem::separator(app)?,
        &edit,
        &PredefinedMenuItem::separator(app)?,
    ])
}

/// 把应用菜单挂到主窗口（Windows：标题栏菜单条；macOS：顶部菜单栏）
fn set_window_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = app_menu(app)?;
    if let Some(win) = app.get_webview_window("main") {
        win.set_menu(menu)?;
    }
    Ok(())
}

// ───────────────────────── 命令 ─────────────────────────

#[tauri::command]
fn dshc_status<R: Runtime>(app: AppHandle<R>) -> serde_json::Value {
    read_status(&app)
}

#[tauri::command]
fn dshc_start<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    start_worker(&app)
}

#[tauri::command]
fn dshc_stop<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    run_dshc(&app, &["stop", "--json"])
}

#[tauri::command]
fn dshc_qr<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    let text = run_dshc(&app, &["qr", "--json"])?;
    serde_json::from_str(text.trim()).map_err(|e| format!("解析 qr 输出失败: {e}"))
}

/// 控制台内打开某个面板（前端主动调用）
#[tauri::command]
fn show_console<R: Runtime>(app: AppHandle<R>, panel: String) {
    open_console(&app, &panel);
}

/// 在系统浏览器打开外部链接（token 不出本机：仅放行 loopback 之外的显式调用）
#[tauri::command]
fn open_external<R: Runtime>(app: AppHandle<R>, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// 工具链 / 主目录诊断信息（控制台「日志」页用）
#[tauri::command]
fn runtime_info<R: Runtime>(app: AppHandle<R>) -> serde_json::Value {
    let home = pocket_home(&app);
    let tc = home.as_ref().map(|h| toolchain::resolve(h));
    serde_json::json!({
        "toolchainReady": tc.as_ref().map(|t| t.is_ok()).unwrap_or(false),
        "toolchainError": tc.as_ref().map(|t| t.as_ref().err()).unwrap_or(None),
        "nodeBin": tc.as_ref().ok().and_then(|t| t.as_ref().ok()).map(|t| t.node.node.display().to_string()),
        "nodeSource": tc.as_ref().ok().and_then(|t| t.as_ref().ok()).map(|t| t.node.source.as_str()),
        "bridgeVersion": tc.as_ref().ok().and_then(|t| t.as_ref().ok()).map(|t| t.bridge_version.clone()),
        "dshcCli": tc.as_ref().ok().and_then(|t| t.as_ref().ok()).map(|t| t.cli.display().to_string()),
        "pocketHome": home.as_ref().ok().map(|p| p.display().to_string()),
        "logFile": home.as_ref().ok().map(|p| p.join("dshc.log").display().to_string()),
        "platform": std::env::consts::OS,
    })
}

/// 恢复待机中的 supervisor（bridge `dshc resume`：写 resume-flag，数秒内重试启动）
#[tauri::command]
fn dshc_resume<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    run_dshc(&app, &["resume", "--json"])
}

// ─────────────── 首次引导（去 sidecar 化：一切从网络组装）───────────────

/// 引导状态快照（文件系统 + 系统 Node 探测；向导每次刷新调用）
#[tauri::command]
async fn bootstrap_status<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    let home = pocket_home(&app)?;
    tauri::async_runtime::spawn_blocking(move || Ok(toolchain::bootstrap_status_impl(&home)))
        .await
        .map_err(|e| format!("任务失败: {e}"))?
}

/// 安装受管 Node（major ∈ 22/24；系统 Node 可用时向导默认走复用，不调这里）
#[tauri::command]
async fn node_install<R: Runtime>(app: AppHandle<R>, major: u8) -> Result<String, String> {
    let home = pocket_home(&app)?;
    tauri::async_runtime::spawn_blocking(move || toolchain::node_install_impl(&app, &home, major))
        .await
        .map_err(|e| format!("任务失败: {e}"))?
}

/// 探测并采用系统 Node（可用则写入 toolchain.json，零下载）
#[tauri::command]
async fn system_node_probe<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let home = pocket_home(&app)?;
    tauri::async_runtime::spawn_blocking(move || toolchain::system_node_probe_impl(&home))
        .await
        .map_err(|e| format!("任务失败: {e}"))?
}

/// 安装受管 pnpm 到 runtimes/tools（dsh plugin add 依赖；不写用户系统目录）
#[tauri::command]
async fn tools_install<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let home = pocket_home(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let node = toolchain::resolve_node(&home)?;
        toolchain::tools_install_impl(&app, &home, &node)
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

/// 安装 bridge（dshc）到 runtimes/bridge
#[tauri::command]
async fn bridge_install<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let home = pocket_home(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let node = toolchain::resolve_node(&home)?;
        let out = toolchain::tools_install_impl(&app, &home, &node);
        out?; // bridge 的 plugin add 依赖 pnpm，先确保 tools 就位
        toolchain::bridge_install_impl(&app, &home, &node)
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

/// 记录引导完成（向导最后一步；此后启动不再弹向导，除非环境再次缺失）
#[tauri::command]
fn bootstrap_complete<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let home = pocket_home(&app)?;
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    let marker = serde_json::json!({ "version": 1, "completedAt": now_ms() });
    std::fs::write(
        home.join("onboarding-done.json"),
        format!("{}\n", serde_json::to_string_pretty(&marker).map_err(|e| e.to_string())?),
    )
    .map_err(|e| format!("写入引导完成标记失败: {e}"))
}

// ─────────────── 引导页环境预检（preflight）───────────────

fn preflight_item(id: &str, state: &str, detail: impl Into<String>, fix: Option<&str>) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "state": state,
        "detail": detail.into(),
        "fix": fix,
    })
}

/// 网关健康检查（3s 超时；引导页预检用）
fn gateway_health<R: Runtime>(app: &AppHandle<R>) -> Result<bool, String> {
    ensure_tls_provider();
    let base = gateway_rest_base(app)?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;
    let resp = client
        .get(format!("{base}/api/v1/health"))
        .send()
        .map_err(|e| e.to_string())?;
    Ok(resp.status().is_success())
}

/// 引导页环境预检实现：node / bridge / runtime / account / port / gateway 一次性快照。
/// 每项独立容错；gateway 只 warn 不 fail（离线也能用本机 GUI）。
fn preflight_impl<R: Runtime>(app: &AppHandle<R>) -> Result<serde_json::Value, String> {
    let home = pocket_home(app)?;
    let mut items: Vec<serde_json::Value> = Vec::new();

    // 1) node：系统复用或受管安装（向导可修）
    items.push(match toolchain::resolve_node(&home) {
        Ok(part) => preflight_item(
            "node",
            "pass",
            match part.source {
                toolchain::NodeSource::System => format!("系统 Node {}（已复用）", part.version),
                toolchain::NodeSource::Managed => format!("Node {}（受管）", part.version),
            },
            None,
        ),
        Err(e) => preflight_item("node", "fail", e, Some("install_node")),
    });

    // 2) bridge：Worker 核心（向导可修；低于最低版本视为需升级）
    items.push(match toolchain::resolve_bridge(&home) {
        Ok((_, _, version)) => {
            if !version.is_empty()
                && compare_versions(&version, toolchain::MIN_BRIDGE_VERSION)
                    != std::cmp::Ordering::Less
            {
                preflight_item("bridge", "pass", format!("Worker 核心 {version} 就绪"), None)
            } else {
                preflight_item(
                    "bridge",
                    "fail",
                    format!("Worker 核心 {version} 低于应用要求，请更新"),
                    Some("install_bridge"),
                )
            }
        }
        Err(e) => preflight_item("bridge", "fail", e, Some("install_bridge")),
    });

    // 2) dsh 运行时（托管安装；缺失可在引导页一键安装）
    items.push(match managed_dsh_bin_for(app) {
        Some(bin) => {
            // <home>/runtimes/dsh/<版本>/node_modules/.bin/dsh → 取 <版本>
            let version = bin
                .split(std::path::MAIN_SEPARATOR)
                .rev()
                .nth(4)
                .unwrap_or("")
                .to_string();
            preflight_item(
                "runtime",
                "pass",
                if version.is_empty() { "dsh 运行时就绪".to_string() } else { format!("dsh {version} 就绪") },
                None,
            )
        }
        None => preflight_item("runtime", "fail", "尚未安装 dsh 运行时", Some("install_runtime")),
    });

    // 3) 账号：浏览器登录会话或扫码设备凭据，二选一即可
    let session_ok = account_session_file(app)
        .ok()
        .filter(|f| f.exists())
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t.trim()).ok())
        .map(|v| {
            !v.get("token").and_then(|x| x.as_str()).unwrap_or_default().is_empty()
                && !v.get("refreshToken").and_then(|x| x.as_str()).unwrap_or_default().is_empty()
        })
        .unwrap_or(false);
    let link_ok = device_link_file(app)
        .ok()
        .filter(|f| f.exists())
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str::<serde_json::Value>(t.trim()).ok())
        .map(|v| !v.get("credential").and_then(|x| x.as_str()).unwrap_or_default().is_empty())
        .unwrap_or(false);
    items.push(if session_ok || link_ok {
        preflight_item("account", "pass", "已登录", None)
    } else {
        preflight_item("account", "fail", "尚未登录掌鲸账号", Some("login"))
    });

    // 4) 端口：Worker 已运行则端口归它所有，视为通过；否则探测业务口与 dsh 内部口
    let running = read_status(app)
        .get("running")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if running {
        items.push(preflight_item("port", "pass", "Worker 已在运行", None));
    } else {
        let port = u16::try_from(
            read_settings(app).get("port").and_then(|v| v.as_i64()).unwrap_or(DEFAULT_PORT),
        )
        .unwrap_or(3780);
        let busy: Vec<u16> = [port, 3080]
            .into_iter()
            .filter(|p| std::net::TcpListener::bind(("127.0.0.1", *p)).is_err())
            .collect();
        if busy.is_empty() {
            items.push(preflight_item("port", "pass", "端口可用", None));
        } else {
            let list = busy.iter().map(|p| p.to_string()).collect::<Vec<_>>().join("、");
            items.push(preflight_item(
                "port",
                "fail",
                format!("端口 {list} 被其他程序占用（可能是另一个 DSH 实例）"),
                Some("free_port"),
            ));
        }
    }

    // 5) 网关可达性：只 warn 不 fail（离线也能用本机 GUI）
    items.push(match gateway_health(app) {
        Ok(true) => preflight_item("gateway", "pass", "网关可达", None),
        Ok(false) => preflight_item("gateway", "warn", "网关响应异常（离线时仍可使用本机控制台）", None),
        Err(e) => preflight_item("gateway", "warn", format!("无法访问网关：{e}（离线时仍可使用本机控制台）"), None),
    });

    let overall = if items
        .iter()
        .any(|i| i.get("state").and_then(|s| s.as_str()) == Some("fail"))
    {
        "action_required"
    } else {
        "ready"
    };
    Ok(serde_json::json!({ "overall": overall, "items": items, "checkedAt": now_ms() }))
}

/// 引导页环境预检：一次性返回五项检查快照（单项 ~3s 超时，整体 <10s）
#[tauri::command]
async fn preflight_check<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || preflight_impl(&app))
        .await
        .map_err(|e| format!("任务失败: {e}"))?
}


// ───────────── 控制台数据源（只读） ─────────────

/// 读取 dshc 日志尾部（日志页）。`max_lines` 上限保护，避免大文件卡 UI。
#[tauri::command]
fn read_log<R: Runtime>(app: AppHandle<R>, max_lines: Option<usize>) -> Result<String, String> {
    let home = pocket_home(&app)?;
    let file = home.join("dshc.log");
    if !file.exists() {
        return Err(format!("日志文件不存在：{}", file.display()));
    }
    let text = std::fs::read_to_string(&file).map_err(|e| format!("读取日志失败: {e}"))?;
    let limit = max_lines.unwrap_or(400).min(5000);
    let lines: Vec<&str> = text.lines().collect();
    let start = lines.len().saturating_sub(limit);
    Ok(lines[start..].join("\n"))
}

/// 枚举已安装的 dsh 版本（版本页）。
/// 目录约定与 Flutter 端一致：~/.deepseek-harness-pocket/runtimes/dsh/<版本>/
#[tauri::command]
fn list_dsh_versions<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    let home = pocket_home(&app)?;
    let root = home.join("runtimes").join("dsh");
    let mut versions: Vec<serde_json::Value> = Vec::new();
    if root.is_dir() {
        let entries = std::fs::read_dir(&root).map_err(|e| format!("读取版本目录失败: {e}"))?;
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let installed_at = entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let size_bytes = dir_size(&path);
            versions.push(serde_json::json!({
                "version": name,
                "path": path.display().to_string(),
                "installedAt": installed_at,
                "sizeBytes": size_bytes,
                "hasBin": managed_dsh_bin(&path).exists(),
            }));
        }
    }
    versions.sort_by(|a, b| {
        compare_versions(b["version"].as_str().unwrap_or(""), a["version"].as_str().unwrap_or(""))
    });

    // 当前生效版本：run.json 里 supervisor 记录的实际二进制路径
    let active = read_status(&app)
        .get("run")
        .and_then(|r| r.get("dshVersion"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(serde_json::json!({
        "root": root.display().to_string(),
        "versions": versions,
        "activeVersion": active,
    }))
}

fn dir_size(path: &std::path::Path) -> u64 {
    let mut total = 0u64;
    if let Ok(entries) = std::fs::read_dir(path) {
        for e in entries.flatten() {
            let p = e.path();
            if p.is_dir() {
                total += dir_size(&p);
            } else if let Ok(m) = e.metadata() {
                total += m.len();
            }
        }
    }
    total
}

/// 读取账号会话原始 JSON（账号页）；字段由前端防御式读取。
#[tauri::command]
fn read_account_session<R: Runtime>(app: AppHandle<R>) -> serde_json::Value {
    let Ok(home) = pocket_home(&app) else {
        return serde_json::json!({ "signedIn": false, "error": "无法定位 pocket 主目录" });
    };
    let file = home.join("account-session.json");
    if !file.exists() {
        return serde_json::json!({ "signedIn": false, "sessionFile": file.display().to_string() });
    }
    match std::fs::read_to_string(&file) {
        Ok(text) => match serde_json::from_str::<serde_json::Value>(text.trim()) {
            Ok(mut v) => {
                if let Some(obj) = v.as_object_mut() {
                    obj.insert("signedIn".into(), serde_json::json!(true));
                    obj.insert("sessionFile".into(), serde_json::json!(file.display().to_string()));
                }
                v
            }
            Err(e) => serde_json::json!({ "signedIn": false, "parseError": e.to_string() }),
        },
        Err(e) => serde_json::json!({ "signedIn": false, "error": e.to_string() }),
    }
}

// ─────────────── 设置（desktop-settings.json）───────────────
//
// 键名与原 Flutter 端 AppSettings 完全一致，老用户的设置文件可直接沿用。
// 只有「会传给 dshc / 影响启动」的少数几项在桌面端有意义。

const DEFAULT_GATEWAY_URL: &str = "wss://dsh-pocket.zhongbei.tech/gw/worker";
const DEFAULT_PORT: i64 = 3780;
const DEFAULT_HOST: &str = "0.0.0.0";
const DEFAULT_CAPS: &str = "m3";

fn settings_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(pocket_home(app)?.join("desktop-settings.json"))
}

/// 读取设置（缺项用默认值补齐）。
/// gatewayUrl 不从设置文件读：网关是官方固定服务，不接受用户改指（设置页也不展示）。
fn read_settings<R: Runtime>(app: &AppHandle<R>) -> serde_json::Value {
    let mut v = serde_json::json!({
        "gatewayUrl": DEFAULT_GATEWAY_URL,
        "workerName": hostname(),
        "host": DEFAULT_HOST,
        "port": DEFAULT_PORT,
        "caps": DEFAULT_CAPS,
        "registry": "https://registry.npmmirror.com",
    });
    if let Ok(f) = settings_file(app) {
        if f.exists() {
            if let Ok(text) = std::fs::read_to_string(&f) {
                if let Ok(saved) = serde_json::from_str::<serde_json::Value>(text.trim()) {
                    if let (Some(obj), Some(base)) = (v.as_object_mut(), saved.as_object()) {
                        for (k, val) in base {
                            // gatewayUrl 固定：设置文件里残留的旧值一律忽略
                            if k == "gatewayUrl" || val.is_null() { continue; }
                            obj.insert(k.clone(), val.clone());
                        }
                    }
                }
            }
        }
    }
    v
}

fn hostname() -> String {
    std::env::var("HOSTNAME").or_else(|_| std::env::var("COMPUTERNAME")).unwrap_or_default()
}

/// 保存设置（浅合并：只覆盖传入的键）
#[tauri::command]
fn save_settings<R: Runtime>(app: AppHandle<R>, patch: serde_json::Value) -> Result<serde_json::Value, String> {
    let file = settings_file(&app)?;
    let mut cur = read_settings(&app);
    if let (Some(obj), Some(patch)) = (cur.as_object_mut(), patch.as_object()) {
        for (k, val) in patch { obj.insert(k.clone(), val.clone()); }
    }
    std::fs::create_dir_all(pocket_home(&app)?).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(&cur).map_err(|e| e.to_string())?;
    std::fs::write(&file, format!("{text}\n")).map_err(|e| format!("写入设置失败: {e}"))?;
    Ok(cur)
}

/// 读取设置
#[tauri::command]
fn get_settings<R: Runtime>(app: AppHandle<R>) -> serde_json::Value {
    read_settings(&app)
}

/// 按「设置」组装 `dshc start` 参数；`--dsh` 仅在切换版本时传入。
fn worker_start_args<R: Runtime>(app: &AppHandle<R>, dsh: Option<&str>) -> Vec<String> {
    let st = read_settings(app);
    let g = |k: &str, dflt: &str| -> String {
        st.get(k).and_then(|v| v.as_str()).filter(|s| !s.is_empty())
            .map(|s| s.to_string()).unwrap_or_else(|| dflt.to_string())
    };
    #[cfg(debug_assertions)]
    {
        let port = st.get("port").and_then(|v| v.as_i64()).unwrap_or(DEFAULT_PORT);
        let gw = st.get("gatewayUrl").and_then(|v| v.as_str()).unwrap_or("");
        let nm = st.get("workerName").and_then(|v| v.as_str()).unwrap_or("(默认主机名)");
        eprintln!("[start] port={port} gateway={gw} name={nm} dsh={:?}", dsh.is_some());
    }
    let mut args: Vec<String> = vec![
        "start".into(), "--detached".into(),
        "--gateway".into(), g("gatewayUrl", DEFAULT_GATEWAY_URL),
        "--port".into(), st.get("port").and_then(|v| v.as_i64()).unwrap_or(DEFAULT_PORT).to_string(),
        "--host".into(),   g("host", DEFAULT_HOST),
        "--caps".into(),   g("caps", DEFAULT_CAPS),
    ];
    // workerName 留空则不传，让 dshc 自己取主机名
    if let Some(n) = st.get("workerName").and_then(|v| v.as_str()).filter(|s| !s.is_empty()) {
        args.push("--name".into()); args.push(n.to_string());
    }
    if let Some(b) = dsh { args.push("--dsh".into()); args.push(b.to_string()); }
    args
}

/// 启动 Worker（读设置，含端口/网关/监听/能力档位/名称）。
/// 有托管 runtime 时必须显式传 --dsh：新机器没有全局 dsh，PATH 探测必然失败，
/// 也不该依赖 GUI 进程的 PATH（bridge 的 resolveDshBin 只作兜底）。
fn start_worker<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let dsh = managed_dsh_bin_for(app);
    let args = worker_start_args(app, dsh.as_deref());
    let refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    run_dshc(app, &refs)
}

// ─────────────── 账号（loopback OAuth）───────────────
//
// 与手机 App 同一账号体系（auth.zhongbei.tech）。流程与原 Flutter 端 account.dart 一致：
//   1. 本机起一次性回调服务 http://127.0.0.1:<随机端口>/callback
//   2. 打开系统浏览器到 {authBase}/login?redirect_uri=…&state=…
//   3. 登录页回跳带回 state/token/refresh_token
//   4. 校验 state 后写入 account-session.json（bridge 插件 uplink 会读它上送，同账号手机端免扫码）

/// 认证服务默认地址（与 Flutter 端 AppSettings 默认值一致）
const DEFAULT_AUTH_URL: &str = "https://auth.zhongbei.tech";

/// 回调等待上限
const LOGIN_TIMEOUT_SECS: u64 = 180;

fn account_session_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(pocket_home(app)?.join("account-session.json"))
}

/// RFC 3986 unreserved 之外的字节一律百分号编码
fn urlencode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// 登录阻塞主体：起回调服务 → 开浏览器 → 等回调 → 写会话文件。
fn do_login<R: Runtime>(
    app: &AppHandle<R>,
    auth_url: Option<String>,
) -> Result<serde_json::Value, String> {
    use std::io::{Read, Write};
    use std::net::TcpListener;

    let base = auth_url
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_AUTH_URL.to_string())
        .trim_end_matches('/')
        .to_string();

    let listener =
        TcpListener::bind("127.0.0.1:0").map_err(|e| format!("无法启动本地回调服务: {e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("读取回调端口失败: {e}"))?
        .port();
    let state = uuid::Uuid::new_v4().simple().to_string();
    let redirect = format!("http://127.0.0.1:{port}/callback");
    let login_url = format!("{base}/login?redirect_uri={}&state={state}", urlencode(&redirect));

    {
        use tauri_plugin_opener::OpenerExt;
        app.opener()
            .open_url(login_url.clone(), None::<&str>)
            .map_err(|e| format!("打开系统浏览器失败: {e}"))?;
    }

    // 非阻塞轮询 accept，以便实现超时（accept 本身没有超时参数）
    listener
        .set_nonblocking(true)
        .map_err(|e| format!("回调服务设置失败: {e}"))?;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(LOGIN_TIMEOUT_SECS);
    let mut stream = loop {
        if std::time::Instant::now() > deadline {
            return Err(format!("登录超时（{LOGIN_TIMEOUT_SECS} 秒内未收到回调）"));
        }
        match listener.accept() {
            Ok((s, _)) => break s,
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(std::time::Duration::from_millis(150));
            }
            Err(e) => return Err(format!("回调服务出错: {e}")),
        }
    };

    let mut buf = [0u8; 8192];
    let n = stream.read(&mut buf).map_err(|e| format!("读取回调失败: {e}"))?;
    let req = String::from_utf8_lossy(&buf[..n]).to_string();
    let path = req
        .lines()
        .next()
        .and_then(|l| l.split_whitespace().nth(1))
        .unwrap_or("/")
        .to_string();

    let parsed = tauri::Url::parse(&format!("http://127.0.0.1{path}"))
        .map_err(|e| format!("回调地址解析失败: {e}"))?;
    let q: std::collections::HashMap<String, String> =
        parsed.query_pairs().into_owned().collect();

    let got_state = q.get("state").cloned().unwrap_or_default();
    let token = q.get("token").cloned().unwrap_or_default();
    let refresh_token = q
        .get("refresh_token")
        .or_else(|| q.get("refreshToken"))
        .cloned()
        .unwrap_or_default();
    let email = q.get("email").cloned().unwrap_or_default();
    let user_id = q
        .get("user_id")
        .or_else(|| q.get("userId"))
        .cloned()
        .unwrap_or_default();

    let ok = got_state == state && !token.is_empty() && !refresh_token.is_empty();
    let (title, hint) = if ok {
        ("登录成功", "可以关闭此页面，回到 DSH Pocket。")
    } else {
        ("登录失败", "缺少凭证或 state 校验不通过，请回到 DSH Pocket 重试。")
    };
    let body = format!(
        "<!doctype html><meta charset=\"utf-8\"><title>{title}</title>\
         <body style=\"font-family:system-ui,-apple-system;padding:48px;color:#111\">\
         <h2 style=\"margin:0 0 8px\">{title}</h2><p style=\"color:#666;margin:0\">{hint}</p></body>"
    );
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.as_bytes().len(),
        body
    );
    let _ = stream.write_all(resp.as_bytes());
    let _ = stream.flush();

    if !ok {
        return Err("登录回调缺少凭证（token / refresh_token），或 state 校验失败".into());
    }

    let session = serde_json::json!({
        "version": 1,
        "userId": user_id,
        "email": email,
        "token": token,
        "refreshToken": refresh_token,
        "updatedAt": now_ms(),
    });
    let file = account_session_file(app)?;
    let text = serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?;
    std::fs::write(&file, format!("{text}\n")).map_err(|e| format!("写入会话文件失败: {e}"))?;

    Ok(session)
}

/// 在浏览器中登录掌鲸账号（阻塞等待回调，故用 async 命令 + 阻塞线程池）
#[tauri::command]
async fn account_login<R: Runtime>(
    app: AppHandle<R>,
    auth_url: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || do_login(&app, auth_url))
        .await
        .map_err(|e| format!("登录任务失败: {e}"))?
}

/// 登出：删除会话文件（手机端解绑留墓碑由 gateway 侧处理，这里只管本机）
#[tauri::command]
fn account_sign_out<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let file = account_session_file(&app)?;
    if file.exists() {
        std::fs::remove_file(&file).map_err(|e| format!("删除会话文件失败: {e}"))?;
    }
    Ok(())
}

// ─────────────── dsh 多版本管理 ───────────────
//
// 与原 Flutter 端 runtime.dart 一致：装到 ~/.deepseek-harness-pocket/runtimes/dsh/<版本>/，
// 不动全局 npm；npm 用内置 node 自带那份，不依赖用户环境。

const DSH_PACKAGE: &str = "@deepseek-ai/dsh";
const DEFAULT_REGISTRY: &str = "https://registry.npmmirror.com";
/// dsh 依赖树约 450 个包，npmmirror 下可能十几分钟
const NPM_INSTALL_TIMEOUT_SECS: u64 = 30 * 60;

/// 托管版本里 dsh 可执行文件的位置（npm 的 .bin 约定）
fn managed_dsh_bin(version_dir: &std::path::Path) -> PathBuf {
    let name = if cfg!(target_os = "windows") { "dsh.cmd" } else { "dsh" };
    version_dir.join("node_modules").join(".bin").join(name)
}

/// 版本字符串逐段数字比较（0.1.10 > 0.1.9；非数字段按 0）。字典序比较在这里是错的。
fn compare_versions(a: &str, b: &str) -> std::cmp::Ordering {
    let seg = |v: &str| -> Vec<u64> {
        v.trim()
            .trim_start_matches('v')
            .split(|c: char| c == '.' || c == '-')
            .map(|s| s.parse::<u64>().unwrap_or(0))
            .collect()
    };
    let (pa, pb) = (seg(a), seg(b));
    for i in 0..pa.len().max(pb.len()) {
        let x = pa.get(i).copied().unwrap_or(0);
        let y = pb.get(i).copied().unwrap_or(0);
        if x != y {
            return x.cmp(&y);
        }
    }
    std::cmp::Ordering::Equal
}

/// 扫描托管 runtime 目录，返回「已安装且带可执行」的最高版本 dsh bin 路径（没有则 None）。
fn managed_dsh_bin_for<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let root = pocket_home(app).ok()?.join("runtimes").join("dsh");
    let mut best: Option<(String, PathBuf)> = None;
    for entry in std::fs::read_dir(&root).ok()?.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let bin = managed_dsh_bin(&path);
        if !bin.exists() {
            continue;
        }
        let name = entry.file_name().to_string_lossy().to_string();
        let better = match &best {
            None => true,
            Some((v, _)) => compare_versions(&name, v) == std::cmp::Ordering::Greater,
        };
        if better {
            best = Some((name, bin));
        }
    }
    best.map(|(_, bin)| bin.to_string_lossy().to_string())
}

/// 以工具链 Node 跑 npm（bridge 未装也能跑：npm 只依赖 node）。
/// 返回 (是否成功, 合并后的输出)；`on_line` 用于安装进度（逐行 stdout/stderr）。
fn run_npm<R: Runtime>(
    app: &AppHandle<R>,
    args: &[&str],
    cwd: Option<&std::path::Path>,
    registry: &str,
    timeout_secs: u64,
    on_line: Option<&dyn Fn(&str)>,
) -> Result<(bool, String), String> {
    let home = pocket_home(app)?;
    let node = toolchain::resolve_node(&home)?;
    let out = toolchain::run_npm_with_node(
        &node,
        &home,
        args.iter(),
        cwd,
        Some(registry),
        timeout_secs,
        on_line,
    )?;
    Ok((out.success, out.output))
}

/// npm registry 上可用的 dsh 版本（新 → 旧）。prefer-online 避免缓存漏掉刚发布的版本。
#[tauri::command]
async fn dsh_versions_available<R: Runtime>(
    app: AppHandle<R>,
    registry: Option<String>,
) -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let reg = registry
            .filter(|r| !r.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_REGISTRY.to_string());
        let (ok, out) = run_npm(
            &app,
            &["view", DSH_PACKAGE, "versions", "--json", "--prefer-online"],
            None,
            &reg,
            120,
            None,
        )?;
        if !ok {
            return Err(format!("获取版本列表失败：{out}"));
        }
        // npm view --json 在只有一个版本时返回字符串而非数组，这里统一成 Vec
        let v: serde_json::Value =
            serde_json::from_str(out.trim()).map_err(|e| format!("版本列表解析失败: {e}"))?;
        let mut list: Vec<String> = match v {
            serde_json::Value::Array(a) => a
                .into_iter()
                .filter_map(|x| x.as_str().map(|s| s.to_string()))
                .collect(),
            serde_json::Value::String(s) => vec![s],
            _ => vec![],
        };
        list.reverse(); // 新 → 旧
        Ok(list)
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

/// 安装指定版本到托管目录（可能十几分钟；失败会清掉半成品目录）
#[tauri::command]
async fn dsh_install_version<R: Runtime>(
    app: AppHandle<R>,
    version: String,
    registry: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let reg = registry
            .filter(|r| !r.trim().is_empty())
            .unwrap_or_else(|| DEFAULT_REGISTRY.to_string());
        let dir = pocket_home(&app)?.join("runtimes").join("dsh").join(&version);
        std::fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
        let manifest = dir.join("package.json");
        if !manifest.exists() {
            std::fs::write(&manifest, "{\"name\":\"dsh-runtime\",\"private\":true}\n")
                .map_err(|e| format!("写入 package.json 失败: {e}"))?;
        }

        let spec = format!("{DSH_PACKAGE}@{version}");
        let base = ["install", spec.as_str(), "--no-fund", "--no-audit", "--loglevel=error"];
        // 安装最长 30 分钟：逐行回传进度（向导/版本页都靠它，别让用户以为死机）
        let on_line = |line: &str| {
            let _ = app.emit("bootstrap-progress", serde_json::json!({
                "step": "dsh", "phase": "npm", "line": line,
            }));
        };
        let mut res = run_npm(&app, &base, Some(&dir), &reg, NPM_INSTALL_TIMEOUT_SECS, Some(&on_line))?;

        // npm 可能拿陈旧 registry 元数据报 ETARGET（新版本刚发布时常见），强刷重试一次
        if !res.0 && (res.1.contains("ETARGET") || res.1.contains("notarget")) {
            let mut retry = base.to_vec();
            retry.push("--prefer-online");
            res = run_npm(&app, &retry, Some(&dir), &reg, NPM_INSTALL_TIMEOUT_SECS, Some(&on_line))?;
        }

        if !res.0 {
            let _ = std::fs::remove_dir_all(&dir); // 清半成品，避免被当成可用版本
            return Err(format!("安装 {version} 失败：{}", res.1));
        }
        if !managed_dsh_bin(&dir).exists() {
            let _ = std::fs::remove_dir_all(&dir);
            return Err("安装完成但未找到 dsh 可执行（npm 产物异常）".into());
        }
        Ok(format!("已安装 dsh {version}"))
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

/// 删除托管版本
#[tauri::command]
fn dsh_remove_version<R: Runtime>(app: AppHandle<R>, version: String) -> Result<(), String> {
    let dir = pocket_home(&app)?.join("runtimes").join("dsh").join(&version);
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("删除失败: {e}"))?;
    }
    Ok(())
}

/// Worker 是否在运行（读 dshc status，失败视为未运行）
fn is_worker_running<R: Runtime>(app: &AppHandle<R>) -> bool {
    read_status(app)
        .get("running")
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

/// 切换当前使用的 dsh 版本：停掉当前 Worker，再以指定版本的二进制拉起。
/// dshc 的 `start --dsh <路径>` 会把该路径转发给 detached 子进程（resolveDshBin 要求路径存在）。
#[tauri::command]
async fn dsh_switch_version<R: Runtime>(
    app: AppHandle<R>,
    version: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = pocket_home(&app)?.join("runtimes").join("dsh").join(&version);
        let bin = managed_dsh_bin(&dir);
        if !bin.exists() {
            return Err(format!("该版本缺少 dsh 可执行文件：{}", bin.display()));
        }
        let bin_str = bin.to_string_lossy().to_string();

        // 先停：dshc stop 写 stop-flag，supervisor 检测后优雅退出
        if is_worker_running(&app) {
            let _ = run_dshc(&app, &["stop", "--json"]);
            // 最多等 15 秒真正退出（stop 是异步的，立刻 start 会撞上「已在运行」）
            for _ in 0..30 {
                std::thread::sleep(std::time::Duration::from_millis(500));
                if !is_worker_running(&app) {
                    break;
                }
            }
            if is_worker_running(&app) {
                return Err("停止当前 Worker 超时，请稍后重试".into());
            }
        }

        let args = worker_start_args(&app, Some(&bin_str));
        let refs: Vec<&str> = args.iter().map(|x| x.as_str()).collect();
        let out = run_dshc(&app, &refs)?;
        Ok(format!("已切到 dsh {version}。{out}"))
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

// ─────────────── 应用自更新 ───────────────
//
// 清单由 CI 生成并挂在 Release 上（.github/scripts/make-latest-json.py）。
// 国内直连 GitHub 基本不可达：更新检查与安装包下载都走自建代理（路径前缀式转发），
// 并带 x-proxy-token 头防滥用（静态 token 只是防扫，不构成安全边界——
// 防篡改靠 minisign 签名校验）。代理不可用时回落 GitHub 直连。

const UPDATE_PROXY_BASE: &str = "https://proxy.0x2a.top";
const UPDATE_PROXY_TOKEN: &str = "MySecretPass_2026_SecureKey";
const UPDATE_MANIFEST_URL: &str =
    "https://github.com/monster-echo/deepseek-harness-pocket/releases/latest/download/latest.json";

/// 带「代理优先 + 直连兜底」端点与 token 的更新器客户端。
/// header 对清单请求与安装包下载同样生效（tauri-plugin-updater 复用 builder headers）。
fn updater_client<R: Runtime>(app: &AppHandle<R>) -> Result<tauri_plugin_updater::Updater, String> {
    use tauri_plugin_updater::UpdaterExt;
    let proxied: tauri::Url = format!("{UPDATE_PROXY_BASE}/{UPDATE_MANIFEST_URL}")
        .parse()
        .map_err(|e| format!("代理更新地址无效: {e}"))?;
    let direct: tauri::Url = UPDATE_MANIFEST_URL
        .parse()
        .map_err(|e| format!("更新地址无效: {e}"))?;
    app.updater_builder()
        .endpoints(vec![proxied, direct])
        .map_err(|e| format!("配置更新端点失败: {e}"))?
        .header("x-proxy-token", UPDATE_PROXY_TOKEN)
        .map_err(|e| format!("设置更新请求头失败: {e}"))?
        .build()
        .map_err(|e| format!("更新器初始化失败: {e}"))
}

/// 检查是否有新版本；无更新返回 null
#[tauri::command]
async fn check_update<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    match updater_client(&app)?.check().await {
        Ok(Some(u)) => Ok(serde_json::json!({
            "available": true,
            "version": u.version,
            "currentVersion": u.current_version,
            "notes": u.body,
        })),
        Ok(None) => Ok(serde_json::json!({ "available": false })),
        Err(e) => Err(format!("检查更新失败: {e}")),
    }
}

/// 下载并安装更新，成功后重启应用
#[tauri::command]
async fn install_update<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    let update = updater_client(&app)?
        .check()
        .await
        .map_err(|e| format!("检查更新失败: {e}"))?
        .ok_or_else(|| "已经是最新版本".to_string())?;

    update
        .download_and_install(|_downloaded, _total| {}, || {})
        .await
        .map_err(|e| format!("下载/安装更新失败: {e}"))?;

    // 安装完成后重启，让新版本生效
    app.restart();
}

// ────────────── 账号续期 ───────────────
//
// 与原 Flutter 端 account.dart 的 refresh() 一致：
//   POST {authBase}/api/v1/auth/refresh  {refreshToken}
//   响应取 {token, refreshToken}（可能在 data 层），userId/email 沿用当前会话。
// 会话过期但仍有 refreshToken 时用它续期，避免被 401 逼着重新登录。

const DEFAULT_AUTH_APP_ID: &str = "dshcompanion";
const DEFAULT_AUTH_APP_ENV: &str = "production";

/// 安装 rustls 的 ring provider（只需一次；重复安装返回 Err，忽略即可）
pub(crate) fn ensure_tls_provider() {
    let _ = rustls::crypto::ring::default_provider().install_default();
}

/// 用 refresh token 换新会话；失败即抛错（调用方决定是否让用户重新登录）
#[tauri::command]
async fn account_refresh<R: Runtime>(
    app: AppHandle<R>,
    auth_url: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || do_refresh(&app, auth_url))
        .await
        .map_err(|e| format!("任务失败: {e}"))?
}

fn do_refresh<R: Runtime>(
    app: &AppHandle<R>,
    auth_url: Option<String>,
) -> Result<serde_json::Value, String> {
    let file = account_session_file(app)?;
    if !file.exists() {
        return Err("尚未登录".into());
    }
    let cur: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(&file).map_err(|e| format!("读取会话失败: {e}"))?,
    )
    .map_err(|e| format!("会话文件解析失败: {e}"))?;

    let refresh_token = cur
        .get("refreshToken")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if refresh_token.is_empty() {
        return Err("会话缺少 refreshToken，需重新登录".into());
    }

    ensure_tls_provider();
    let base = auth_url
        .filter(|u| !u.trim().is_empty())
        .unwrap_or_else(|| DEFAULT_AUTH_URL.to_string())
        .trim_end_matches('/')
        .to_string();

    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;

    let resp = client
        .post(format!("{base}/api/v1/auth/refresh"))
        .header("content-type", "application/json")
        .header("X-App-Id", DEFAULT_AUTH_APP_ID)
        .header("X-App-Environment", DEFAULT_AUTH_APP_ENV)
        .header("X-Platform", std::env::consts::OS)
        .header("Accept-Language", "zh-CN")
        .json(&serde_json::json!({ "refreshToken": refresh_token }))
        .send()
        .map_err(|e| format!("无法连接认证服务: {e}"))?;

    let status = resp.status();
    let text = resp.text().map_err(|e| format!("读取响应失败: {e}"))?;
    let decoded: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| format!("服务响应异常 (HTTP {status})"))?;

    if !status.is_success() || decoded.get("error").is_some() {
        let msg = decoded
            .get("error")
            .and_then(|e| e.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("续期失败，请重新登录");
        return Err(msg.to_string());
    }

    let data = decoded.get("data").cloned().unwrap_or(decoded);
    let token = data.get("token").and_then(|v| v.as_str()).unwrap_or("");
    let new_refresh = data.get("refreshToken").and_then(|v| v.as_str()).unwrap_or("");
    if token.is_empty() || new_refresh.is_empty() {
        return Err("续期响应缺少 token / refreshToken".into());
    }

    let session = serde_json::json!({
        "version": 1,
        "userId": cur.get("userId").cloned().unwrap_or(serde_json::json!("")),
        "email": cur.get("email").cloned().unwrap_or(serde_json::json!("")),
        "token": token,
        "refreshToken": new_refresh,
        "updatedAt": now_ms(),
    });
    std::fs::write(
        &file,
        format!("{}\n", serde_json::to_string_pretty(&session).map_err(|e| e.to_string())?),
    )
    .map_err(|e| format!("写入会话文件失败: {e}"))?;

    Ok(session)
}

// ─────────────── 扫码登录（手机授权，device link）───────────────
//
// Telegram 同构的扫码登录：桌面端显示二维码（内含一次性 8 位链接码）→
// 手机 App 扫码，先向 gateway 问「这是哪台电脑」（preview 的名字以已注册
// Worker 为准，伪造二维码骗不出假身份）→ 用户确认后 gateway 把这台电脑
// 绑定到手机账号，并给桌面端签发设备凭据（dshl_<code>.<secret>，180 天）。
// 手机会话不复制到电脑；电脑端「退出登录」= 解绑 + 吊销凭据。
//
// 契约：packages/bridge-protocol/src/device-link.ts + gateway/src/server/api.ts
// 凭据落在 device-link.json（与 account-session.json 分开：后者是浏览器登录的
// auth 会话，bridge 插件 uplink 会读它上送，两者不能混）。

const DEVICE_LINK_FILE: &str = "device-link.json";

fn device_link_file<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    Ok(pocket_home(app)?.join(DEVICE_LINK_FILE))
}

/// 设置里的 gatewayUrl 是 WS 地址（wss://host/gw/worker），REST 同源换 http(s)://host
fn gateway_rest_base<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let st = read_settings(&app);
    let raw = st
        .get("gatewayUrl")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_GATEWAY_URL)
        .trim()
        .to_string();
    let http = raw.replace("wss://", "https://").replace("ws://", "http://");
    let (scheme, rest) = http
        .split_once("://")
        .ok_or_else(|| "gatewayUrl 缺少协议".to_string())?;
    let host = rest.split('/').next().unwrap_or_default();
    if host.is_empty() {
        return Err("gatewayUrl 缺少主机".into());
    }
    Ok(format!("{scheme}://{host}"))
}

/// bridge-state.json 里的 hostKey：gateway 侧定位这台电脑的唯一标识。
/// 没有 = 本机还没成功启动过 Worker（dshc 首次启动时生成）。
fn read_host_key<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let path = pocket_home(app)?.join("bridge-state.json");
    let text = std::fs::read_to_string(&path)
        .map_err(|_| "本机服务标识不可用：请先在「状态」页启动一次服务".to_string())?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("bridge-state.json 解析失败: {e}"))?;
    let hk = v
        .get("hostKey")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_string();
    if hk.is_empty() {
        return Err("本机服务标识缺失（bridge-state.json 无 hostKey）".into());
    }
    Ok(hk)
}

fn device_link_http() -> Result<reqwest::blocking::Client, String> {
    ensure_tls_provider();
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))
}

fn gateway_post_json(
    base: &str,
    path: &str,
    body: &serde_json::Value,
    bearer: Option<&str>,
) -> Result<(reqwest::StatusCode, serde_json::Value), String> {
    let client = device_link_http()?;
    let mut req = client
        .post(format!("{base}{path}"))
        .header("content-type", "application/json")
        .header("X-Platform", std::env::consts::OS)
        .json(body);
    if let Some(token) = bearer {
        req = req.header("Authorization", format!("Bearer {token}"));
    }
    let resp = req.send().map_err(|e| format!("无法连接 gateway: {e}"))?;
    let status = resp.status();
    let text = resp.text().map_err(|e| format!("读取响应失败: {e}"))?;
    let decoded: serde_json::Value =
        serde_json::from_str(&text).map_err(|_| format!("服务响应异常 (HTTP {status})"))?;
    Ok((status, decoded))
}

/// 读本地设备凭据（没有 / 坏了都返回 None，页面据此显示二维码）
#[tauri::command]
fn read_device_link<R: Runtime>(app: AppHandle<R>) -> Result<Option<serde_json::Value>, String> {
    let file = device_link_file(&app)?;
    if !file.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&file).map_err(|e| format!("读取设备凭据失败: {e}"))?;
    let v: serde_json::Value =
        serde_json::from_str(&text).map_err(|e| format!("device-link.json 解析失败: {e}"))?;
    if v.get("credential")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .is_empty()
    {
        return Ok(None);
    }
    Ok(Some(v))
}

/// 步骤 1：申请一次性链接码，返回二维码负载（页面渲染 + 轮询用）
#[tauri::command]
fn device_link_start<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    let host_key = read_host_key(&app)?;
    let st = read_settings(&app);
    let name = st
        .get("workerName")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let base = gateway_rest_base(&app)?;

    let (_, decoded) = gateway_post_json(
        &base,
        "/api/v1/devices/link/start",
        &serde_json::json!({
            "hostKey": host_key,
            "name": name,
            "platform": std::env::consts::OS,
        }),
        None,
    )?;

    let code = decoded
        .get("code")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    let secret = decoded
        .get("secret")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if code.is_empty() || secret.is_empty() {
        return Err("服务返回的链接码无效，请重试".into());
    }

    // 二维码负载格式与 packages/bridge-protocol/src/device-link.ts 一致（改动需同步）
    let mut qr = format!("dshp://link?v=1&c={code}");
    if !name.is_empty() {
        qr.push_str(&format!("&h={}", urlencode(&name)));
    }
    qr.push_str(&format!("&p={}", urlencode(std::env::consts::OS)));
    qr.push_str(&format!("&gw={}", urlencode(&base)));

    Ok(serde_json::json!({
        "code": code,
        "secret": secret,
        "qr": qr,
        "expiresAt": decoded.get("expiresAt").cloned().unwrap_or(serde_json::json!(now_ms() + 5 * 60 * 1000)),
        "intervalMs": decoded.get("intervalMs").cloned().unwrap_or(serde_json::json!(2000)),
        "hostKey": host_key,
    }))
}

/// 步骤 3：轮询；手机确认后写 device-link.json（0600）并返回账号身份
#[tauri::command]
fn device_link_poll<R: Runtime>(
    app: AppHandle<R>,
    code: String,
    secret: String,
) -> Result<serde_json::Value, String> {
    let base = gateway_rest_base(&app)?;
    let (_, decoded) = gateway_post_json(
        &base,
        "/api/v1/devices/link/poll",
        &serde_json::json!({ "code": code, "secret": secret }),
        None,
    )?;
    let state = decoded
        .get("status")
        .and_then(|v| v.as_str())
        .unwrap_or("pending")
        .to_string();
    if state != "approved" {
        return Ok(serde_json::json!({ "status": state }));
    }

    let account = decoded.get("account").cloned().unwrap_or(serde_json::json!({}));
    let credential = decoded
        .get("credential")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string();
    if credential.is_empty() {
        return Err("服务未返回设备凭据，请重新扫码".into());
    }
    let link = serde_json::json!({
        "version": 1,
        "userId": account.get("userId").cloned().unwrap_or(serde_json::json!("")),
        "email": account.get("email").cloned().unwrap_or(serde_json::json!("")),
        "credential": credential,
        "code": code,
        "workerId": decoded.get("workerId").cloned().unwrap_or(serde_json::json!("")),
        "linkedAt": now_ms(),
    });
    let file = device_link_file(&app)?;
    std::fs::write(
        &file,
        format!("{}\n", serde_json::to_string_pretty(&link).map_err(|e| e.to_string())?),
    )
    .map_err(|e| format!("写入设备凭据失败: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600));
    }
    Ok(serde_json::json!({ "status": "approved", "link": link }))
}

/// 退出登录：解绑这台电脑 + 吊销设备凭据；服务端失败也让本地登出
#[tauri::command]
fn device_link_revoke<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    let file = device_link_file(&app)?;
    let mut result = serde_json::json!({ "ok": true, "server": false });
    if file.exists() {
        let text = std::fs::read_to_string(&file).map_err(|e| format!("读取设备凭据失败: {e}"))?;
        let v: serde_json::Value =
            serde_json::from_str(&text).map_err(|e| format!("device-link.json 解析失败: {e}"))?;
        let code = v.get("code").and_then(|x| x.as_str()).unwrap_or_default().to_string();
        let credential = v
            .get("credential")
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_string();
        // credential = dshl_<code>.<secret>
        let secret = credential
            .strip_prefix("dshl_")
            .and_then(|r| r.split_once('.'))
            .map(|(_, s)| s.to_string())
            .unwrap_or_default();
        if !code.is_empty() && !secret.is_empty() {
            match gateway_rest_base(&app).and_then(|base| {
                gateway_post_json(
                    &base,
                    "/api/v1/devices/link/revoke",
                    &serde_json::json!({ "code": code, "secret": secret }),
                    None,
                )
            }) {
                Ok((status, body)) => {
                    if status.is_success() {
                        result["server"] = serde_json::json!(true);
                    } else {
                        result["reason"] = serde_json::json!(format!("HTTP {status} {body}"));
                    }
                }
                Err(e) => {
                    result["reason"] = serde_json::json!(e);
                }
            }
        }
        let _ = std::fs::remove_file(&file);
    }
    Ok(result)
}

// ───────────────────────── 入口 ─────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // 单实例必须最先注册：第二次启动只聚焦已有窗口
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // 开机自启时静默进托盘，不弹窗
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            dshc_status,
            dshc_start,
            dshc_stop,
            dshc_resume,
            dshc_qr,
            preflight_check,
            bootstrap_status,
            node_install,
            system_node_probe,
            tools_install,
            bridge_install,
            bootstrap_complete,
            show_console,
            open_external,
            runtime_info,
            read_log,
            list_dsh_versions,
            read_account_session,
            account_login,
            account_sign_out,
            dsh_versions_available,
            dsh_install_version,
            dsh_remove_version,
            dsh_switch_version,
            check_update,
            install_update,
            account_refresh,
            get_settings,
            save_settings,
            read_device_link,
            device_link_start,
            device_link_poll,
            device_link_revoke
        ])
        .setup(|app| {
            // --refresh-account：无 GUI 续期账号会话（脚本化 / 排查用）
            if std::env::args().any(|a| a == "--refresh-account") {
                match do_refresh(app.handle(), None) {
                    Ok(v) => {
                        println!("[refresh] 成功，updatedAt={}", v.get("updatedAt").and_then(|x| x.as_u64()).unwrap_or(0));
                        std::process::exit(0);
                    }
                    Err(e) => { eprintln!("[refresh] 失败: {e}"); std::process::exit(1); }
                }
            }
            // --autostart=on|off：无 GUI 也能开关自启（脚本化部署用；托盘里有同样的开关）
            if let Some(v) = std::env::args().find_map(|a| a.strip_prefix("--autostart=").map(String::from)) {
                use tauri_plugin_autostart::ManagerExt;
                let al = app.autolaunch();
                let res = match v.as_str() {
                    "on" => al.enable(),
                    "off" => al.disable(),
                    other => { eprintln!("[autostart] 未知取值 {other}（应为 on/off）"); std::process::exit(64); }
                };
                match res {
                    Ok(()) => println!("[autostart] {v} 已应用，is_enabled={:?}", al.is_enabled()),
                    Err(e) => { eprintln!("[autostart] 应用失败: {e}"); std::process::exit(1); }
                }
                std::process::exit(0);
            }
            // 启动自检：sidecar 是否就绪、自启插件是否可用（售后排查用）
            #[cfg(debug_assertions)]
            {
                let ready = pocket_home(app.handle())
                    .map_err(String::from)
                    .and_then(|h| toolchain::resolve(&h).map(|_| ()))
                    .is_ok();
                eprintln!(
                    "[startup] toolchain={} autostart={} version={}",
                    ready,
                    autostart_enabled(app.handle()),
                    app.package_info().version
                );
            }
            // 捕获自身前端 URL（跨平台回退导航用）
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(u) = win.url() {
                    if let Ok(mut g) = APP_URL.lock() {
                        *g = Some(u.to_string());
                    }
                }
            }
            // 由开机自启拉起时静默进托盘
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.hide();
                }
            }
            build_tray(app.handle())?;
            set_window_menu(app.handle())?;
            start_poller(app.handle().clone());
            // 开机即在线：未运行则拉起（与原 Flutter 端行为一致）；失败不再静默吞掉
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                let running = read_status(&handle)
                    .get("running")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                if !running {
                    if let Err(e) = start_worker(&handle) {
                        eprintln!("[boot] 自动启动失败: {e}");
                        notify(&handle, "DSH Pocket", &format!("Worker 自动启动失败：{e}"));
                        let _ = handle.emit("worker-start-error", &e);
                    }
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // 关窗不退出：收进托盘（托盘常驻是产品核心语义）
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running DSH Pocket");
}
