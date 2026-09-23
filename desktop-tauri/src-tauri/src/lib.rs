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
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewUrl, WebviewWindowBuilder};

/// 状态轮询间隔（与 Flutter 端一致量级）
const POLL_INTERVAL: Duration = Duration::from_secs(3);
/// 轮询连续失败时的退避上限（3→6→…→60s；避免环境坏掉时每 3s 冷启动一个 node 空转）
const POLL_MAX_INTERVAL: Duration = Duration::from_secs(60);

/// 上一次已加载的 dsh Web URL —— 变了才导航（dsh 重启后 token 必变）
static LAST_WEB_URL: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

/// 主窗口最近一次成功导航（含整页刷新）的时间（epoch ms；0 = 尚未导航过）。
static LAST_NAVIGATED_AT: AtomicU64 = AtomicU64::new(0);

/// 界面自愈阈值：主窗口持续处于后台超过该时长后，重新聚焦时整页重载一次。
/// 背景：webview 长时间挂起（托盘常驻、macOS 挂起后台页面定时器与流式连接）后，
/// dsh web 的事件流可能不再恢复——模型胶囊等实时界面停在过去，用户以为操作没生效。
const WEBVIEW_STALE_RELOAD_MS: u64 = 30 * 60 * 1000;

/// 页面内「后台唤醒」重连阈值：页面重新可见时，若已隐藏超过该时长，先做一次
/// 同源探活（HEAD 请求），**探活失败才**主动触发 dsh 客户端自带的连接恢复。
///
/// 为什么不直接重连：派发 offline→online 会走 `connection/reset`，丢弃并重拉全部
/// 投影，GUI 会闪「Loading history… / Deep diving…」。而多数情况下 WebKit 恢复后
/// 网络栈是好的，dsh 客户端自己的断线重连已经生效，无需我们插手。探活通过就
/// 完全不动页面（体验与 Chrome 一致）；探活失败说明网络栈确实坏死了，才走
/// offline→online 强制恢复（模型胶囊「选了不生效」的正面修复，见下）。
///
/// 为什么需要兜底：dsh web 的实时界面（模型胶囊、用量、审批等）全部由 Host 推送的
/// 投影驱动——模型胶囊读的是 `modelSelection` 投影，客户端在选完模型后**不做乐观
/// 更新**（见 dsh-client-ui-model-selection：成功只关菜单，值仍等推送）。macOS 把
/// 托盘常驻窗口的 WKWebView 挂起后，浏览器既不会报 online/offline，`$events` 也不
/// 一定结束，客户端因此不会重连，投影就停在挂起前的值上：菜单里选好了，胶囊还是
/// 旧的。派发 offline→online 会走 dsh 客户端自己的恢复路径（ConnectionController
/// 重建物理 WebSocket、重开 `$events`），不整页重载、不丢输入草稿。
/// 比 [`WEBVIEW_STALE_RELOAD_MS`] 的整页重载轻得多。
const RESUME_STALE_RESYNC_MS: u64 = 5 * 60 * 1000;

/// 同源探活的超时（毫秒）：超时未响应视为网络栈坏死，触发强制恢复。
const RESUME_PROBE_TIMEOUT_MS: u32 = 4000;

/// 注入页面内的后台唤醒看门狗（幂等；`__MS__` 由调用点替换为阈值毫秒数）。
/// 只监听「隐藏时长」，被遮挡/最小化/隐藏窗口都会让 WebKit 触发 visibilitychange，
/// 可见后超过阈值就重连；纯窗口聚焦（隐藏期间没走 visibilitychange 的平台差异）兜底。
const RESUME_WATCHDOG_JS: &str = "(function(){\
if(window.__dshPocketResumeWatch)return;window.__dshPocketResumeWatch=1;\
var STALE_MS=__MS__,PROBE_MS=__PROBE_MS__,hiddenAt=0,probing=false;\
function awayMs(){return hiddenAt===0?0:Date.now()-hiddenAt}\
function resync(){hiddenAt=0;\
if(probing)return;probing=true;\
var done=false;\
function finish(alive){if(done)return;done=true;probing=false;\
if(alive)return;\
try{window.dispatchEvent(new Event('offline'))}catch(e){}\
setTimeout(function(){try{window.dispatchEvent(new Event('online'))}catch(e){}},100)}\
try{var ctl=new AbortController();\
fetch(location.origin+'/?__dshResumeProbe='+Date.now(),{method:'HEAD',cache:'no-store',credentials:'include',signal:ctl.signal})\
.then(function(){try{ctl.abort()}catch(e){};finish(true)},\
function(){try{ctl.abort()}catch(e){};finish(false)});\
setTimeout(function(){try{ctl.abort()}catch(e){};finish(false)},PROBE_MS);\
}catch(e){finish(false)}}\
document.addEventListener('visibilitychange',function(){\
if(document.visibilityState==='hidden'){hiddenAt=Date.now();return}\
if(awayMs()>=STALE_MS)resync();else hiddenAt=0});\
window.addEventListener('focus',function(){if(awayMs()>=STALE_MS)resync()});\
window.addEventListener('pageshow',function(e){if(e&&e.persisted)resync()});\
})();";

/// 在 dsh web 页面里安装看门狗；每次轮询 tick 调一次，脚本自身按全局标志幂等。
fn inject_resume_watchdog<R: Runtime>(win: &tauri::WebviewWindow<R>) {
    let js = RESUME_WATCHDOG_JS
        .replace("__MS__", &RESUME_STALE_RESYNC_MS.to_string())
        .replace("__PROBE_MS__", &RESUME_PROBE_TIMEOUT_MS.to_string());
    let _ = win.eval(&js);
}

/// dsh 菜单的 WebKit 焦点时序补丁（幂等）。
///
/// 现象：WKWebView/Safari 里，模型菜单下钻后焦点落在「当前选中行」，此时按下
/// 另一行，WebKit 先把焦点从旧行挪走、新按钮尚未聚焦，发出 `relatedTarget=null`
/// 的 focusout；dsh 菜单的 `onBlur` 判定 `relatedTarget instanceof Node` 失败，
/// 误判「焦点离开菜单」提前 `close()`——菜单在 mouseup 前卸载，click 落到聊天
/// 正文上，选择从未发生（`session/selectModel` 请求都不发出）。Chrome 在
/// mousedown 时立即聚焦新按钮（relatedTarget=菜单内行），因此网页没事；
/// Safari 实测同样复现，属 dsh 客户端在 WebKit 下的通用缺陷。
///
/// 补丁：菜单内 mousedown 阻止默认焦点转移（focusout 根本不发生），菜单得以
/// 存活到 click，选择正常提交。副作用仅是鼠标点选时焦点不随行移动，键盘导航
/// 不受影响。upstream 修复后可移除。
const MENU_FOCUS_SHIM_JS: &str = "(function(){\
if(window.__dshMenuFocusShim)return;window.__dshMenuFocusShim=1;\
document.addEventListener('mousedown',function(e){\
if(e.target&&e.target.closest&&e.target.closest('[role=menu]'))e.preventDefault();\
},true);\
})();";

/// 在 dsh web 页面里安装菜单焦点补丁；每次轮询 tick 调一次，脚本自身幂等。
fn inject_menu_focus_shim<R: Runtime>(win: &tauri::WebviewWindow<R>) {
    let _ = win.eval(MENU_FOCUS_SHIM_JS);
}

/// 记录「刚完成一次导航/刷新」的时间戳。
fn mark_navigated_now() {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    LAST_NAVIGATED_AT.store(now, Ordering::Relaxed);
}

/// 本应用前端自身的 URL（启动时从主窗口捕获）。
/// 不能硬编码 `tauri://localhost`：Windows 上是 `http://tauri.localhost`，双端不同。
static APP_URL: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));

/// 菜单「引导页」的待处理请求。主窗口从 dsh Web GUI 导航回本前端时整页重载，
/// emit 的 open-onboarding 事件会随旧页面一起丢掉——前端加载完成后用
/// `take_onboarding_request` 消费这个标志，作为事件丢失的兜底。
static ONBOARDING_REQUESTED: LazyLock<Mutex<bool>> = LazyLock::new(|| Mutex::new(false));

/// 取走（并清除）待处理的引导页请求；返回 true 表示菜单刚请求过打开引导页。
#[tauri::command]
fn take_onboarding_request() -> bool {
    match ONBOARDING_REQUESTED.lock() {
        Ok(mut g) => std::mem::take(&mut *g),
        Err(_) => false,
    }
}

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
                    mark_navigated_now();
                }
            }
        }
        None => {
            let app_url = APP_URL.lock().ok().and_then(|g| g.clone());
            if let Some(url) = app_url {
                if let Ok(parsed) = tauri::Url::parse(&url) {
                    if win.navigate(parsed).is_ok() {
                        *last = target;
                        mark_navigated_now();
                    }
                }
            }
        }
    }
}

/// 「刷新界面」：整页重载主窗口当前页。dsh web 是长驻页面，事件流在 webview
/// 长时间后台后可能不再恢复（模型胶囊等停在过去，用户以为切换没生效），
/// 手动刷新是最直接的自愈入口。只刷新 dsh web 页：引导面向导状态在前端内存里。
fn reload_main_webview<R: Runtime>(app: &AppHandle<R>) {
    let Some(win) = app.get_webview_window("main") else { return };
    let on_web = match LAST_WEB_URL.lock() {
        Ok(g) => g.clone(),
        Err(p) => p.into_inner().clone(),
    };
    let Some(web_url) = on_web else { return };
    let Ok(cur) = win.url() else { return };
    if url_origin(cur.as_str()).as_deref() != url_origin(&web_url).as_deref() {
        return;
    }
    mark_navigated_now();
    let _ = win.eval("location.reload()");
}

/// 聚焦自愈：主窗口重新聚焦时，若页面在 dsh web 上且距上次导航/刷新超过
/// [`WEBVIEW_STALE_RELOAD_MS`]，整页重载一次——后台挂起后事件流不恢复的兜底。
fn selfheal_stale_webview<R: Runtime>(_app: &AppHandle<R>, win: &tauri::WebviewWindow<R>) {
    let on_web = match LAST_WEB_URL.lock() {
        Ok(g) => g.clone(),
        Err(p) => p.into_inner().clone(),
    };
    let Some(web_url) = on_web else { return };
    let Ok(cur) = win.url() else { return };
    if url_origin(cur.as_str()).as_deref() != url_origin(&web_url).as_deref() {
        return;
    }
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let last = LAST_NAVIGATED_AT.load(Ordering::Relaxed);
    if last == 0 || now.saturating_sub(last) < WEBVIEW_STALE_RELOAD_MS {
        return;
    }
    mark_navigated_now();
    let _ = win.eval("location.reload()");
}

/// URL 的 origin（scheme://host:port）；解析失败为 None。自愈探测的「同源」判定用。
fn url_origin(url: &str) -> Option<String> {
    tauri::Url::parse(url).ok().map(|u| u.origin().ascii_serialization())
}

/// 强制导航：清掉去重水位，无视「未变化」判断（自愈路径专用）。
fn navigate_main_force<R: Runtime>(app: &AppHandle<R>, web_url: &str) {
    if let Ok(mut last) = LAST_WEB_URL.lock() {
        *last = None;
    }
    navigate_main(app, web_url);
}

/// 401 页面打标标题（webview eval 注入，无需远程 IPC 白名单）
const REAUTH_FLAG_TITLE: &str = "DSH_POCKET_REAUTH";

/// 自愈：主窗口若停在旧 token 的 dsh web 401 页（worker 重启换 token / 手动刷新 / 会话过期），
/// 自动用最新 webUrl 重新导航。dsh web 认证后会把 token 从 URL 剥离，无法靠 URL 对比，
/// 因此向页面注入一行 JS 检测认证失效文案，命中则改标题，Rust 侧读标题发现后强制重导航。
fn selfheal_auth_probe<R: Runtime>(app: &AppHandle<R>, web_url: &str) {
    if web_url.is_empty() {
        return;
    }
    let Some(win) = app.get_webview_window("main") else { return };
    let cur = match win.url() {
        Ok(u) => u,
        Err(_) => return,
    };
    // 只探测 dsh web 页（与最新 webUrl 同源），绝不碰我们自己的引导面
    if url_origin(cur.as_str()).as_deref() != url_origin(web_url).as_deref() {
        return;
    }
    let _ = win.eval(&format!(
        "if (/authentication required/i.test(document.body ? document.body.innerText : '')) document.title = '{REAUTH_FLAG_TITLE}';"
    ));
    // 主窗口常驻态是 dsh web 页（外部页面加不了 drag-region）：
    // 注入顶部拖拽条，配合 Tauri 拖拽脚本的 document 级委托实现拖动/双击最大化。
    // tick 每 3s 重跑一次，按 id 幂等。
    let _ = win.eval(
        "(function(){if(document.getElementById('dsh-drag-strip'))return;var d=document.createElement('div');d.id='dsh-drag-strip';d.setAttribute('data-tauri-drag-region','');d.style.cssText='position:fixed;top:0;left:0;right:0;height:28px;z-index:2147483646;user-select:none;-webkit-user-select:none;cursor:default';(document.body||document.documentElement).appendChild(d)})();",
    );
    // 后台唤醒自愈：页面重新可见且隐藏够久时，触发一次 dsh 客户端重连，刷新推送投影
    //（模型胶囊「选了不生效」的正面修复，见 RESUME_STALE_RESYNC_MS 注释）。
    inject_resume_watchdog(&win);
    // WebKit 菜单焦点时序补丁：修「模型菜单点了没反应/请求不发」（Safari 同病，见注释）。
    inject_menu_focus_shim(&win);
    if let Ok(title) = win.title() {
        if title == REAUTH_FLAG_TITLE {
            let _ = win.eval("document.title = document.title.replace('DSH_POCKET_REAUTH', '');");
            navigate_main_force(app, web_url);
            notify(app, "DSH Pocket", "控制台已自动重新认证");
        }
    }
}

/// 自愈判定：worker 掉线 + 引导已完成 + 非用户主动停止（无 stop-flag）→ 允许自动重启。
/// 用户经 dshc stop 停机会留下 dshc.stop-flag，start 时自清，天然区分「崩溃」与「人为停止」。
fn should_auto_restart(running: bool, onboarding_done: bool, stop_flag: bool) -> bool {
    !running && onboarding_done && !stop_flag
}

/// 自动重启退避间隔：连续失败越多越慢，封顶 10 分钟
fn restart_interval(failures: u32) -> Duration {
    (POLL_INTERVAL * (1u32 << failures.min(6))).min(Duration::from_secs(600))
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
    let console_versions = MenuItemBuilder::with_id("console:versions", "版本").build(app)?;
    let console_logs = MenuItemBuilder::with_id("console:logs", "日志").build(app)?;
    let console = SubmenuBuilder::new(app, "控制台")
        .item(&console_status)
        .item(&console_account)
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
        // 不在这里挂 on_menu_event：托盘菜单事件已经由 Builder::on_menu_event 全局出口
        // 处理，再挂一份会收到两次事件，「开机自启」一点就 enable→disable 各跑一次，
        // 勾选永远打不上。菜单动作统一走 handle_menu_action 一处。
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
    // 按平台建窗口（静态配置无法分平台）：Windows 无边框走前端自绘标题栏
    //（TitleBar.tsx Windows 分支）；macOS 用原生 Overlay 标题栏（红绿灯 + 原生拖拽），
    // 与主窗口同款配置——自绘 Windows 风格在 macOS 是错位的。
    let builder = WebviewWindowBuilder::new(app, "console", WebviewUrl::App(url.into()))
        .title("控制台")
        .inner_size(920.0, 680.0)
        .min_inner_size(760.0, 520.0)
        .resizable(true)
        .center()
        .visible(false);
    #[cfg(target_os = "macos")]
    let builder = builder
        .decorations(true)
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true);
    #[cfg(not(target_os = "macos"))]
    let builder = builder.decorations(false);
    if let Ok(win) = builder.build() {
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("console-panel", panel);
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
    let mut prev_autostart: Option<bool> = None;
    let mut restart_backoff: u32 = 0;
    let mut last_restart: Option<Instant> = None;
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
        // 自愈：worker 掉线自动重启（引导完成后；用户主动 stop 留有 flag 则不打扰；
        // 工具链缺失时交给向导，不空转拉起）
        let onboarded = home.as_ref().map(|h| h.join("onboarding-done.json").exists()).unwrap_or(false);
        let stop_flag = home.as_ref().map(|h| h.join("dshc.stop-flag").exists()).unwrap_or(false);
        let toolchain_missing = status.get("toolchainMissing").and_then(|v| v.as_bool()).unwrap_or(false);
        if should_auto_restart(running, onboarded, stop_flag) && !toolchain_missing {
            let due = last_restart
                .map(|t| t.elapsed() >= restart_interval(restart_backoff))
                .unwrap_or(true);
            if due {
                last_restart = Some(Instant::now());
                match start_worker(&app) {
                    Ok(_) => {
                        restart_backoff = 0;
                        notify(&app, "DSH Pocket", "Worker 掉线，已自动重启");
                    }
                    Err(_) => restart_backoff = restart_backoff.saturating_add(1).min(6),
                }
            }
        } else if running {
            restart_backoff = 0;
        }
        prev_running = Some(running);

        // 自启状态被外部改动（系统设置/其他入口）时，菜单勾选也要跟上：
        // 状态翻转才重建，避免每 tick 重建菜单导致打开中的菜单闪烁
        let autostart = autostart_enabled(&app);
        if prev_autostart != Some(autostart) {
            refresh_tray_menu(&app);
            let _ = install_menu(&app);
            prev_autostart = Some(autostart);
        }

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
        selfheal_auth_probe(&app, &web_url);
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

/// 「控制台」子菜单：状态/账号/版本/日志 + 启动/停止 Worker + 自启勾选。
/// macOS 菜单栏与 Windows 窗口菜单共用一份。
fn console_submenu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Submenu<R>> {
    use tauri::menu::{MenuItem, SubmenuBuilder};

    let autostart_item = tauri::menu::CheckMenuItemBuilder::with_id("autostart", "开机自启")
        .checked(autostart_enabled(app))
        .build(app)?;
    SubmenuBuilder::new(app, "控制台")
        .item(&MenuItem::with_id(app, "console:status", "运行状态", true, None::<&str>)?)
        // 「扫码登录」并入「账号」：账号页未登录时本就显示扫码二维码，无需两个入口
        .item(&MenuItem::with_id(app, "console:account", "账号", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "console:versions", "版本", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "console:logs", "日志", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "worker:start", "启动 Worker", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "worker:stop", "停止 Worker", true, None::<&str>)?)
        .separator()
        .item(&autostart_item)
        .build()
}

/// 应用原生菜单（平台各异，挂载统一走 install_menu）。
///
/// macOS：菜单栏是 app 级的，NSApp 会把第一个 submenu 的标题强制改成应用名，
/// 所以第一位必须是 app 菜单本身（关于/检查更新/设置/隐藏/退出）。设置 app 菜单后
/// 系统默认菜单被整体替换，⌘Q 必须自带一条，否则 Cmd+Q 直接失效；「编辑」同理
/// 不能省，否则 ⌘C/⌘V 没有菜单项派发 selector。
///
/// Windows/Linux：结构 文件（主页面/引导页/配置）· 编辑 · 控制台 · 帮助（检查更新/关于）。
#[cfg(target_os = "macos")]
fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, SubmenuBuilder};

    let app_submenu = SubmenuBuilder::new(app, "DSH Pocket")
        .item(&PredefinedMenuItem::about(app, Some("关于 DSH Pocket"), None)?)
        .item(&MenuItem::with_id(app, "menu:update", "检查更新…", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "menu:settings", "设置…", true, Some("CmdOrCtrl+,"))?)
        .item(&MenuItem::with_id(app, "menu:reload", "刷新界面", true, Some("CmdOrCtrl+R"))?)
        .item(&PredefinedMenuItem::hide(app, Some("隐藏 DSH Pocket"))?)
        .separator()
        .item(&MenuItem::with_id(app, "quit", "退出 DSH Pocket", true, Some("CmdOrCtrl+Q"))?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "编辑")
        .undo().redo().separator()
        .cut().copy().paste().select_all()
        .build()?;

    let console = console_submenu(app)?;

    Menu::with_items(app, &[&app_submenu, &edit, &console])
}

#[cfg(not(target_os = "macos"))]
fn app_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<tauri::menu::Menu<R>> {
    use tauri::menu::{Menu, MenuItem, SubmenuBuilder};

    let file = SubmenuBuilder::new(app, "文件")
        .item(&MenuItem::with_id(app, "menu:open-main", "主页面", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "menu:guide", "引导页", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "menu:settings", "配置", true, None::<&str>)?)
        .item(&MenuItem::with_id(app, "menu:reload", "刷新界面", true, Some("CmdOrCtrl+R"))?)
        .build()?;

    let console = console_submenu(app)?;

    let help = SubmenuBuilder::new(app, "帮助")
        .item(&MenuItem::with_id(app, "menu:update", "检查更新…", true, None::<&str>)?)
        .separator()
        .item(&MenuItem::with_id(app, "menu:about", "关于 DSH Pocket", true, None::<&str>)?)
        .build()?;

    let edit = SubmenuBuilder::new(app, "编辑")
        .undo().redo().separator()
        .cut().copy().paste().select_all()
        .build()?;

    Menu::with_items(app, &[&file, &edit, &console, &help])
}

/// 菜单动作的唯一处理入口（窗口菜单与托盘菜单共用）。
fn handle_menu_action<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "quit" => app.exit(0),
        "menu:reload" => reload_main_webview(app),
        "open-main" | "menu:open-main" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
        }
        // 回到引导页：主窗口导航回本应用前端，并让前端进入引导向导。
        // 事件与标志双通道：窗口已在本前端时导航是 no-op，事件直达监听器；
        // 从 Web GUI 导航回来会整页重载、事件必丢，由标志兜底（前端加载后消费）。
        "menu:guide" => {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.show();
                let _ = win.set_focus();
            }
            if let Ok(mut g) = ONBOARDING_REQUESTED.lock() {
                *g = true;
            }
            navigate_main(app, "");
            let _ = app.emit("open-onboarding", ());
        }
        "menu:settings" => open_console(app, "settings"),
        "menu:about" => {
            use tauri_plugin_dialog::DialogExt;
            let info = app.package_info();
            app.dialog()
                .message(format!(
                    "DSH Pocket v{}\n\n{}\n\n© 2026 掌鲸 DSH Pocket",
                    info.version, info.name
                ))
                .title("关于 DSH Pocket")
                .kind(tauri_plugin_dialog::MessageDialogKind::Info)
                .show(|_| {});
        }
        "autostart" => {
            use tauri_plugin_autostart::ManagerExt;
            let al = app.autolaunch();
            let now = al.is_enabled().unwrap_or(false);
            let res = if now { al.disable() } else { al.enable() };
            if let Err(e) = res {
                notify(app, "开机自启设置失败", &e.to_string());
            }
            // 托盘与窗口菜单都带这个勾选项：状态变化后两侧一起重建
            refresh_tray_menu(app);
            let _ = install_menu(app);
        }
        "worker:start" => {
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = start_worker(&app);
            });
        }
        "worker:stop" => {
            let app = app.clone();
            std::thread::spawn(move || {
                let _ = run_dshc(&app, &["stop", "--json"]);
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
                    Ok(v) if !v.is_empty() => {
                        notify(&app, "DSH Pocket", &format!("新版本 {v} 可用"));
                        // 打开控制台「运行状态」页并直推版本号——那里有「立即更新」按钮
                        let _ = app.emit("update-available", &v);
                        open_console(&app, "status");
                    }
                    Ok(_) => notify(&app, "DSH Pocket", "已是最新版本"),
                    Err(e) => notify(&app, "检查更新失败", &e.to_string()),
                }
            });
        }
        other => {
            // console:<panel> → 打开控制台窗口并定位到该页
            if let Some(panel) = other.strip_prefix("console:") {
                open_console(app, panel);
            }
        }
    }
}

/// 菜单唯一挂载/刷新入口。
/// macOS：必须走 AppHandle::set_menu——Window::set_menu 在 macOS 是静默 no-op
///（Tauri 文档明言 unsupported，菜单栏为 app 级）。
/// Windows/Linux：保持窗口级、只挂主窗口——AppHandle::set_menu 在这两个平台会
/// 附加到所有无显式菜单的窗口，无边框自定义标题栏的 console 窗口会被污染。
fn install_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let menu = app_menu(app)?;
    #[cfg(target_os = "macos")]
    app.set_menu(menu)?;
    #[cfg(not(target_os = "macos"))]
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

/// 端口清场：结束占用 Worker 口 / dsh web 口的残留进程（引导页「清理端口」按钮用）。
/// 实现在 bridge CLI `dshc free-port`——与 supervisor spawn 前的自动清场同一份逻辑。
#[tauri::command]
fn port_cleanup<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let port = read_settings(&app)
        .get("port")
        .and_then(|v| v.as_i64())
        .unwrap_or(DEFAULT_PORT);
    run_dshc(&app, &["free-port", "--port", &port.to_string(), "--json"])
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

// ───────────────────── 故障恢复（一键修复 / 诊断导出）─────────────────────

/// 一键修复：端口清场 → 工具链校验/修复 → 重启 Worker → 重新打开控制台。
/// 每步独立上报，失败不阻断后续；构建块（free-port / node_install / bridge_install）全部幂等。
fn repair_impl<R: Runtime>(app: &AppHandle<R>) -> serde_json::Value {
    let home = pocket_home(app).unwrap_or_default();
    let mut steps: Vec<serde_json::Value> = Vec::new();

    // 1. 端口清场（残留进程占口是「起不来」的头号原因）
    let port = read_settings(app)
        .get("port")
        .and_then(|v| v.as_i64())
        .unwrap_or(DEFAULT_PORT);
    match run_dshc(app, &["free-port", "--port", &port.to_string(), "--json"]) {
        Ok(_) => steps.push(serde_json::json!({ "step": "free-port", "ok": true, "detail": format!("端口 {port} 已清场") })),
        Err(e) => steps.push(serde_json::json!({ "step": "free-port", "ok": false, "detail": e })),
    }

    // 2. 工具链：node 坏了清掉重装，bridge 坏了重装
    let mut tool_ok = toolchain::resolve(&home).is_ok();
    let mut tool_detail = if tool_ok { "工具链就绪".to_string() } else { String::new() };
    if !tool_ok {
        // 清损坏的受管 node 目录（缺 npm-cli / node 起不来）
        let node_root = home.join("runtimes").join("node");
        if let Ok(entries) = std::fs::read_dir(&node_root) {
            for e in entries.flatten() {
                let p = e.path();
                let healthy = toolchain::managed_node_part(p.clone())
                    .map(|part| toolchain::node_runs(&part.node))
                    .unwrap_or(false);
                if p.is_dir() && !healthy {
                    let _ = std::fs::remove_dir_all(&p);
                }
            }
        }
        // node：解析不到就按版本表重装（首个成功即止）
        if toolchain::resolve_node(&home).is_err() {
            for (major, _) in toolchain::NODE_CHOICES {
                if toolchain::node_install_impl(app, &home, *major).is_ok() {
                    break;
                }
            }
        }
        // bridge：缺失则装（依赖 pnpm，先补 tools）
        if let Ok(node) = toolchain::resolve_node(&home) {
            if toolchain::resolve_bridge(&home).is_err() {
                if toolchain::tools_install_impl(app, &home, &node).is_ok() {
                    let _ = toolchain::bridge_install_impl(app, &home, &node, false);
                }
            }
        }
        tool_ok = toolchain::resolve(&home).is_ok();
        tool_detail = if tool_ok {
            "已修复".to_string()
        } else {
            "无法自动修复，请导出诊断并联系支持".to_string()
        };
    }
    steps.push(serde_json::json!({ "step": "toolchain", "ok": tool_ok, "detail": tool_detail }));

    // 3. 重启 Worker（stop 写 stop-flag → start 自清并拉起，与 dsh_switch_version 同一模式）
    let _ = run_dshc(app, &["stop", "--json"]);
    let (start_ok, start_detail) = match start_worker(app) {
        Ok(m) => (true, m),
        Err(e) => (false, e),
    };
    steps.push(serde_json::json!({ "step": "restart", "ok": start_ok, "detail": start_detail }));

    // 4. 重新打开控制台（新 token 的 webUrl；同时清掉可能停留的 401 页）
    let status = read_status(app);
    let web_url = status
        .get("run")
        .and_then(|r| r.get("webUrl"))
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string();
    if !web_url.is_empty() {
        navigate_main_force(app, &web_url);
    }
    serde_json::json!({ "steps": steps, "webUrl": web_url })
}

/// 一键修复（状态页「尝试修复」按钮）
#[tauri::command]
async fn repair<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || Ok(repair_impl(&app)))
        .await
        .map_err(|e| format!("任务失败: {e}"))?
}

/// 脱敏访问凭据：把 `token=<值>`（URL / JSON / 日志通用）替换为 `token=***`。
/// 只认精确的 `token=` 前缀，输出仅用于诊断包——多脱敏无害，漏脱敏有害。
fn redact_secrets(s: &str) -> String {
    const MARKER: &str = "token=";
    const SECRET_CHARS: fn(u8) -> bool =
        |b: u8| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'~' | b'-' | b'%');
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len());
    let mut i = 0;
    while i < bytes.len() {
        if s[i..].starts_with(MARKER) {
            out.push_str(MARKER);
            out.push_str("***");
            i += MARKER.len();
            while i < bytes.len() && SECRET_CHARS(bytes[i]) {
                i += 1;
            }
        } else {
            // 逐字符复制（UTF-8 多字节安全：按首字节判长度）
            let b = bytes[i];
            let len = if b < 0x80 { 1 } else if b >> 5 == 0b110 { 2 } else if b >> 4 == 0b1110 { 3 } else if b >> 3 == 0b11110 { 4 } else { 1 };
            let end = (i + len).min(s.len());
            out.push_str(&s[i..end]);
            i = end;
        }
    }
    out
}

/// 本机 TCP 监听快照（unix: lsof / windows: netstat），排端口冲突用
fn listening_ports_report() -> String {
    let out = if cfg!(target_os = "windows") {
        std::process::Command::new("netstat").args(["-ano"]).output()
    } else {
        std::process::Command::new("lsof")
            .args(["-nP", "-iTCP", "-sTCP:LISTEN"])
            .output()
    };
    match out {
        Ok(o) => String::from_utf8_lossy(&o.stdout)
            .lines()
            .take(100)
            .collect::<Vec<_>>()
            .join("\n"),
        Err(e) => format!("无法获取（{e}）"),
    }
}

/// 导出脱敏诊断包（状态页「导出诊断」按钮）。返回文件路径并在文件管理器中定位。
/// 不包含：账号会话、任何 token（redact_secrets 统一处理）。
fn export_diagnostics_impl<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    let home = pocket_home(app)?;
    let pkg = app.package_info();
    let read_json_or_null = |rel: &str| -> serde_json::Value {
        std::fs::read_to_string(home.join(rel))
            .ok()
            .and_then(|t| serde_json::from_str::<serde_json::Value>(t.trim()).ok())
            .unwrap_or(serde_json::Value::Null)
    };
    // run.json 含 webUrl token：整体序列化 → 脱敏 → 再解析回 JSON
    let run: serde_json::Value = serde_json::from_str(&redact_secrets(
        &serde_json::to_string(&read_json_or_null("run.json")).unwrap_or_default(),
    ))
    .unwrap_or(serde_json::Value::Null);
    let sys_node = toolchain::probe_system_node()
        .map(|p| p.version)
        .unwrap_or_else(|e| format!("不可用（{e}）"));
    let mut node_versions: Vec<String> = std::fs::read_dir(home.join("runtimes").join("node"))
        .map(|es| {
            es.flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();
    node_versions.sort();
    let bridge = match toolchain::resolve_bridge(&home) {
        Ok((_, _, v)) => serde_json::json!({ "installed": true, "version": v }),
        Err(e) => serde_json::json!({ "installed": false, "error": e }),
    };
    let log_tail = std::fs::read_to_string(home.join("dshc.log"))
        .map(|t| {
            let lines: Vec<&str> = t.lines().collect();
            let start = lines.len().saturating_sub(200);
            redact_secrets(&lines[start..].join("\n"))
        })
        .unwrap_or_default();

    let diag = serde_json::json!({
        "kind": "dsh-pocket-diagnostics",
        "generatedAt": now_ms(),
        "appVersion": pkg.version.to_string(),
        "platform": format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH),
        "settings": read_settings(app),
        "toolchain": read_json_or_null("toolchain.json"),
        "systemNode": sys_node,
        "managedNodeVersions": node_versions,
        "bridge": bridge,
        "workerRun": run,
        "listeningPorts": listening_ports_report(),
        "dshcLogTail": log_tail,
    });
    let path = home.join(format!("diagnostics-{}.json", now_ms()));
    std::fs::write(
        &path,
        serde_json::to_string_pretty(&diag).map_err(|e| e.to_string())?,
    )
    .map_err(|e| format!("写入诊断文件失败: {e}"))?;
    {
        use tauri_plugin_opener::OpenerExt;
        let _ = app.opener().reveal_item_in_dir(&path);
    }
    Ok(path.to_string_lossy().to_string())
}

/// 导出脱敏诊断包（返回文件路径）
#[tauri::command]
async fn export_diagnostics<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || export_diagnostics_impl(&app))
        .await
        .map_err(|e| format!("任务失败: {e}"))?
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

/// 安装 bridge（dshc）到 runtimes/bridge（幂等；已满足 MIN 版本则跳过）
#[tauri::command]
async fn bridge_install<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let home = pocket_home(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let node = toolchain::resolve_node(&home)?;
        let out = toolchain::tools_install_impl(&app, &home, &node);
        out?; // bridge 的 plugin add 依赖 pnpm，先确保 tools 就位
        toolchain::bridge_install_impl(&app, &home, &node, false)
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

/// 检查 dshc 更新：本地已装版本 vs npm latest（引导页「检查更新」按钮）。
#[tauri::command]
async fn bridge_check_update<R: Runtime>(
    app: AppHandle<R>,
    registry: Option<String>,
) -> Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let home = pocket_home(&app)?;
        let current = toolchain::resolve_bridge(&home)
            .ok()
            .map(|(_, _, v)| v)
            .unwrap_or_default();
        let reg = registry
            .filter(|r| !r.trim().is_empty())
            .unwrap_or_else(|| toolchain::NPM_REGISTRY.to_string());
        let out = run_npm(
            &app,
            &["view", toolchain::BRIDGE_PACKAGE, "version", "--prefer-online", "--loglevel=error"],
            None,
            &reg,
            60,
            None,
        )?;
        if !out.success {
            return Err(format!("获取最新版本失败：{}", out.output));
        }
        let latest = out.stdout.trim().trim_matches('"').to_string();
        let update_available = !current.is_empty()
            && !latest.is_empty()
            && compare_versions(&latest, &current) == std::cmp::Ordering::Greater;
        Ok(serde_json::json!({
            "current": current,
            "latest": latest,
            "updateAvailable": update_available,
        }))
    })
    .await
    .map_err(|e| format!("任务失败: {e}"))?
}

/// 强制更新 dshc 到 npm latest（无视 MIN 版本短路）；完成后需重启 Worker 生效。
#[tauri::command]
async fn bridge_update<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    let home = pocket_home(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let node = toolchain::resolve_node(&home)?;
        let out = toolchain::tools_install_impl(&app, &home, &node);
        out?; // 与 bridge_install 同源：pnpm 先就位
        toolchain::bridge_install_impl(&app, &home, &node, true)
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
/// dsh 运行时安装完成后的近似体积（进度条分母；实际值随版本浮动，封顶 99%）
const DSH_ESTIMATED_BYTES: u64 = 48 * 1024 * 1024;

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
/// `on_line` 用于安装进度（逐行 stdout/stderr）。
fn run_npm<R: Runtime>(
    app: &AppHandle<R>,
    args: &[&str],
    cwd: Option<&std::path::Path>,
    registry: &str,
    timeout_secs: u64,
    on_line: Option<&dyn Fn(&str)>,
) -> Result<toolchain::NpmOutcome, String> {
    let home = pocket_home(app)?;
    let node = toolchain::resolve_node(&home)?;
    toolchain::run_npm_with_node(
        &node,
        &home,
        args.iter(),
        cwd,
        Some(registry),
        timeout_secs,
        on_line,
    )
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
        let out = run_npm(
            &app,
            &["view", DSH_PACKAGE, "versions", "--json", "--prefer-online", "--loglevel=error"],
            None,
            &reg,
            120,
            None,
        )?;
        if !out.success {
            return Err(format!("获取版本列表失败：{}", out.output));
        }
        // 只解析 stdout：stderr 混进来会炸 JSON。npm view --json 在只有一个版本时
        // 返回字符串而非数组，这里统一成 Vec
        let v: serde_json::Value = serde_json::from_str(out.stdout.trim())
            .map_err(|e| format!("版本列表解析失败: {e}（原始输出前 200 字符：{}）", &out.stdout[..out.stdout.len().min(200)]))?;
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
        // npm 非交互模式没有原生百分比：轮询安装目录的实际写入体积做真实进度
        // （reify 阶段目录持续增长，最终约 48MB；下载阶段计入 ~/.npm 缓存看不到，
        //  但那只占小头）。UI 端按 received/total 画进度条。
        let stop_poller = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let poller = {
            let stop = std::sync::Arc::clone(&stop_poller);
            let app = app.clone();
            let dir = dir.clone();
            std::thread::spawn(move || {
                while !stop.load(std::sync::atomic::Ordering::Relaxed) {
                    std::thread::sleep(std::time::Duration::from_millis(800));
                    let bytes = dir_size(&dir);
                    let _ = app.emit("bootstrap-progress", serde_json::json!({
                        "step": "dsh", "phase": "npm",
                        "received": bytes, "total": DSH_ESTIMATED_BYTES,
                    }));
                }
            })
        };
        let mut res = run_npm(&app, &base, Some(&dir), &reg, NPM_INSTALL_TIMEOUT_SECS, Some(&on_line))?;

        // npm 可能拿陈旧 registry 元数据报 ETARGET（新版本刚发布时常见），强刷重试一次
        if !res.success && (res.output.contains("ETARGET") || res.output.contains("notarget")) {
            let mut retry = base.to_vec();
            retry.push("--prefer-online");
            res = run_npm(&app, &retry, Some(&dir), &reg, NPM_INSTALL_TIMEOUT_SECS, Some(&on_line))?;
        }
        stop_poller.store(true, std::sync::atomic::Ordering::Relaxed);
        let _ = poller.join();

        if !res.success {
            let _ = std::fs::remove_dir_all(&dir); // 清半成品，避免被当成可用版本
            return Err(format!("安装 {version} 失败：{}", res.output));
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
        // 所有菜单（窗口菜单 + 托盘菜单）点击的唯一事件出口，统一进 handle_menu_action；
        // 托盘侧不要再挂监听，否则同一事件会被处理两次（自启开关会 toggle 两次）
        .on_menu_event(|app, event| {
            handle_menu_action(app, event.id().as_ref());
        })
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
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            dshc_status,
            dshc_start,
            dshc_stop,
            port_cleanup,
            repair,
            export_diagnostics,
            dshc_resume,
            preflight_check,
            bootstrap_status,
            node_install,
            system_node_probe,
            tools_install,
            bridge_install,
            bridge_check_update,
            bridge_update,
            bootstrap_complete,
            take_onboarding_request,
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
            install_menu(app.handle())?;
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
                return;
            }
            // 回焦自愈：webview 长时间后台后事件流可能不恢复，超时则整页刷新
            if let tauri::WindowEvent::Focused(true) = event {
                let app = window.app_handle();
                if let Some(win) = app.get_webview_window(window.label()) {
                    selfheal_stale_webview(app, &win);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running DSH Pocket");
}

/// 必经纯逻辑的单元测试：版本比较（受管 Node/dsh 择优 + bridge 版本门的基础）、
/// URL 编码（登录回调跳转）、预检条目形状、目录体积统计。
#[cfg(test)]
mod lib_logic_tests {
    use super::*;

    #[test]
    fn compare_versions_numeric_segments() {
        use std::cmp::Ordering::*;
        // 字典序在这里是错的：字符串 "0.1.10" < "0.1.9"
        assert_eq!(compare_versions("0.1.10", "0.1.9"), Greater);
        assert_eq!(compare_versions("0.1.4", "0.1.10"), Less);
        assert_eq!(compare_versions("2.0.0", "1.9.9"), Greater);
        assert_eq!(compare_versions("1.2.3", "1.2.3"), Equal);
        // v 前缀归一
        assert_eq!(compare_versions("v1.2.3", "1.2.3"), Equal);
        // 缺段按 0
        assert_eq!(compare_versions("1.2", "1.2.0"), Equal);
        assert_eq!(compare_versions("1.2", "1.2.1"), Less);
        // 非数字段按 0；带连字符的预发布段按段比较
        assert_eq!(compare_versions("1.x.0", "1.0.0"), Equal);
        assert_eq!(compare_versions("0.1.4-rc", "0.1.4"), Equal);
        // bridge 门：MIN_BRIDGE_VERSION = 0.1.4
        assert_eq!(compare_versions("0.1.3", "0.1.4"), Less);
        assert_eq!(compare_versions("0.1.5", "0.1.4"), Greater);
    }

    #[test]
    fn urlencode_keeps_unreserved_and_escapes_rest() {
        assert_eq!(urlencode("abcXYZ012-_.~"), "abcXYZ012-_.~");
        assert_eq!(urlencode("a b"), "a%20b");
        assert_eq!(urlencode("a+b/c?d=1&e"), "a%2Bb%2Fc%3Fd%3D1%26e");
        assert_eq!(urlencode("%"), "%25");
        // 中文按 UTF-8 逐字节转义
        assert_eq!(urlencode("中"), "%E4%B8%AD");
    }

    #[test]
    fn preflight_item_shape() {
        let no_fix = preflight_item("gateway", "warn", "不可达", None);
        assert_eq!(no_fix["id"], "gateway");
        assert_eq!(no_fix["state"], "warn");
        assert_eq!(no_fix["detail"], "不可达");
        assert!(no_fix["fix"].is_null());
        let with_fix = preflight_item("node", "fail", "缺失", Some("安装"));
        assert_eq!(with_fix["fix"], "安装");
    }

    #[test]
    fn dir_size_sums_nested_files() {
        let root = std::env::temp_dir().join(format!("dsh-pocket-ds-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("sub")).unwrap();
        std::fs::write(root.join("a.bin"), [0u8; 10]).unwrap();
        std::fs::write(root.join("sub").join("b.bin"), [0u8; 5]).unwrap();
        assert_eq!(dir_size(&root), 15);
        // 不存在的目录 = 0，不 panic
        assert_eq!(dir_size(&root.join("nope")), 0);
        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn managed_dsh_bin_layout() {
        let dir = PathBuf::from("/runtimes/dsh/0.1.5");
        let bin = managed_dsh_bin(&dir);
        if cfg!(target_os = "windows") {
            assert_eq!(bin, PathBuf::from("/runtimes/dsh/0.1.5/node_modules/.bin/dsh.cmd"));
        } else {
            assert_eq!(bin, PathBuf::from("/runtimes/dsh/0.1.5/node_modules/.bin/dsh"));
        }
    }

    #[test]
    fn now_ms_is_sane() {
        assert!(now_ms() > 1_700_000_000_000); // 2023-11 之后
    }
}

#[cfg(test)]
mod recovery_logic_tests {
    use super::*;

    #[test]
    fn url_origin_extracts_scheme_host_port() {
        assert_eq!(url_origin("http://127.0.0.1:3080/?token=x"), Some("http://127.0.0.1:3080".into()));
        assert_eq!(url_origin("http://localhost:3080/app"), Some("http://localhost:3080".into()));
        assert_eq!(url_origin("https://example.com"), Some("https://example.com".into()));
        assert_eq!(url_origin("not a url"), None);
    }

    #[test]
    fn auto_restart_needs_onboarding_and_no_stop_flag() {
        // 崩溃自愈：掉线 + 引导完成 + 无 stop-flag
        assert!(should_auto_restart(false, true, false));
        // 用户主动停止（有 stop-flag）不抢启动
        assert!(!should_auto_restart(false, true, true));
        // 未完成引导：交给向导
        assert!(!should_auto_restart(false, false, false));
        // 本来就在跑：无需重启
        assert!(!should_auto_restart(true, true, false));
    }

    #[test]
    fn restart_interval_backs_off_and_caps() {
        let base = restart_interval(0);
        assert!(restart_interval(1) > base);
        assert!(restart_interval(3) > restart_interval(2));
        assert_eq!(restart_interval(6), restart_interval(10), "封顶后不再增长");
        assert!(restart_interval(6) <= Duration::from_secs(600));
    }

    #[test]
    fn redact_secrets_masks_token_values() {
        assert_eq!(redact_secrets("http://127.0.0.1:3080/?token=abc123-X.y"), "http://127.0.0.1:3080/?token=***");
        assert_eq!(redact_secrets("\"webUrl\":\"http://x/?token=a1&port\":3"), "\"webUrl\":\"http://x/?token=***&port\":3");
        // 无值 / 行尾
        assert_eq!(redact_secrets("token="), "token=***");
        // 不含 token= 的文本原样保留
        assert_eq!(redact_secrets("hello world"), "hello world");
        // tokenizer= 不误伤（token= 后无 secret 字符时值段为空）
        assert_eq!(redact_secrets("my tokenizer=fun"), "my tokenizer=fun");
    }
}
