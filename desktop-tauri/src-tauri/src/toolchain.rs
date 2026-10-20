//! 运行时工具链解析 + 首次引导（去 sidecar 化）。
//!
//! 安装包不再内置 Node/bridge（v0.2.0 起）：首次启动由向导从网络组装——
//!   系统 Node（复用，零下载）或受管下载 runtimes/node/<ver>（npmmirror 镜像 + sha256 校验）
//!   → pnpm 装进 runtimes/tools/（dsh plugin add 依赖，绝不写用户系统目录）
//!   → npm 装 @deepseek-harness-pocket/bridge → runtimes/bridge/
//! 本模块是唯一知道这些布局的地方；lib.rs 只调 resolve()/bootstrap_*()。

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::{LazyLock, Mutex};
use std::time::{Duration, Instant};

use tauri::{AppHandle, Emitter, Runtime};

// ── 常量（产物与 SHASUMS256.txt 已在 npmmirror 镜像探测存在）────────

pub const NODE_MIRROR: &str = "https://registry.npmmirror.com/-/binary/node";
/// 向导提供的受管 Node 版本（major → 精确版本，随 App 版本钉死）
pub const NODE_CHOICES: &[(u8, &str)] = &[(24, "v24.21.0"), (22, "v22.23.2")];
/// 系统 Node 最低可用 major（太老则引导用户用受管版）
pub const MIN_SYSTEM_NODE_MAJOR: u64 = 20;
pub const BRIDGE_PACKAGE: &str = "@deepseek-harness-pocket/bridge";
/// bridge 低于此版本视为「npm 镜像同步延迟」，要求重试安装
pub const MIN_BRIDGE_VERSION: &str = "0.1.4";
pub const PNPM_SPEC: &str = "pnpm@10";
pub const NPM_REGISTRY: &str = "https://registry.npmmirror.com";

// ── 解析结果 ─────────────────────────────────────────────

/// Node 来源（供状态展示与 toolchain.json 记录）
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum NodeSource {
    System,
    Managed,
}

impl NodeSource {
    pub fn as_str(self) -> &'static str {
        match self {
            NodeSource::System => "system",
            NodeSource::Managed => "managed",
        }
    }
}

/// 可运行的 Node 侧最小集：npm 命令（装 bridge/dsh/pnpm）只需要它，不需要 bridge 已就位
#[derive(Debug)]
pub struct NodePart {
    pub node: PathBuf,
    pub node_bin_dir: PathBuf,
    pub npm_cli: PathBuf,
    pub source: NodeSource,
    /// 受管时的精确版本（如 v24.21.0）；系统来源为探测到的版本
    pub version: String,
}

/// 完整工具链：run_dshc / status 轮询需要 bridge 也已就位
pub struct Toolchain {
    pub node: NodePart,
    pub cli: PathBuf,
    pub bridge_version: String,
}

pub fn node_dir(home: &Path, version: &str) -> PathBuf {
    home.join("runtimes").join("node").join(version)
}

pub fn tools_dir(home: &Path) -> PathBuf {
    home.join("runtimes").join("tools")
}

/// pnpm shim 所在目录（npm --prefix 安装：所有平台统一落 node_modules/.bin）
pub fn tools_bin_dir(home: &Path) -> PathBuf {
    tools_dir(home).join("node_modules").join(".bin")
}

fn bridge_root(home: &Path) -> PathBuf {
    home.join("runtimes")
        .join("bridge")
        .join("node_modules")
        .join("@deepseek-harness-pocket")
        .join("bridge")
}

fn node_rel_paths() -> (&'static str, &'static str) {
    if cfg!(target_os = "windows") {
        ("node.exe", "node_modules/npm/bin/npm-cli.js")
    } else {
        ("bin/node", "lib/node_modules/npm/bin/npm-cli.js")
    }
}

fn read_toolchain_json(home: &Path) -> Option<(String, String)> {
    let text = std::fs::read_to_string(home.join("toolchain.json")).ok()?;
    let v: serde_json::Value = serde_json::from_str(text.trim()).ok()?;
    Some((
        v.get("nodeSource")?.as_str()?.to_string(),
        v.get("nodeVersion")?.as_str()?.to_string(),
    ))
}

pub fn write_toolchain_json(home: &Path, source: NodeSource, version: &str) -> Result<(), String> {
    std::fs::create_dir_all(home).map_err(|e| e.to_string())?;
    let text = serde_json::json!({
        "nodeSource": source.as_str(),
        "nodeVersion": version,
    });
    std::fs::write(
        home.join("toolchain.json"),
        format!("{}\n", serde_json::to_string_pretty(&text).map_err(|e| e.to_string())?),
    )
    .map_err(|e| format!("写入 toolchain.json 失败: {e}"))
}

/// 从 node 所在目录按发行版布局反推 npm-cli.js（nvm/官方发行版/homebrew 同构）：
///   posix: <bin>/../lib/node_modules/npm/bin/npm-cli.js
///   win:   <dir>/node_modules/npm/bin/npm-cli.js（node.exe 与 node_modules 同级）
fn npm_cli_for_node_dir(node_bin_dir: &Path) -> Option<PathBuf> {
    if cfg!(target_os = "windows") {
        let cli = node_bin_dir.join("node_modules/npm/bin/npm-cli.js");
        cli.exists().then_some(cli)
    } else {
        let cli = node_bin_dir
            .parent()
            .map(|p| p.join("lib/node_modules/npm/bin/npm-cli.js"));
        cli.filter(|p| p.exists())
    }
}

pub fn managed_node_part(dir: PathBuf) -> Option<NodePart> {
    let (node_rel, npm_rel) = node_rel_paths();
    let node = dir.join(node_rel);
    if !node.exists() {
        return None;
    }
    let npm_cli = dir.join(npm_rel);
    if !npm_cli.exists() {
        return None;
    }
    let node_bin_dir = if cfg!(target_os = "windows") {
        dir.clone()
    } else {
        dir.join("bin")
    };
    let version = dir
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_default();
    Some(NodePart { node, node_bin_dir, npm_cli, source: NodeSource::Managed, version })
}

/// 在 PATH 上探测系统 node 并校验 npm 可解析。
/// 返回 Ok = 可复用；Err = 原因（给向导灰置文案）。
pub fn probe_system_node() -> Result<NodePart, String> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    probe_system_node_on(std::env::split_paths(&path))
}

/// 同上，但 PATH 目录由调用方注入（测试用；生产壳只读进程 env）。
fn probe_system_node_on<I>(dirs: I) -> Result<NodePart, String>
where
    I: IntoIterator<Item = PathBuf>,
{
    let exe = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
    for dir in dirs {
        let candidate = dir.join(exe);
        if !candidate.is_file() {
            continue;
        }
        let version = probe_node_version(&candidate);
        let Some(version) = version else {
            return Err(format!("{} 无法执行（可能已损坏）", candidate.display()));
        };
        let major: u64 = version
            .trim_start_matches('v')
            .split('.')
            .next()
            .and_then(|s| s.parse().ok())
            .unwrap_or(0);
        if major < MIN_SYSTEM_NODE_MAJOR {
            return Err(format!(
                "系统 Node {version} 过旧（需要 ≥ v{MIN_SYSTEM_NODE_MAJOR}），请选择受管版本"
            ));
        }
        let npm_cli = npm_cli_for_node_dir(&dir).ok_or_else(|| {
            format!("系统 Node {version} 缺少 npm（发行版不完整），请选择受管版本")
        })?;
        return Ok(NodePart {
            node: candidate,
            node_bin_dir: dir,
            npm_cli,
            source: NodeSource::System,
            version,
        });
    }
    Err("系统未安装 Node.js".to_string())
}

/// `node --version`（静默、3s 超时语义由调用方重试）；失败返回 None
fn probe_node_version(node: &Path) -> Option<String> {
    let mut cmd = Command::new(node);
    super::no_window(&mut cmd);
    let out = cmd.arg("--version").output().ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (!text.is_empty()).then_some(text)
}

/// node 能否执行并报出版本（一键修复的健康判据；比「文件存在」更强）
pub fn node_runs(node: &Path) -> bool {
    probe_node_version(node).is_some()
}

/// 探测 PATH 上全局安装的 dsh（用户已有环境优先：向导 Harness 步展示/直接可用）。
/// 返回探测到的版本字符串。
pub fn probe_global_dsh() -> Option<String> {
    let path = std::env::var_os("PATH").unwrap_or_default();
    let exe = if cfg!(target_os = "windows") { "dsh.cmd" } else { "dsh" };
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(exe);
        if !candidate.is_file() {
            continue;
        }
        let mut cmd = Command::new(&candidate);
        super::no_window(&mut cmd);
        let Ok(out) = cmd.arg("--version").output() else {
            continue;
        };
        if !out.status.success() {
            continue;
        }
        let version = String::from_utf8_lossy(&out.stdout).trim().to_string();
        if !version.is_empty() {
            return Some(version);
        }
    }
    None
}

/// 受管 node 候选：toolchain.json 声明的版本优先，否则最高版本
fn pick_managed(home: &Path) -> Option<NodePart> {
    let root = home.join("runtimes").join("node");
    let declared = read_toolchain_json(home).and_then(|(source, ver)| {
        (source == "managed").then(|| root.join(&ver)).filter(|d| d.is_dir())
    });
    if let Some(dir) = declared {
        return managed_node_part(dir);
    }
    let mut best: Option<NodePart> = None;
    for entry in std::fs::read_dir(&root).ok()?.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let Some(candidate) = managed_node_part(path) else {
            continue;
        };
        let better = match &best {
            None => true,
            Some(cur) => {
                super::compare_versions(&candidate.version, &cur.version)
                    == std::cmp::Ordering::Greater
            }
        };
        if better {
            best = Some(candidate);
        }
    }
    best
}

/// 解析 Node 侧（npm 命令的前置条件；bridge 未装不影响本函数）。
/// 顺序：DSH_POCKET_SIDECAR env → toolchain.json 声明 → 受管最高版本 → dev 态源码旁 sidecar。
pub fn resolve_node(home: &Path) -> Result<NodePart, String> {
    let sidecar = std::env::var("DSH_POCKET_SIDECAR").ok().filter(|s| !s.is_empty());
    resolve_node_with(home, sidecar.as_deref())
}

/// 同上，但 sidecar 目录由调用方注入（测试用；None = env 未设置）。
fn resolve_node_with(home: &Path, sidecar_env: Option<&str>) -> Result<NodePart, String> {
    // 1. 显式环境变量（旧 sidecar 布局 / 测试 / dev）
    if let Some(dir) = sidecar_env {
        if !dir.is_empty() {
            let root = PathBuf::from(&dir);
            let (node_rel, _) = node_rel_paths();
            let node = root.join(node_rel);
            if node.exists() {
                return Ok(NodePart {
                    node_bin_dir: if cfg!(target_os = "windows") {
                        root.join("node")
                    } else {
                        root.join("node/bin")
                    },
                    npm_cli: npm_cli_for_node_dir(&root.join(if cfg!(target_os = "windows") {
                        "node"
                    } else {
                        "node/bin"
                    }))
                    .unwrap_or_else(|| root.join("node/lib/node_modules/npm/bin/npm-cli.js")),
                    node,
                    source: NodeSource::Managed,
                    version: String::new(),
                });
            }
            return Err(format!("DSH_POCKET_SIDECAR 指向的目录缺少 node: {dir}"));
        }
    }
    // 2. toolchain.json 声明 system：现在就探测（声明了但坏了给出明确原因）
    if let Some((source, _ver)) = read_toolchain_json(home) {
        if source == "system" {
            return probe_system_node();
        }
    }
    // 3. 受管最高版本
    if let Some(part) = pick_managed(home) {
        return Ok(part);
    }
    // 4. dev 态兜底：pnpm tauri dev 不必先跑引导
    #[cfg(debug_assertions)]
    {
        let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..").join("node-sidecar");
        let (node_rel, _) = node_rel_paths();
        if dir.join(node_rel).exists() {
            if let Some(mut part) = managed_node_part(dir.join("node")) {
                part.source = NodeSource::Managed;
                return Ok(part);
            }
        }
    }
    Err("尚未安装 Node 运行环境，请完成初始设置向导".to_string())
}

/// 解析 bridge（dshc CLI）。Node 未就位时本函数也会失败（错误信息以 node 优先）。
pub fn resolve_bridge(home: &Path) -> Result<(PathBuf, PathBuf, String), String> {
    let root = bridge_root(home);
    let cli = root.join("dist").join("cli").join("index.js");
    if !cli.exists() {
        return Err("尚未安装 Worker 核心（bridge），请完成初始设置向导".to_string());
    }
    let version = std::fs::read_to_string(root.join("package.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(|s| s.to_string()))
        .unwrap_or_default();
    Ok((root, cli, version))
}

/// 完整解析（node + bridge）。run_dshc / 轮询用。
pub fn resolve(home: &Path) -> Result<Toolchain, String> {
    let node = resolve_node(home)?;
    let (_, cli, bridge_version) = resolve_bridge(home)?;
    Ok(Toolchain { node, cli, bridge_version })
}

/// PATH 前置：node bin 目录 + 受管 tools bin（pnpm）。tools 不存在时前置空目录无害。
pub fn path_env(home: &Path, node_bin_dir: &Path) -> Result<std::ffi::OsString, String> {
    let base = std::env::var_os("PATH").unwrap_or_default();
    path_env_with(&base, home, node_bin_dir)
}

/// 同上，但前置基础 PATH 由调用方注入（测试用）。
fn path_env_with(base: &std::ffi::OsStr, home: &Path, node_bin_dir: &Path) -> Result<std::ffi::OsString, String> {
    std::env::join_paths(
        std::iter::once(node_bin_dir.to_path_buf())
            .chain(std::iter::once(tools_bin_dir(home)))
            .chain(std::env::split_paths(base)),
    )
    .map_err(|e| format!("PATH 组装失败: {e}"))
}

// ─────────── Worker 启动用的 PATH：补上"登录 shell 那一层" ───────────
//
// 背景（本机实测）：
//   macOS 上 GUI 应用继承的 PATH 只有 `/usr/bin:/bin:/usr/sbin:/sbin`，
//   `.zshrc` 永远不会被 GUI 进程读取（只有**交互式** zsh 才读）。
//   于是 Worker / dsh / 模型 shell 调用看不到 Homebrew、nvm、pyenv、conda……
//   而 dshc 会把环境一路透传（`spawn(dsh, { env: { ...process.env } })`），
//   所以修复点只有一处：**我们 spawn dshc 时给的那个 PATH**。
//
// 为什么不照抄 VS Code 的"整份 env 快照"：Worker 是**可被手机远程驾驶**的守护进程，
//   把用户整份环境（含各类密钥）灌进去等于权限升级。PATH 不是秘密、又最难手抄，
//   是唯一值得自动补的一项；其余变量走 dsh 自己的 `$DSH_HOME/.env`。
//
// 另外，PATH **只能**走这条通道：上游 dsh-app-boot 的 `readEnvLayer` 把 PATH 列为
//   bootstrap-only，任何 `.env` 里写 PATH 都会让 dsh 拒绝启动（见下面的拒绝名单）。

/// 解析结果里 PATH 值的定界标记（用户 rc 可能 echo 噪声，必须夹标记再取中间）。
const PATH_BEGIN: &str = "__DSH_POCKET_PATH_BEGIN__";
const PATH_END: &str = "__DSH_POCKET_PATH_END__";

/// 登录 shell 解析结果的缓存时长：够短以让"改了 .zshrc 重启 Worker"生效，
/// 够长以免每次启动 Worker 都付一次起 shell 的代价（本机实测 ~1.45s）。
const LOGIN_PATH_TTL: Duration = Duration::from_secs(300);
/// 解析超时。VS Code 默认 10s；我们压到 5s——超时只是回退继承 PATH，
/// 而"启动 Worker"是用户按了按钮在等的路径，不能让 rc 把它卡住 10 秒。
const LOGIN_PATH_TIMEOUT: Duration = Duration::from_secs(5);

/// 合并两段 PATH：primary 在前，重复项与空段去掉（保序）。纯函数，便于单测。
pub fn merge_paths(primary: &std::ffi::OsStr, fallback: &std::ffi::OsStr) -> std::ffi::OsString {
    let mut seen: Vec<PathBuf> = Vec::new();
    let mut out: Vec<PathBuf> = Vec::new();
    for p in std::env::split_paths(primary).chain(std::env::split_paths(fallback)) {
        if p.as_os_str().is_empty() || seen.contains(&p) {
            continue;
        }
        seen.push(p.clone());
        out.push(p);
    }
    std::env::join_paths(out).unwrap_or_else(|_| primary.to_os_string())
}

/// 起一次登录+交互 shell，拿到**全部**环境（键+值），失败/超时返回 None。
///
/// 参数取 `-i -l -c`（VS Code 同款）：**必须 `-i -l` 才会读 `.zshrc`/`.zprofile`**，
/// 只 `-c` 的话 zsh 只读 `.zshenv`。stderr 丢弃（rc 常往 stderr 喷），stdin 关闭。
///
/// **值只在本进程内流转**：用于（a）分类报告只取键名（b）把用户勾选的键写进
/// `$DSH_HOME/.env`。绝不进日志、诊断、UI 或 IPC 返回值。
/// `BASH_FUNC_*`（导出成环境变量的 shell 函数）在捕获处直接丢弃——它们会让每次
/// 子 bash 都执行函数体，上游也专门把它们列为禁止前缀。
fn login_shell_env_uncached() -> Option<Vec<(String, String)>> {
    // Windows 不做：Explorer 启动的进程本来就继承用户环境（本问题只存在于 macOS/Linux）
    if cfg!(target_os = "windows") {
        return None;
    }
    let shell = std::env::var_os("SHELL")
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| std::ffi::OsString::from("/bin/zsh"));
    if !Path::new(&shell).exists() {
        return None;
    }
    // `command env` 绕过 rc 里可能定义的 env 别名/函数
    let script = format!(
        "printf '%s\\n' '{PATH_BEGIN}'; command env; printf '%s\\n' '{PATH_END}'"
    );
    let mut cmd = std::process::Command::new(&shell);
    cmd.args(["-i", "-l", "-c", &script])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped());
    let started = Instant::now();
    let mut child = cmd.spawn().ok()?;
    let stdout = child.stdout.take()?;

    // 读 stdout 放到线程里，主线程带超时等待——std 没有 wait_timeout
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        use std::io::Read as _;
        let mut buf = String::new();
        let mut out = stdout;
        let _ = out.read_to_string(&mut buf);
        let _ = tx.send(buf);
    });

    let raw = match rx.recv_timeout(LOGIN_PATH_TIMEOUT) {
        Ok(text) => text,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return None; // 超时：杀掉并回退
        }
    };
    let _ = child.kill();
    let _ = child.wait();

    let entries = parse_marked_env(&raw);
    #[cfg(debug_assertions)]
    eprintln!(
        "[env] login shell env: {} 项 ({}ms)",
        entries.len(),
        started.elapsed().as_millis()
    );
    if entries.is_empty() {
        None
    } else {
        Some(entries)
    }
}

/// 解析 `BEGIN\nKEY=VALUE…\nEND` 之间的环境（纯函数，便于单测）。
/// 按**第一个** `=` 切分；`BASH_FUNC_*` 丢弃；格式不合法的行忽略。
pub fn parse_marked_env(raw: &str) -> Vec<(String, String)> {
    let Some(start) = raw.find(PATH_BEGIN) else { return Vec::new() };
    let rest = &raw[start + PATH_BEGIN.len()..];
    let Some(end) = rest.find(PATH_END) else { return Vec::new() };
    let body = &rest[..end];
    let mut out: Vec<(String, String)> = Vec::new();
    for line in body.lines() {
        let Some(eq) = line.find('=') else { continue };
        let key = line[..eq].trim();
        if key.is_empty() || !key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            continue;
        }
        if key.starts_with("BASH_FUNC_") {
            continue;
        }
        let value = line[eq + 1..].to_string();
        match out.iter_mut().find(|(k, _)| k == key) {
            Some(slot) => slot.1 = value,
            None => out.push((key.to_string(), value)),
        }
    }
    out
}

/// 带 TTL 缓存的登录 shell 环境（键+值）。
static LOGIN_ENV_CACHE: LazyLock<Mutex<Option<(Instant, Option<Vec<(String, String)>>)>>> =
    LazyLock::new(|| Mutex::new(None));

pub fn login_shell_env_cached() -> Option<Vec<(String, String)>> {
    let mut guard = match LOGIN_ENV_CACHE.lock() {
        Ok(g) => g,
        Err(p) => p.into_inner(),
    };
    if let Some((at, v)) = guard.as_ref() {
        if at.elapsed() < LOGIN_PATH_TTL {
            return v.clone();
        }
    }
    let fresh = login_shell_env_uncached();
    *guard = Some((Instant::now(), fresh.clone()));
    fresh
}

/// 强制重新捕获（清缓存后重取）。
///
/// 为什么必须有：TTL 是 300s，而用户在 UI 上点「重新扫描」时**期望立刻生效**——
/// 如果只读缓存，他改完 `.zshrc` 点重新扫描会发现"什么都没变"，然后合理地认为功能坏了。
pub fn login_shell_env_refresh() -> Option<Vec<(String, String)>> {
    if let Ok(mut g) = LOGIN_ENV_CACHE.lock() {
        *g = None;
    }
    login_shell_env_cached()
}

/// 登录 shell 的 PATH（缓存）。
pub fn login_shell_path_cached() -> Option<std::ffi::OsString> {
    login_shell_env_cached().and_then(|env| {
        env.into_iter()
            .find(|(k, _)| k == "PATH")
            .map(|(_, v)| std::ffi::OsString::from(v))
            .filter(|v| !v.is_empty())
    })
}

/// Worker 启动用的 PATH：
/// `[受管 node bin, 受管 tools bin] + 登录 shell PATH + 继承 PATH（去重、保序）`。
///
/// 无从解析（非 macOS/Linux、无 shell、超时）时退化为 [`path_env`] 的行为。
pub fn worker_path_env(home: &Path, node_bin_dir: &Path) -> Result<std::ffi::OsString, String> {
    let inherited = std::env::var_os("PATH").unwrap_or_default();
    let base = match login_shell_path_cached() {
        Some(shell_path) => merge_paths(&shell_path, &inherited),
        None => inherited,
    };
    path_env_with(&base, home, node_bin_dir)
}

// ─────────── `$DSH_HOME/.env` 检查（照抄上游的拒绝规则）───────────
//
// 上游 dsh-app-boot 的 `readEnvLayer` 会**在应用任何值之前**拒绝 bootstrap-only 名字：
// 命中就 throw → **dsh 启动失败**。用户把 `PATH=`（或 `DSH_*`、`HOME`、把代理放错层）
// 写进 `.env` 时，我们目前只能看到一个笼统的"启动失败"。
// 下面的名单是**逐字**从 `dsh-app-boot/lib/index.js` 抄的，目的是让控制台直接指出
// "是哪一行让 Worker 起不来"。

/// 任何 `.env` 都不得设置的名字（大小写不敏感）。
pub const DSH_ENV_REFUSED_NAMES: &[&str] = &[
    "PATH", "HOME", "USERPROFILE", "SHELL", "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS",
    "LD_PRELOAD", "LD_LIBRARY_PATH", "LD_AUDIT", "BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS",
    "PERL5OPT", "PERL5LIB", "PYTHONSTARTUP", "PYTHONPATH", "RUBYOPT", "RUBYLIB",
    "JAVA_TOOL_OPTIONS", "_JAVA_OPTIONS", "JDK_JAVA_OPTIONS", "PYTHONHOME",
    "GIT_SSH", "GIT_SSH_COMMAND", "GIT_EXTERNAL_DIFF", "GIT_PAGER", "GIT_EDITOR", "GIT_ASKPASS",
    "SSH_ASKPASS", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_CONFIG_COUNT",
    "EDITOR", "VISUAL", "PAGER", "BROWSER",
    "DEEPSEEK_BASE_URL", "DEEPSEEK_SEARCH_BASE_URL",
    "SSL_CERT_FILE", "SSL_CERT_DIR",
    "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
    "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "NODE_TLS_REJECT_UNAUTHORIZED",
];
/// 任何 `.env` 都不得使用的前缀。
pub const DSH_ENV_REFUSED_PREFIXES: &[&str] = &["DSH_", "XDG_", "DYLD_", "BASH_FUNC_"];
/// 唯二例外：这四个代理名**允许出现在 `$DSH_HOME/.env`**（"用户自己的机器级默认值"）。
/// CA/TLS 类名字不在例外里——"它们改变的是信任什么，而不是流量去哪"。
pub const DSH_HOME_LAYER_PROXY_NAMES: &[&str] = &["HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY"];

/// dsh 主目录：显式 > `$DSH_HOME` > `~/.dsh`（与 dsh-home-paths 同规则；本应用不传显式值）。
pub fn dsh_home_dir() -> Option<PathBuf> {
    if let Some(v) = std::env::var_os("DSH_HOME") {
        if !v.is_empty() {
            return Some(PathBuf::from(v));
        }
    }
    std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".dsh"))
}

/// 该名字写进 `$DSH_HOME/.env` 会不会让 dsh 拒绝启动。
pub fn env_name_refused_in_home_layer(name: &str) -> bool {
    let up = name.to_uppercase();
    if DSH_HOME_LAYER_PROXY_NAMES.contains(&up.as_str()) {
        return false; // 代理名在"用户自己那层"是允许的
    }
    DSH_ENV_REFUSED_NAMES.contains(&up.as_str())
        || DSH_ENV_REFUSED_PREFIXES.iter().any(|p| up.starts_with(p))
}

/// 解析 `.env` 的**键名**（绝返回值：值里可能有密钥，而诊断报告要能外发）。
/// 容忍 `# 注释`、`export KEY=v`、`KEY="v"`、空行。
pub fn parse_env_keys(content: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line.strip_prefix("export ").unwrap_or(line).trim_start();
        let Some(eq) = line.find('=') else { continue };
        let name = line[..eq].trim();
        if name.is_empty() || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
            continue;
        }
        if !out.iter().any(|k| k == name) {
            out.push(name.to_string());
        }
    }
    out
}

/// 体检**某个目录**下的 `.env`（纯逻辑：不碰 shell、不读全局状态，便于单测）。
///
/// `inherited_keys`（大写）模拟"launcher 继承到的键"，用来判断哪些 `.env` 项**不会生效**
/// ——上游规则是 `process.env[name] === undefined` 时才采纳 `.env` 的值。
pub fn inspect_env_file_at(
    dir: &Path,
    worker_path: Option<&std::ffi::OsStr>,
    inherited_keys: &[String],
) -> serde_json::Value {
    let path = dir.join(".env");
    let exists = path.is_file();
    let keys = std::fs::read_to_string(&path)
        .map(|t| parse_env_keys(&t))
        .unwrap_or_default();

    let refused: Vec<String> = keys
        .iter()
        .filter(|k| env_name_refused_in_home_layer(k))
        .cloned()
        .collect();
    let shadowed: Vec<String> = keys
        .iter()
        .filter(|k| {
            let up = k.to_uppercase();
            !refused.contains(k) && inherited_keys.contains(&up)
        })
        .cloned()
        .collect();

    serde_json::json!({
        "dshHome": dir.display().to_string(),
        "envFile": path.display().to_string(),
        "envFileExists": exists,
        "envKeys": keys,
        "refusedKeys": refused,
        "shadowedKeys": shadowed,
        "workerPathSegments": worker_path.map(|p| std::env::split_paths(p).count()),
        "workerPathHasHomebrew": worker_path
            .map(|p| std::env::split_paths(p).any(|s| s.to_string_lossy().contains("/opt/homebrew"))),
    })
}

/// `$DSH_HOME/.env` 的体检（外壳：解析主目录 + 继承键名，并附带登录 shell 的解析结果）。
///
/// 注意这里可能会起一次登录 shell（结果缓存 5 分钟），所以调用方要用 `spawn_blocking`。
pub fn inspect_home_env_file(worker_path: Option<&std::ffi::OsStr>) -> serde_json::Value {
    let inherited: Vec<String> = std::env::vars().map(|(k, _)| k.to_uppercase()).collect();
    let mut report = match dsh_home_dir() {
        Some(home) => inspect_env_file_at(&home, worker_path, &inherited),
        None => serde_json::json!({ "error": "无法定位 $HOME，取不到 dsh 主目录" }),
    };
    if let Some(obj) = report.as_object_mut() {
        obj.insert(
            "loginShellPath".into(),
            match login_shell_path_cached() {
                Some(p) => {
                    let segs: Vec<String> =
                        std::env::split_paths(&p).map(|x| x.display().to_string()).collect();
                    serde_json::json!({
                        "segments": segs.len(),
                        "hasHomebrew": segs.iter().any(|s| s.contains("/opt/homebrew")),
                    })
                }
                None => serde_json::Value::Null,
            },
        );
    }
    report
}

// ─────────── 启动引导：把用户终端里的变量导入 `$DSH_HOME/.env` ───────────
//
// 目标：**普通用户不用知道环境变量是什么**，也能让 Worker 拿到 Flutter/Android/
// Homebrew 这类配置。做法是"发现 → 分类 → 勾选 → 写入"，而不是把整份环境灌进去：
//   - 会话现场的键（PWD/OLDPWD/SHLVL/TERM/_…）带上只会误导子进程 → 不导入；
//   - 上游禁止的键（PATH/HOME/GIT_PAGER…）写进 `.env` 会让 dsh 拒绝启动 → 不写文件
//     （其中 PATH 已由我们启动时注入，见 run_dshc_worker）；
//   - 敏感键（*_API_KEY/_TOKEN/_SECRET…）默认不勾，由用户显式点头。
// 值只在 Rust 内部流转：报告只给键名，IPC 只收键名。

/// 受管块标记：整块可被替换/删除，用户自己写的行不受影响。
const MANAGED_BEGIN: &str = "# >>> DSH Pocket \u{5bfc}\u{5165}\u{7684}\u{7ec8}\u{7aef}\u{73af}\u{5883}";
const MANAGED_END: &str = "# <<< DSH Pocket";

/// 分组名（顺序即 UI 展示顺序）。
pub const ENV_GROUPS: &[&str] = &[
    "移动开发", "语言运行时", "包管理与镜像", "网络与代理", "IDE 与 JVM", "shell 现场", "其他",
];

/// 键 → 分组。
pub fn env_group_of(key: &str) -> &'static str {
    let up = key.to_uppercase();
    let starts = |p: &str| up.starts_with(p);
    let proxy = ["HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY"].contains(&up.as_str());
    if proxy {
        return "网络与代理";
    }
    if starts("ANDROID") || starts("FLUTTER") || starts("DEVECO") || starts("HARMONY")
        || starts("OHOS") || starts("PUB_") || starts("GRADLE") || starts("NDK")
        || starts("KOTLIN") || starts("DART") || up == "JAVA_HOME" || up == "SDKROOT"
    {
        return "移动开发";
    }
    if starts("NVM_") || starts("PNPM") || starts("CARGO") || starts("RUSTUP")
        || starts("GOROOT") || starts("GOPATH") || starts("GO") || starts("PYENV")
        || starts("CONDA") || starts("VIRTUAL_ENV") || starts("MISE_") || starts("ASDF")
        || starts("RBENV") || starts("SDKMAN") || starts("NODE_")
    {
        return "语言运行时";
    }
    if starts("HOMEBREW") || starts("NPM_CONFIG") || starts("PIP_") || starts("MIX_")
        || starts("COMPOSER") || up == "PUB_HOSTED_URL"
    {
        return "包管理与镜像";
    }
    if up.ends_with("_VM_OPTIONS") || starts("JETBRAINS") || starts("VSCODE") || starts("IDEA")
        || starts("CLION") || starts("GOLAND") || starts("WEBSTORM") || starts("PHPSTORM")
        || starts("PYCHARM") || starts("RIDER") || starts("RUBYMINE") || starts("DATAGRIP")
        || starts("STUDIO") || starts("AQUA")
    {
        return "IDE 与 JVM";
    }
    if env_is_shell_scene(key) {
        return "shell 现场";
    }
    "其他"
}

/// "这个键是某个 shell 会话此刻的现场"——带进长驻守护进程只会误导。
pub fn env_is_shell_scene(key: &str) -> bool {
    let up = key.to_uppercase();
    matches!(
        up.as_str(),
        "PWD" | "OLDPWD" | "SHLVL" | "_" | "TERM" | "TERM_PROGRAM" | "TERM_PROGRAM_VERSION"
            | "TERM_SESSION_ID" | "COLORTERM" | "ZSH" | "ZDOTDIR" | "FPATH" | "CLICOLOR"
            | "CLICOLOR_FORCE" | "NO_COLOR" | "LS_COLORS" | "LSCOLORS" | "WINDOWID" | "DISPLAY"
            | "COMMAND_MODE" | "LOGNAME" | "USER" | "SHELL" | "TMPDIR" | "WINDOW"
            | "SECURITYSESSIONID" | "MANPATH" | "INFOPATH"
    ) || up.starts_with("XPC_")
        || up.starts_with("__CF")
        || up.starts_with("SSH_")
        || up.starts_with("ITERM_")
}

/// 敏感键：默认不勾，由用户显式确认。
pub fn env_is_sensitive(key: &str) -> bool {
    let up = key.to_uppercase();
    let suffix = up.ends_with("_API_KEY")
        || up.ends_with("_APIKEY")
        || up.ends_with("_TOKEN")
        || up.ends_with("_SECRET")
        || up.ends_with("_PASSWORD")
        || up.ends_with("_PASSWD")
        || up.ends_with("_CREDENTIAL")
        || up.ends_with("_PRIVATE_KEY")
        || up.ends_with("_ACCESS_KEY")
        || up.ends_with("_KEY");
    suffix
        || ["AWS_", "GITHUB_", "GITLAB_", "OPENAI_", "ANTHROPIC_", "AZURE_", "GOOGLE_",
            "HUGGINGFACE_", "HF_", "COHERE_", "MISTRAL_", "REPLICATE_", "STRIPE_", "SLACK_",
            "TELEGRAM_", "DISCORD_", "PYPI_", "TWINE_", "NPM_TOKEN"]
            .iter()
            .any(|p| up.starts_with(p))
}

/// dotenv 行格式化：含空白/引号/`#` 的值用双引号包裹并转义。
/// 含换行的值无法可靠表示 → 返回 None（调用方计入 skipped）。
pub fn format_env_line(key: &str, value: &str) -> Option<String> {
    if value.contains('\n') || value.contains('\r') {
        return None;
    }
    let needs_quote = value.is_empty()
        || value.contains(' ')
        || value.contains('\t')
        || value.contains('"')
        || value.contains('#')
        || value.contains('\'');
    if !needs_quote {
        return Some(format!("{key}={value}"));
    }
    let escaped = value.replace('\\', "\\\\").replace('"', "\\\"");
    Some(format!("{key}=\"{escaped}\""))
}

/// 读 `$DSH_HOME/.env` 里**受管块**的键名（用于"已导入过什么/是否要重新导入"）。
pub fn managed_block_keys(env_file: &Path) -> Vec<String> {
    let Ok(text) = std::fs::read_to_string(env_file) else { return Vec::new() };
    let mut inside = false;
    let mut out: Vec<String> = Vec::new();
    for line in text.lines() {
        if line.trim_start().starts_with(MANAGED_BEGIN) {
            inside = true;
            continue;
        }
        if line.trim_start().starts_with(MANAGED_END) {
            inside = false;
            continue;
        }
        if inside {
            if let Some(eq) = line.find('=') {
                let k = line[..eq].trim();
                if !k.is_empty() {
                    out.push(k.to_string());
                }
            }
        }
    }
    out
}

/// 把受管块写进 `$DSH_HOME/.env`：替换旧块、保留用户手写的其余行。文件权限 0600。
pub fn write_managed_block(env_file: &Path, entries: &[(String, String)]) -> Result<(), String> {
    if let Some(dir) = env_file.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("创建 {} 失败: {e}", dir.display()))?;
    }
    let existing = std::fs::read_to_string(env_file).unwrap_or_default();
    // 去掉旧受管块（含两行标记），其余原样保留
    let mut kept: Vec<&str> = Vec::new();
    let mut inside = false;
    for line in existing.lines() {
        if line.trim_start().starts_with(MANAGED_BEGIN) {
            inside = true;
            continue;
        }
        if line.trim_start().starts_with(MANAGED_END) {
            inside = false;
            continue;
        }
        if !inside {
            kept.push(line);
        }
    }
    while kept.last().map(|l| l.trim().is_empty()).unwrap_or(false) {
        kept.pop();
    }

    let mut body = String::new();
    body.push_str(MANAGED_BEGIN);
    body.push_str("\n");
    for (k, v) in entries {
        match format_env_line(k, v) {
            Some(line) => body.push_str(&format!("{line}\n")),
            None => body.push_str(&format!("# 跳过 {k}（值含换行，无法写入）\n")),
        }
    }
    body.push_str(MANAGED_END);
    body.push('\n');

    let mut out = kept.join("\n");
    if !out.is_empty() {
        out.push('\n');
    }
    out.push_str(&body);
    std::fs::write(env_file, out).map_err(|e| format!("写入 {} 失败: {e}", env_file.display()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(env_file, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// 扫描：把登录 shell 的环境分类成"可导入的分组"，**只回键名**。
pub fn scan_login_env(dir: &Path) -> serde_json::Value {
    let env_file = dir.join(".env");
    let inherited: Vec<String> = std::env::vars().map(|(k, _)| k.to_uppercase()).collect();
    let already = managed_block_keys(&env_file);
    scan_env_entries(login_shell_env_cached().as_deref(), dir, &already, &inherited)
}

/// 纯逻辑部分（不碰 shell、不读全局状态，便于单测）。
///
/// ⚠️ 报告里**只有键名，永远没有值**：它会被渲染进控制台、也可能进导出诊断。
/// `entries` 里的值只在 `import_login_env` 写文件时使用。
pub fn scan_env_entries(
    entries: Option<&[(String, String)]>,
    dir: &Path,
    already: &[String],
    inherited_keys: &[String],
) -> serde_json::Value {
    let env_file = dir.join(".env");
    let empty: &[(String, String)] = &[];
    let all = entries.unwrap_or(empty);

    let mut groups: Vec<serde_json::Value> = Vec::new();
    let mut refused: Vec<String> = Vec::new();
    let mut shadowed: Vec<String> = Vec::new();
    let mut junk: Vec<String> = Vec::new();
    let mut sensitive: Vec<String> = Vec::new();

    for g in ENV_GROUPS {
        let mut keys: Vec<String> = Vec::new();
        for (k, _v) in all {
            if env_group_of(k) != *g {
                continue;
            }
            keys.push(k.clone());
            if env_name_refused_in_home_layer(k) {
                refused.push(k.clone());
            }
            if inherited_keys.contains(&k.to_uppercase()) {
                shadowed.push(k.clone());
            }
            if env_is_shell_scene(k) {
                junk.push(k.clone());
            }
            if env_is_sensitive(k) {
                sensitive.push(k.clone());
            }
        }
        keys.sort();
        if keys.is_empty() {
            continue;
        }
        // 默认勾选：工具类分组；shell 现场 / IDE / 其他 与敏感键默认不勾
        let default_checked = matches!(*g, "移动开发" | "语言运行时" | "包管理与镜像" | "网络与代理");
        groups.push(serde_json::json!({
            "name": g,
            "keys": keys,
            "defaultChecked": default_checked,
            "sensitiveKeys": keys.iter().filter(|k| env_is_sensitive(k)).collect::<Vec<_>>(),
            "refusedKeys": keys.iter().filter(|k| env_name_refused_in_home_layer(k)).collect::<Vec<_>>(),
        }));
    }

    serde_json::json!({
        "dshHome": dir.display().to_string(),
        "envFile": env_file.display().to_string(),
        "envFileExists": env_file.is_file(),
        "loginShellOk": entries.is_some(),
        "discovered": all.len(),
        "groups": groups,
        "refusedKeys": refused,
        "shadowedKeys": shadowed,
        "junkKeys": junk,
        "sensitiveKeys": sensitive,
        "alreadyImported": already,
        // 尚未导入的候选数（用于"启动时是否值得引导"）
        "pendingCount": all
            .iter()
            .filter(|(k, _)| {
                !env_name_refused_in_home_layer(k)
                    && !env_is_shell_scene(k)
                    && !already.iter().any(|a| a == k)
            })
            .count(),
    })
}

/// 纯逻辑：把"用户勾选的键"拆成「要写入的键值对」与「跳过的键+原因」。
///
/// 单独抽出来是为了可测：这条规则决定"界面说导入了 N 项，实际写了几项"，
/// 一旦不一致，用户会看到"已导入 5 项"但文件里只有 3 项（我之前就写错过这一处）。
pub fn plan_env_import(
    env: &[(String, String)],
    keys: &[String],
) -> (Vec<(String, String)>, Vec<(String, String)>) {
    let mut entries: Vec<(String, String)> = Vec::new();
    let mut skipped: Vec<(String, String)> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for k in keys {
        if seen.iter().any(|s| s == k) {
            continue; // 去重：重复键会在受管块里写两行
        }
        seen.push(k.clone());
        if env_name_refused_in_home_layer(k) {
            skipped.push((k.clone(), "上游禁止写进 .env（会让 Harness 拒绝启动）".into()));
            continue;
        }
        // 命令可被前端直接调用：不能只靠 UI 把现场变量禁掉
        if env_is_shell_scene(k) {
            skipped.push((k.clone(), "shell 会话现场变量，导入长驻进程只会误导".into()));
            continue;
        }
        match env.iter().find(|(ek, _)| ek == k) {
            // 值含换行的无法在 .env 里可靠表示：必须计入 skipped，否则计数与事实不符
            Some((_, v)) if v.contains('\n') || v.contains('\r') => {
                skipped.push((k.clone(), "值里含换行，无法写进 .env".into()));
            }
            Some((_, v)) => entries.push((k.clone(), v.clone())),
            None => skipped.push((k.clone(), "登录 shell 里没有这个变量".into())),
        }
    }
    (entries, skipped)
}

/// 导入：把选中的键（**只传键名**）的值从登录 shell 环境取出来写进受管块。
pub fn import_login_env(dir: &Path, keys: &[String]) -> Result<serde_json::Value, String> {
    let env = login_shell_env_cached()
        .ok_or_else(|| "取不到登录 shell 环境（超时或没有 SHELL）".to_string())?;
    let (entries, skipped) = plan_env_import(&env, keys);
    let env_file = dir.join(".env");
    write_managed_block(&env_file, &entries)?;
    let written: Vec<String> = entries.iter().map(|(k, _)| k.clone()).collect();
    Ok(serde_json::json!({
        "written": written,
        "skipped": skipped
            .into_iter()
            .map(|(k, r)| serde_json::json!({ "key": k, "reason": r }))
            .collect::<Vec<_>>(),
        "envFile": env_file.display().to_string(),
        "count": entries.len(),
    }))
}

// ── bootstrap ────────────────────────────────────────────

fn emit_progress<R: Runtime>(app: &AppHandle<R>, payload: serde_json::Value) {
    let _ = app.emit("bootstrap-progress", &payload);
}

/// dist 平台标识（与 nodejs.org 命名一致）
fn dist_platform() -> Result<&'static str, String> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("macos", "aarch64") => Ok("darwin-arm64"),
        ("macos", "x86_64") => Ok("darwin-x64"),
        ("windows", "x86_64") => Ok("win-x64"),
        (os, arch) => Err(format!("暂不支持的 platforms: {os}/{arch}")),
    }
}

/// 是否本机地址（127.0.0.1 / localhost / [::1]）。手写解析即可，不引 URL 依赖。
fn is_loopback_url(url: &str) -> bool {
    let rest = url.split("://").nth(1).unwrap_or("");
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    let hostport = authority.rsplit('@').next().unwrap_or(authority); // 去 userinfo
    let host = if let Some(rest6) = hostport.strip_prefix('[') {
        rest6.split(']').next().unwrap_or("") // IPv6 带方括号
    } else {
        hostport.split(':').next().unwrap_or("")
    };
    matches!(host, "127.0.0.1" | "localhost" | "::1")
}

/// 统一的阻塞 HTTP 客户端。
///
/// **loopback 一律直连**（`.no_proxy()`）：本机开着系统 HTTP 代理时（本机实测
/// `scutil --proxy` → 127.0.0.1:7897），代理会把 loopback 也代理出去——代理自身
/// 超时/拒连就变成 `502 Bad Gateway`，或把请求行改成"绝对形式"打乱路由匹配，
/// 让下载（本机镜像 / e2e mock）偶发失败。本机地址不走代理本身也是正确语义。
/// 其余地址保持默认（含系统代理），真实镜像/网关照旧走代理。
fn http_client(url: &str, timeout_secs: u64) -> Result<reqwest::blocking::Client, String> {
    crate::ensure_tls_provider();
    let mut builder = reqwest::blocking::Client::builder().timeout(Duration::from_secs(timeout_secs));
    if is_loopback_url(url) {
        builder = builder.no_proxy();
    }
    builder
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))
}

fn version_for_major(major: u8) -> Result<&'static str, String> {
    NODE_CHOICES
        .iter()
        .find(|(m, _)| *m == major)
        .map(|(_, v)| *v)
        .ok_or_else(|| format!("不支持的 Node 版本: {major}（可选 {}）",
            NODE_CHOICES.iter().map(|(m, _)| m.to_string()).collect::<Vec<_>>().join("/")))
}

/// 清理引导残留（半截下载/解压）
fn cleanup_partials(home: &Path) {
    let cache = home.join("cache");
    if let Ok(entries) = std::fs::read_dir(&cache) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".part") {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    let root = home.join("runtimes").join("node");
    if let Ok(entries) = std::fs::read_dir(&root) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(".partial") {
                let _ = std::fs::remove_dir_all(e.path());
            }
        }
    }
}

/// 引导状态快照（文件系统 + 一次系统 node 探测；向导每次刷新调用）
pub fn bootstrap_status_impl(home: &Path) -> serde_json::Value {
    cleanup_partials(home);

    let onboarding_done = home.join("onboarding-done.json").exists();

    let (sys_found, mut sys) = match probe_system_node() {
        Ok(part) => (true, serde_json::json!({
            "found": true, "usable": true, "version": part.version,
        })),
        Err(reason) => (
            reason.contains("过旧") || reason.contains("无法执行") || reason.contains("缺少 npm"),
            serde_json::json!({ "found": false, "usable": false, "reason": reason }),
        ),
    };
    if let Some(obj) = sys.as_object_mut() {
        obj.insert("probed".into(), serde_json::json!(sys_found));
    }

    // node 就绪判定必须与 resolve_node 同源：toolchain.json 声明 system 且现在可用 = 已就绪，
    // 否则采用系统 Node 的用户重启后 installed 仍为 false，会被重复弹回向导。
    // source 字段供向导「改选」UI 显示当前来源（system / managed）。
    let system_declared = matches!(read_toolchain_json(home), Some((ref source, _)) if source == "system");
    let system_usable = sys.get("usable").and_then(|v| v.as_bool()).unwrap_or(false);
    let node_installed = if system_declared {
        if system_usable {
            Some(serde_json::json!({
                "installed": true,
                "version": sys.get("version").cloned().unwrap_or(serde_json::Value::Null),
                "source": "system",
            }))
        } else {
            None
        }
    } else {
        pick_managed(home).map(|p| {
            let pnpm = tools_bin_dir(home).join(if cfg!(target_os = "windows") { "pnpm.cmd" } else { "pnpm" });
            serde_json::json!({
                "installed": true, "version": p.version, "pnpm": pnpm.exists(), "source": "managed",
            })
        })
    };

    let node_choices: Vec<serde_json::Value> = NODE_CHOICES
        .iter()
        .map(|(major, ver)| serde_json::json!({ "major": major, "version": ver }))
        .collect();

    let bridge_root = bridge_root(home);
    let bridge_cli = bridge_root.join("dist").join("cli").join("index.js");
    let bridge_version = std::fs::read_to_string(bridge_root.join("package.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| v.get("version").and_then(|x| x.as_str()).map(|s| s.to_string()));
    let bridge_satisfies = bridge_version
        .as_deref()
        .map(|v| super::compare_versions(v, MIN_BRIDGE_VERSION) != std::cmp::Ordering::Less)
        .unwrap_or(false);

    let dsh_root = home.join("runtimes").join("dsh");
    let dsh_versions: Vec<String> = std::fs::read_dir(dsh_root)
        .map(|entries| {
            entries
                .flatten()
                .filter(|e| e.path().is_dir())
                .map(|e| e.file_name().to_string_lossy().to_string())
                .collect()
        })
        .unwrap_or_default();

    let dsh_global = probe_global_dsh();

    serde_json::json!({
        "onboardingDone": onboarding_done,
        "systemNode": sys,
        "node": node_installed.unwrap_or(serde_json::json!({ "installed": false })),
        "nodeChoices": node_choices,
        "bridge": {
            "installed": bridge_cli.exists(),
            "version": bridge_version,
            "min": MIN_BRIDGE_VERSION,
            "satisfies": bridge_satisfies,
        },
        "dshInstalled": !dsh_versions.is_empty(),
        "dshVersions": dsh_versions,
        "dshGlobal": {
            "found": dsh_global.is_some(),
            "version": dsh_global,
        },
    })
}

/// 探测并采用系统 Node（向导「直接使用系统 Node」按钮）
pub fn system_node_probe_impl(home: &Path) -> Result<String, String> {
    let part = probe_system_node()?;
    write_toolchain_json(home, NodeSource::System, &part.version)?;
    Ok(format!("已采用系统 Node {}", part.version))
}

/// 流式下载（带节流进度）。返回落盘文件。
fn download_with_progress<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
    dest: &Path,
    step: &str,
) -> Result<(), String> {
    let client = http_client(url, 600)?;
    let mut resp = client
        .get(url)
        .timeout(Duration::from_secs(600))
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("下载失败: {e}"))?;
    let total = resp.content_length().unwrap_or(0);
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let mut file = std::fs::File::create(dest).map_err(|e| format!("创建缓存文件失败: {e}"))?;
    use std::io::Read as _;
    let mut buf = [0u8; 64 * 1024];
    let mut received: u64 = 0;
    let mut last_emit = Instant::now() - Duration::from_millis(500);
    loop {
        let n = resp
            .read(&mut buf)
            .map_err(|e| format!("下载中断: {e}"))?;
        if n == 0 {
            break;
        }
        use std::io::Write as _;
        file.write_all(&buf[..n]).map_err(|e| format!("写入缓存失败: {e}"))?;
        received += n as u64;
        if last_emit.elapsed() >= Duration::from_millis(100) {
            last_emit = Instant::now();
            emit_progress(app, serde_json::json!({
                "step": step, "phase": "download", "received": received,
                "total": if total > 0 { serde_json::json!(total) } else { serde_json::Value::Null },
            }));
        }
    }
    emit_progress(app, serde_json::json!({
        "step": step, "phase": "download", "received": received,
        "total": if total > 0 { serde_json::json!(total) } else { serde_json::Value::Null },
    }));
    Ok(())
}

fn sha256_hex(path: &Path) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut hasher = Sha256::new();
    std::io::copy(&mut file, &mut hasher).map_err(|e| e.to_string())?;
    Ok(format!("{:x}", hasher.finalize()))
}

/// 从镜像同路径的 SHASUMS256.txt 校验产物（fail-closed）。
/// 清单按官方产物名（如 node-vX-darwin-arm64.tar.gz）记录；下载落盘是 `<官方名>.part`，
/// 查名前必须剥掉后缀，否则永远 miss。
fn verify_shasums(archive: &Path, shasums_text: &str) -> Result<(), String> {
    let want = sha256_hex(archive)?;
    let raw = archive.file_name().unwrap_or_default().to_string_lossy().to_string();
    let name = raw.strip_suffix(".part").unwrap_or(&raw);
    for line in shasums_text.lines() {
        let mut parts = line.split_whitespace();
        let (Some(sum), Some(file)) = (parts.next(), parts.next()) else {
            continue;
        };
        if file == name {
            if sum.eq_ignore_ascii_case(&want) {
                return Ok(());
            }
            return Err(format!("校验失败：{name} 与官方 SHASUMS256.txt 不符（下载损坏或被篡改），请重试"));
        }
    }
    Err(format!("SHASUMS256.txt 中没有 {name} 的记录"))
}

/// 解压 Node 发行版（tar.gz 剥一层目录；win zip 同样剥首层）
fn extract_node_archive(archive: &Path, dest: &Path) -> Result<(), String> {
    std::fs::create_dir_all(dest).map_err(|e| e.to_string())?;
    if cfg!(target_os = "windows") {
        let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("zip 打开失败: {e}"))?;
        for i in 0..zip.len() {
            let mut entry = zip.by_index(i).map_err(|e| format!("zip 读取失败: {e}"))?;
            let rel: PathBuf = entry
                .enclosed_name()
                .ok_or_else(|| "zip 内含非法路径".to_string())?
                .iter()
                .skip(1)
                .collect();
            if rel.as_os_str().is_empty() {
                continue;
            }
            let out = dest.join(&rel);
            if entry.is_dir() {
                std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
            } else {
                if let Some(p) = out.parent() {
                    std::fs::create_dir_all(p).map_err(|e| e.to_string())?;
                }
                let mut out_file = std::fs::File::create(&out).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut out_file).map_err(|e| format!("zip 解压失败: {e}"))?;
                #[cfg(unix)]
                {
                    use std::os::unix::fs::PermissionsExt;
                    if entry.unix_mode().map(|m| m & 0o111 != 0).unwrap_or(false) {
                        let _ = std::fs::set_permissions(&out, std::fs::Permissions::from_mode(0o755));
                    }
                }
            }
        }
        return Ok(());
    }
    let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
    let gz = flate2::read::GzDecoder::new(file);
    let mut tar = tar::Archive::new(gz);
    for entry in tar.entries().map_err(|e| format!("tar 读取失败: {e}"))? {
        let mut entry = entry.map_err(|e| format!("tar 遍历失败: {e}"))?;
        let rel: PathBuf = match entry.path() {
            Ok(p) => p.iter().skip(1).collect(),
            Err(e) => return Err(format!("tar 路径解析失败: {e}")),
        };
        if rel.as_os_str().is_empty() {
            continue;
        }
        let out = dest.join(rel);
        // 目录条目缺失的 tar 也能解：按需建父目录（与上面 zip 分支对齐）
        if let Some(p) = out.parent() {
            std::fs::create_dir_all(p).map_err(|e| format!("创建目录失败: {e}"))?;
        }
        entry.unpack(&out).map_err(|e| format!("tar 解压失败: {e}"))?;
    }
    // 确保可执行位（tar 权限语义在不同实现间有差异，node 必须可执行）
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let (node_rel, npm_rel) = node_rel_paths();
        for rel in [node_rel, "bin/npm", "bin/npx", npm_rel] {
            let p = dest.join(rel);
            if p.exists() {
                let _ = std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755));
            }
        }
    }
    Ok(())
}

/// 安装受管 Node（major ∈ NODE_CHOICES）。已装则幂等返回。
pub fn node_install_impl<R: Runtime>(app: &AppHandle<R>, home: &Path, major: u8) -> Result<String, String> {
    node_install_impl_with(app, home, major, NODE_MIRROR)
}

/// 同上，镜像可注入（集成测试指向本地 mock 镜像；生产壳传 NODE_MIRROR）。
pub fn node_install_impl_with<R: Runtime>(
    app: &AppHandle<R>,
    home: &Path,
    major: u8,
    mirror: &str,
) -> Result<String, String> {
    let version = version_for_major(major)?;
    let platform = dist_platform()?;
    let final_dir = node_dir(home, version);
    if managed_node_part(final_dir.clone()).is_some() {
        write_toolchain_json(home, NodeSource::Managed, version)?;
        return Ok(format!("Node {version} 已就绪"));
    }

    let ext = if cfg!(target_os = "windows") { "zip" } else { "tar.gz" };
    let filename = format!("node-{version}-{platform}.{ext}");
    let url = format!("{mirror}/{version}/{filename}");
    let archive = home.join("cache").join(format!("{filename}.part"));

    let step = "node";
    emit_progress(app, serde_json::json!({ "step": step, "phase": "download", "received": 0, "total": serde_json::Value::Null }));
    download_with_progress(app, &url, &archive, step)?;

    emit_progress(app, serde_json::json!({ "step": step, "phase": "verify" }));
    let shasums_url = format!("{mirror}/{version}/SHASUMS256.txt");
    let shasums = http_client(&shasums_url, 60)?
        .get(&shasums_url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.text())
        .map_err(|e| format!("下载 SHASUMS256.txt 失败: {e}"))?;
    verify_shasums(&archive, &shasums)?;

    emit_progress(app, serde_json::json!({ "step": step, "phase": "extract" }));
    let partial = home.join("runtimes").join("node").join(format!("{version}.partial"));
    let _ = std::fs::remove_dir_all(&partial);
    let extract = extract_node_archive(&archive, &partial);
    let _ = std::fs::remove_file(&archive);
    extract?;

    if managed_node_part(partial.clone()).is_none() {
        let _ = std::fs::remove_dir_all(&partial);
        return Err("解压完成但 Node 发行版不完整（缺 node 或 npm）".to_string());
    }
    if final_dir.exists() {
        std::fs::remove_dir_all(&final_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(final_dir.parent().ok_or("路径错误")?).map_err(|e| e.to_string())?;
    std::fs::rename(&partial, &final_dir).map_err(|e| format!("就位失败: {e}"))?;
    write_toolchain_json(home, NodeSource::Managed, version)?;
    emit_progress(app, serde_json::json!({ "step": step, "phase": "done" }));
    Ok(format!("已安装 Node {version}"))
}

/// 装受管 pnpm 到 runtimes/tools（幂等；pnpm shim 统一落 node_modules/.bin，
/// 系统/受管 node 一视同仁，绝不写用户的全局目录）。
pub fn tools_install_impl<R: Runtime>(app: &AppHandle<R>, home: &Path, node: &NodePart) -> Result<String, String> {
    let pnpm = tools_bin_dir(home).join(if cfg!(target_os = "windows") { "pnpm.cmd" } else { "pnpm" });
    if pnpm.exists() {
        return Ok("pnpm 已就绪".to_string());
    }
    let tools = tools_dir(home);
    std::fs::create_dir_all(&tools).map_err(|e| e.to_string())?;
    let manifest = tools.join("package.json");
    if !manifest.exists() {
        std::fs::write(&manifest, "{\"name\":\"dsh-pocket-tools\",\"private\":true}\n")
            .map_err(|e| e.to_string())?;
    }
    let step = "tools";
    emit_progress(app, serde_json::json!({ "step": step, "phase": "npm" }));
    let out = run_npm_with_node(
        node,
        home,
        ["install", PNPM_SPEC, "--no-fund", "--no-audit", "--loglevel=error"],
        Some(&tools),
        Some(NPM_REGISTRY),
        300,
        Some(&|line| {
            emit_progress(app, serde_json::json!({ "step": step, "phase": "npm", "line": line }))
        }),
    )?;
    if !pnpm.exists() {
        return Err(format!("pnpm 安装后未找到可执行：{}", out.output));
    }
    emit_progress(app, serde_json::json!({ "step": step, "phase": "done" }));
    Ok("已安装 pnpm".to_string())
}

/// 安装 bridge（dshc）到 runtimes/bridge（幂等；已满足 MIN 版本则跳过，
/// `force=true` 时无视版本短路强制重装 @latest —— 引导页「更新 dshc」用）。
pub fn bridge_install_impl<R: Runtime>(
    app: &AppHandle<R>,
    home: &Path,
    node: &NodePart,
    force: bool,
) -> Result<String, String> {
    // 已装且满足最低版本：跳过（引导重入时不重复下载）
    if !force {
        if let Ok((_, _, version)) = resolve_bridge(home) {
            if !version.is_empty()
                && super::compare_versions(&version, MIN_BRIDGE_VERSION) != std::cmp::Ordering::Less
            {
                return Ok(format!("Worker 核心 {version} 已就绪"));
            }
        }
    }
    let dir = home.join("runtimes").join("bridge");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let manifest = dir.join("package.json");
    if !manifest.exists() {
        std::fs::write(&manifest, "{\"name\":\"dsh-pocket-bridge-host\",\"private\":true}\n")
            .map_err(|e| e.to_string())?;
    }
    let step = "bridge";
    emit_progress(app, serde_json::json!({ "step": step, "phase": "npm" }));
    let out = run_npm_with_node(
        node,
        home,
        [
            "install",
            &format!("{BRIDGE_PACKAGE}@latest"),
            "--prefer-online",
            "--no-fund",
            "--no-audit",
            "--loglevel=error",
        ],
        Some(&dir),
        Some(NPM_REGISTRY),
        900,
        Some(&|line| {
            emit_progress(app, serde_json::json!({ "step": step, "phase": "npm", "line": line }))
        }),
    )?;
    let (_, _, version) = resolve_bridge(home)
        .map_err(|_| format!("bridge 安装后未找到可执行：{}", out.output))?;
    if super::compare_versions(&version, MIN_BRIDGE_VERSION) == std::cmp::Ordering::Less {
        return Err(format!(
            "npm 镜像上的 bridge 版本（{version}）落后于本应用要求（≥ {MIN_BRIDGE_VERSION}），\
             通常是镜像同步延迟，请稍后点「重试」"
        ));
    }
    emit_progress(app, serde_json::json!({ "step": step, "phase": "done" }));
    Ok(format!("已安装 Worker 核心 {version}"))
}

/// 用指定 NodePart 跑 npm 的结果。
/// `stdout` 是干净的 stdout（`npm view --json` 解析用）；`output` 合并了两个流（报错文案用）。
pub struct NpmOutcome {
    pub success: bool,
    pub stdout: String,
    pub output: String,
}

/// 用指定 NodePart 跑 npm（bootstrap 阶段 bridge 尚未就位，不能走 run_dshc 链路）。
/// stdout/stderr 逐行回调（进度用）+ 累积输出；超时杀进程。
pub fn run_npm_with_node(
    node: &NodePart,
    home: &Path,
    args: impl IntoIterator<Item = impl AsRef<str>>,
    cwd: Option<&Path>,
    registry: Option<&str>,
    timeout_secs: u64,
    on_line: Option<&dyn Fn(&str)>,
) -> Result<NpmOutcome, String> {
    let path_env = path_env(home, &node.node_bin_dir)?;
    let mut cmd = Command::new(&node.node);
    super::no_window(&mut cmd);
    cmd.arg(&node.npm_cli);
    for a in args {
        cmd.arg(a.as_ref());
    }
    if let Some(reg) = registry.filter(|r| !r.is_empty()) {
        cmd.arg("--registry").arg(reg);
    }
    cmd.env("PATH", path_env);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| format!("启动 npm 失败: {e}"))?;
    let deadline = Instant::now() + Duration::from_secs(timeout_secs);

    // 两个管道各自逐行读：stdout/stderr 分开归档（解析用）+ 喂给主循环的回调队列
    let collected_out = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let collected_err = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let feed = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let mut readers: Vec<std::thread::JoinHandle<()>> = Vec::new();
    if let Some(s) = child.stdout.take() {
        readers.push(spawn_line_reader(s, std::sync::Arc::clone(&collected_out), std::sync::Arc::clone(&feed)));
    }
    if let Some(s) = child.stderr.take() {
        readers.push(spawn_line_reader(s, std::sync::Arc::clone(&collected_err), std::sync::Arc::clone(&feed)));
    }

    // 主循环：等退出 + 把新行回给调用方回调（回调借用不跨线程）
    let drain_feed = |feed: &std::sync::Mutex<Vec<String>>| {
        let new: Vec<String> = feed.lock().map(|mut g| std::mem::take(&mut *g)).unwrap_or_default();
        if let Some(cb) = on_line {
            for line in new {
                cb(line.trim());
            }
        }
    };
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) => {
                drain_feed(&feed);
                if Instant::now() > deadline {
                    let _ = child.kill();
                    return Err(format!("npm 超时（{timeout_secs} 秒）"));
                }
                std::thread::sleep(Duration::from_millis(200));
            }
            Err(e) => return Err(format!("等待 npm 失败: {e}")),
        }
    }
    for h in readers {
        let _ = h.join();
    }
    drain_feed(&feed);
    let status = child.wait().map_err(|e| format!("读取 npm 状态失败: {e}"))?;
    // stdout 单独留一份（npm view --json 等机器可读输出混入 stderr 行会炸解析）
    let stdout = collected_out.lock().map(|g| g.join("\n")).unwrap_or_default();
    let mut merged = collected_out.lock().map(|g| g.clone()).unwrap_or_default();
    if let Ok(err_lines) = collected_err.lock() {
        merged.extend(err_lines.iter().cloned());
    }
    let output = merged.join("\n");
    Ok(NpmOutcome { success: status.success(), stdout, output })
}

/// 逐行读管道：原始行归档到 collected + 喂 feed（主循环转回调）
fn spawn_line_reader<R: std::io::Read + Send + 'static>(
    mut stream: R,
    collected: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
    feed: std::sync::Arc<std::sync::Mutex<Vec<String>>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut buf = [0u8; 4096];
        let mut pending = String::new();
        loop {
            match stream.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    pending.push_str(&String::from_utf8_lossy(&buf[..n]));
                    while let Some(pos) = pending.find('\n') {
                        let line: String = pending.drain(..=pos).collect();
                        let line = line.trim_end().to_string();
                        if line.is_empty() {
                            continue;
                        }
                        if let Ok(mut g) = collected.lock() {
                            g.push(line.clone());
                        }
                        if let Ok(mut g) = feed.lock() {
                            g.push(line);
                        }
                    }
                }
            }
        }
        let tail = pending.trim().to_string();
        if !tail.is_empty() {
            if let Ok(mut g) = collected.lock() {
                g.push(tail.clone());
            }
            if let Ok(mut g) = feed.lock() {
                g.push(tail);
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loopback_url_detection_covers_forms_we_use() {
        // 测试用的 mock mirror 与本机镜像都长这样 → 必须直连、不走系统代理
        assert!(is_loopback_url("http://127.0.0.1:5555/v24.21.0/x.tar.gz"));
        assert!(is_loopback_url("http://localhost:8080/mirror"));
        assert!(is_loopback_url("http://[::1]:8080/x"));
        assert!(is_loopback_url("http://user:pw@127.0.0.1:8080/x"));
        // 真实镜像要走系统代理（不返回 true）
        assert!(!is_loopback_url("https://registry.npmmirror.com/x"));
        assert!(!is_loopback_url("http://127.0.0.1.evil.com/x"));
        assert!(!is_loopback_url(""));
    }

    #[test]
    fn parse_marked_env_survives_rc_noise_and_drops_function_exports() {
        // 用户 rc 往 stdout 喷噪声是常态（p10k instant prompt / conda init 的 echo…）：
        // 本机实测一次解析的 stdout 共 2350 字节、其中真内容才 ~600 字节。
        let raw = "welcome back!\n\
__DSH_POCKET_PATH_BEGIN__\n\
PATH=/usr/bin:/bin\n\
HOME=/Users/you\n\
BASH_FUNC_foo%%=() {  echo hi; }\n\
NOT_A_KEY-no_eq\n\
=novalue\n\
__DSH_POCKET_PATH_END__\n\
trailing noise";
        let env = parse_marked_env(raw);
        // 标记之外的内容一律不要
        assert_eq!(
            env,
            vec![
                ("PATH".to_string(), "/usr/bin:/bin".to_string()),
                ("HOME".to_string(), "/Users/you".to_string()),
            ]
        );
        // 导出的 shell 函数必须丢弃：带上会让每次子 bash 执行函数体
        assert!(!env.iter().any(|(k, _)| k.starts_with("BASH_FUNC_")));

        // 值里含 `=` 时按第一个 `=` 切分
        let with_eq = "__DSH_POCKET_PATH_BEGIN__\nFOO=a=b=c\n__DSH_POCKET_PATH_END__";
        assert_eq!(parse_marked_env(with_eq), vec![("FOO".to_string(), "a=b=c".to_string())]);

        // 重复键后者胜（env 输出里不应出现，但别崩/别给出含糊结果）
        let dup = "__DSH_POCKET_PATH_BEGIN__\nK=1\nK=2\n__DSH_POCKET_PATH_END__";
        assert_eq!(parse_marked_env(dup), vec![("K".to_string(), "2".to_string())]);

        // 取不到标记 → 空，而不是半截内容
        assert!(parse_marked_env("").is_empty());
        assert!(parse_marked_env("no markers here").is_empty());
        assert!(parse_marked_env("__DSH_POCKET_PATH_BEGIN__").is_empty(), "缺 END");
    }

    #[test]
    fn plan_env_import_skips_what_cannot_be_written_and_counts_honestly() {
        let env: Vec<(String, String)> = vec![
            ("ANDROID_HOME".into(), "/Users/x/Library/Android/sdk".into()),
            ("GIT_PAGER".into(), "delta".into()),      // 上游禁令 → 跳过
            ("PWD".into(), "/Users/x/project".into()), // 会话现场 → 跳过
            ("WEIRD".into(), "line1\nline2".into()),   // 值含换行 → 跳过
            ("DUP".into(), "v".into()),
        ];
        let keys: Vec<String> = vec![
            "ANDROID_HOME".into(),
            "GIT_PAGER".into(),
            "PWD".into(),
            "WEIRD".into(),
            "MISSING".into(), // 环境里没有 → 跳过
            "DUP".into(),
            "DUP".into(), // 重复 → 只写一次
        ];
        let (entries, skipped) = plan_env_import(&env, &keys);

        // 真正写入的只有两项，且值随行走
        assert_eq!(
            entries,
            vec![
                ("ANDROID_HOME".to_string(), "/Users/x/Library/Android/sdk".to_string()),
                ("DUP".to_string(), "v".to_string()),
            ]
        );
        // 每个被跳过的键都要有原因（界面要能解释"为什么少了"）
        assert_eq!(skipped.len(), 4, "GIT_PAGER/PWD/WEIRD/MISSING 都该被跳过");
        assert!(skipped.iter().any(|(k, r)| k == "GIT_PAGER" && r.contains("上游禁止")));
        assert!(skipped.iter().any(|(k, r)| k == "PWD" && r.contains("现场")));
        assert!(skipped.iter().any(|(k, r)| k == "WEIRD" && r.contains("换行")));
        assert!(skipped.iter().any(|(k, r)| k == "MISSING" && r.contains("没有这个变量")));
        // 计数一致性：count == 实际写入数，而不是"用户勾选数"
        assert_eq!(entries.len(), 2);
    }

    #[test]
    fn merge_paths_keeps_order_and_drops_duplicates() {
        let merged = merge_paths(
            std::ffi::OsStr::new("/shell/a:/shell/b"),
            std::ffi::OsStr::new("/shell/b:/usr/bin"),
        );
        let segs: Vec<String> = std::env::split_paths(&merged)
            .map(|p| p.display().to_string())
            .collect();
        // 登录 shell 的段在前、继承里的重复段丢掉、顺序保持
        assert_eq!(segs, vec!["/shell/a", "/shell/b", "/usr/bin"]);

        // PATH 里的空段（"::"）必须丢掉：它会变成"当前目录"，属安全隐患
        let merged2 = merge_paths(std::ffi::OsStr::new("/x::/y"), std::ffi::OsStr::new(""));
        let segs2: Vec<String> = std::env::split_paths(&merged2)
            .map(|p| p.display().to_string())
            .collect();
        assert_eq!(segs2, vec!["/x", "/y"]);
    }

    #[test]
    fn parse_env_keys_is_lenient_but_never_returns_values() {
        let content = "\
# 注释行
export FOO=bar
BAZ=\"quoted value\"
EMPTY=
  INDENTED = spaced
DUP=1
DUP=2
NOT_A_KEY-here=1
";
        let keys = parse_env_keys(content);
        // 只回键名（诊断要能外发）；重复项去重；非法名忽略
        assert_eq!(keys, vec!["FOO", "BAZ", "EMPTY", "INDENTED", "DUP"]);
        assert!(!keys.iter().any(|k| k.contains("bar") || k.contains("quoted")));
        assert!(parse_env_keys("").is_empty());
        assert!(parse_env_keys("# only comments\n\n").is_empty());
    }

    #[test]
    fn home_layer_env_rules_match_upstream() {
        // 上游 readEnvLayer：这些名字出现在任何 .env 里都会**拒绝启动**
        assert!(env_name_refused_in_home_layer("PATH"));
        assert!(env_name_refused_in_home_layer("path"), "大小写不敏感");
        assert!(env_name_refused_in_home_layer("HOME"));
        assert!(env_name_refused_in_home_layer("SHELL"));
        assert!(env_name_refused_in_home_layer("NODE_OPTIONS"));
        assert!(env_name_refused_in_home_layer("DEEPSEEK_BASE_URL"));
        // 前缀类
        assert!(env_name_refused_in_home_layer("DSH_HOME"));
        assert!(env_name_refused_in_home_layer("XDG_CONFIG_HOME"));
        assert!(env_name_refused_in_home_layer("DYLD_INSERT_LIBRARIES"));
        // CA/TLS 类：代理名有例外，这些**没有**（"改变的是信任什么"）
        assert!(env_name_refused_in_home_layer("SSL_CERT_FILE"));
        assert!(env_name_refused_in_home_layer("NODE_TLS_REJECT_UNAUTHORIZED"));
        assert!(env_name_refused_in_home_layer("CURL_CA_BUNDLE"));
        // 代理名在"用户自己那层"是**允许**的——这正是我们想让用户用的通道
        assert!(!env_name_refused_in_home_layer("HTTPS_PROXY"));
        assert!(!env_name_refused_in_home_layer("https_proxy"));
        assert!(!env_name_refused_in_home_layer("NO_PROXY"));
        // 普通变量不受限
        assert!(!env_name_refused_in_home_layer("ANTHROPIC_API_KEY"));
        assert!(!env_name_refused_in_home_layer("MY_TOOL_HOME"));
    }

    #[test]
    fn inspect_env_file_flags_refused_and_shadowed() {
        let dir = std::env::temp_dir().join(format!("dsh-pocket-env-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(
            dir.join(".env"),
            "# 用户自己写的\nHTTPS_PROXY=http://127.0.0.1:7897\nANTHROPIC_API_KEY=sk-secret\nPATH=/evil\nTMPDIR=/tmp/x\n",
        )
        .unwrap();
        // 模拟 launcher 继承到的键（含 TMPDIR）
        let inherited = vec!["TMPDIR".to_string(), "PATH".to_string()];
        let r = inspect_env_file_at(&dir, None, &inherited);
        let arr = |k: &str| -> Vec<String> {
            r[k].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect()
        };
        assert_eq!(arr("refusedKeys"), vec!["PATH"], "PATH 会让 dsh 拒绝启动，必须点名");
        assert_eq!(arr("shadowedKeys"), vec!["TMPDIR"], "继承层已有的键写了不会生效");
        assert_eq!(arr("envKeys"), vec!["HTTPS_PROXY", "ANTHROPIC_API_KEY", "PATH", "TMPDIR"]);
        // 代理名在 home 层是允许的 → 不能误报
        assert!(!arr("refusedKeys").contains(&"HTTPS_PROXY".to_string()));
        // **值绝不出现在报告里**（报告会进导出诊断）
        let dumped = r.to_string();
        assert!(!dumped.contains("7897") && !dumped.contains("sk-secret"), "报告里混进了值: {dumped}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn env_grouping_and_rules_cover_the_toolchains_users_care_about() {
        assert_eq!(env_group_of("ANDROID_HOME"), "移动开发");
        assert_eq!(env_group_of("FLUTTER_STORAGE_BASE_URL"), "移动开发");
        assert_eq!(env_group_of("DEVECO_SDK_HOME"), "移动开发");
        assert_eq!(env_group_of("JAVA_HOME"), "移动开发");
        assert_eq!(env_group_of("NVM_DIR"), "语言运行时");
        assert_eq!(env_group_of("PNPM_HOME"), "语言运行时");
        assert_eq!(env_group_of("HOMEBREW_PREFIX"), "包管理与镜像");
        assert_eq!(env_group_of("https_proxy"), "网络与代理");
        assert_eq!(env_group_of("CLION_VM_OPTIONS"), "IDE 与 JVM");
        assert_eq!(env_group_of("PWD"), "shell 现场");
        assert_eq!(env_group_of("MY_OWN_THING"), "其他");

        // 回归：`HOMEBREW_*` 不能被 `HOME` 前缀误判成"禁令名"（我第一版过滤脚本就错过）；
        // 产品代码是"精确名 + 四个前缀"（DSH_/XDG_/DYLD_/BASH_FUNC_），不会犯这个错。
        assert!(!env_name_refused_in_home_layer("HOMEBREW_PREFIX"));
        assert!(!env_name_refused_in_home_layer("HOMEBREW_BREW_GIT_REMOTE"));
        assert!(!env_name_refused_in_home_layer("RUBYMINE_VM_OPTIONS"));
        assert!(!env_name_refused_in_home_layer("ANDROID_HOME"));
        assert!(!env_name_refused_in_home_layer("HTTPS_PROXY"), "代理名在 home 层允许");
        // 真正的禁令名照旧
        assert!(env_name_refused_in_home_layer("GIT_PAGER"));
        assert!(env_name_refused_in_home_layer("PAGER"));
        assert!(env_name_refused_in_home_layer("PATH"));
        assert!(env_name_refused_in_home_layer("BASH_FUNC_x%%"));
    }

    #[test]
    fn sensitive_and_shell_scene_classification() {
        assert!(env_is_sensitive("OPENAI_API_KEY"));
        assert!(env_is_sensitive("MY_TOKEN"));
        assert!(env_is_sensitive("AWS_SECRET_ACCESS_KEY"));
        assert!(env_is_sensitive("GITHUB_TOKEN"));
        assert!(!env_is_sensitive("ANDROID_HOME"));
        assert!(!env_is_sensitive("JAVA_HOME"), "JAVA_HOME 不是密钥");
        assert!(!env_is_sensitive("FLUTTER_STORAGE_BASE_URL"));

        assert!(env_is_shell_scene("_"));
        assert!(env_is_shell_scene("PWD"));
        assert!(env_is_shell_scene("OLDPWD"));
        assert!(env_is_shell_scene("SHLVL"));
        assert!(env_is_shell_scene("TERM"));
        assert!(env_is_shell_scene("SSH_AUTH_SOCK"));
        assert!(env_is_shell_scene("XPC_FLAGS"));
        assert!(!env_is_shell_scene("ANDROID_HOME"));
    }

    #[test]
    fn format_env_line_quotes_only_when_needed() {
        assert_eq!(format_env_line("FOO", "/a/b"), Some("FOO=/a/b".to_string()));
        assert_eq!(format_env_line("FOO", "/a b"), Some("FOO=\"/a b\"".to_string()));
        assert_eq!(format_env_line("FOO", "a#b"), Some("FOO=\"a#b\"".to_string()));
        assert_eq!(format_env_line("FOO", "say \"hi\""), Some("FOO=\"say \\\"hi\\\"\"".to_string()));
        assert_eq!(format_env_line("FOO", ""), Some("FOO=\"\"".to_string()));
        // 含换行的值无法在 dotenv 里可靠表示 → 明确返回 None（调用方计入 skipped）
        assert_eq!(format_env_line("FOO", "a\nb"), None);
    }

    #[test]
    fn managed_block_replaces_old_block_and_keeps_user_lines() {
        let dir = std::env::temp_dir().join(format!("dsh-pocket-envblk-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join(".env");
        // 用户自己写的行 + 一份过期的受管块
        std::fs::write(
            &f,
            "MY_OWN=1\n# >>> DSH Pocket 导入的终端环境\nOLD_KEY=old\n# <<< DSH Pocket\nLAST=2\n",
        )
        .unwrap();

        write_managed_block(
            &f,
            &[
                ("ANDROID_HOME".to_string(), "/Users/x/Library/Android/sdk".to_string()),
                ("FLUTTER_X".to_string(), "/a b/c".to_string()),
            ],
        )
        .unwrap();

        let text = std::fs::read_to_string(&f).unwrap();
        assert!(text.contains("MY_OWN=1"), "用户手写的行必须保留");
        assert!(text.contains("LAST=2"), "块之后的行也必须保留");
        assert!(!text.contains("OLD_KEY"), "旧受管块必须被替换掉");
        assert!(text.contains("ANDROID_HOME=/Users/x/Library/Android/sdk"));
        assert!(text.contains("FLUTTER_X=\"/a b/c\""), "含空格的值要加引号");
        assert_eq!(text.matches("# >>> DSH Pocket").count(), 1, "不能出现两个受管块");
        assert_eq!(managed_block_keys(&f), vec!["ANDROID_HOME", "FLUTTER_X"]);

        // 幂等：再写一次不应堆积
        write_managed_block(&f, &[("FOO".to_string(), "bar".to_string())]).unwrap();
        let text2 = std::fs::read_to_string(&f).unwrap();
        assert_eq!(text2.matches("# >>> DSH Pocket").count(), 1);
        assert!(text2.contains("MY_OWN=1") && text2.contains("LAST=2"));
        assert_eq!(managed_block_keys(&f), vec!["FOO"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn scan_report_lists_keys_never_values_and_marks_what_cannot_be_imported() {
        let dir = std::env::temp_dir().join(format!("dsh-pocket-scan-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let entries: Vec<(String, String)> = vec![
            ("ANDROID_HOME".into(), "/Users/x/Library/Android/sdk".into()),
            ("JAVA_HOME".into(), "/Library/Java/JavaVirtualMachines/x".into()),
            ("GIT_PAGER".into(), "delta".into()),          // 禁令名 → 不可导入
            ("PWD".into(), "/Users/x/project".into()),     // 会话现场 → 不默认勾
            ("OPENAI_API_KEY".into(), "sk-LEAK-ME".into()), // 敏感 → 默认不勾
            ("TMPDIR".into(), "/var/folders/xyz".into()),  // 继承层已有 → 写了无效
            ("HOMEBREW_PREFIX".into(), "/opt/homebrew".into()), // 不能误判成禁令
        ];
        let inherited = vec!["TMPDIR".to_string()];
        let r = scan_env_entries(Some(&entries), &dir, &["JAVA_HOME".to_string()], &inherited);

        let arr = |k: &str| -> Vec<String> {
            r[k].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect()
        };
        assert!(arr("refusedKeys").contains(&"GIT_PAGER".to_string()));
        assert!(!arr("refusedKeys").contains(&"HOMEBREW_PREFIX".to_string()));
        assert!(arr("junkKeys").contains(&"PWD".to_string()));
        assert!(arr("sensitiveKeys").contains(&"OPENAI_API_KEY".to_string()));
        assert!(arr("shadowedKeys").contains(&"TMPDIR".to_string()));
        // 已经导入过的 JAVA_HOME 不该再算候选；GIT_PAGER/PWD 也不算
        assert_eq!(r["pendingCount"], 3, "候选 = ANDROID_HOME + OPENAI_API_KEY + HOMEBREW_PREFIX");
        // 分组与默认勾选
        let groups = r["groups"].as_array().unwrap();
        let mobile = groups.iter().find(|g| g["name"] == "移动开发").unwrap();
        assert_eq!(mobile["defaultChecked"], true);
        let shell = groups.iter().find(|g| g["name"] == "shell 现场").unwrap();
        assert_eq!(shell["defaultChecked"], false);
        // **值绝不出现在报告里**
        let dumped = r.to_string();
        assert!(!dumped.contains("LEAK-ME"), "报告里混进了值: {dumped}");
        assert!(!dumped.contains("/var/folders/xyz") && !dumped.contains("/opt/homebrew"));
        let _ = std::fs::remove_dir_all(&dir);
    }
    /// 真机探针：**不进默认测试套件**，人工核验"这台机器上 Worker 到底拿到什么 PATH"。
    ///
    /// 为什么默认 `#[ignore]`：它会真的起一次用户登录 shell（**执行其 rc 的副作用**），
    /// 本机实测耗时 ~1.45s、stdout 里有 ~1.7KB rc 噪声。这类东西不该出现在 CI 里。
    /// 用法：`cargo test --lib -- --ignored --nocapture worker_env_probe`
    #[test]
    #[ignore = "会起真实登录 shell（执行用户 rc），仅人工排查时显式运行"]
    fn worker_env_probe() {
        let home = PathBuf::from(std::env::var("HOME").expect("HOME")).join(".deepseek-harness-pocket");
        let node_bin = home.join("runtimes").join("node").join("v24.21.0").join("bin");

        println!("── 登录 shell PATH ──");
        match login_shell_path_cached() {
            Some(p) => {
                let segs: Vec<String> = std::env::split_paths(&p).map(|x| x.display().to_string()).collect();
                println!("段数 = {}", segs.len());
                println!("含 /opt/homebrew = {}", segs.iter().any(|s| s.contains("/opt/homebrew")));
            }
            None => println!("未取到（容器/无 SHELL 环境属正常）"),
        }

        println!("── Worker PATH（worker_path_env）──");
        let p = worker_path_env(&home, &node_bin).expect("worker_path_env");
        let segs: Vec<String> = std::env::split_paths(&p).map(|x| x.display().to_string()).collect();
        println!("段数 = {}", segs.len());
        for s in segs.iter().take(3) {
            println!("  [前缀] {s}");
        }
        println!("含 /opt/homebrew = {}", segs.iter().any(|s| s.contains("/opt/homebrew")));

        // 不变量：受管 node 目录必须在最前（否则 dsh 可能用到系统 node）
        assert!(segs.first().map(|s| s.ends_with("v24.21.0/bin")).unwrap_or(false),
                "受管 node bin 必须排在第一位，实际第一位 = {:?}", segs.first());
    }

    fn temp_file(name: &str, content: &[u8]) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("dsh-pocket-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        std::fs::write(&path, content).unwrap();
        path
    }

    fn shasums_entry(name: &str, digest: &str) -> String {
        format!("{digest}  {name}\n")
    }

    #[test]
    fn verify_accepts_part_suffixed_file_via_base_record() {
        let archive = temp_file("node-v24.0.0-darwin-arm64.tar.gz.part", b"payload");
        let digest = sha256_hex(&archive).unwrap();
        // 清单里只有官方产物名（无 .part），落盘文件带 .part 也必须能对上
        let text = shasums_entry("node-v24.0.0-darwin-arm64.tar.gz", &digest);
        verify_shasums(&archive, &text).unwrap();
    }

    #[test]
    fn verify_accepts_plain_name() {
        let archive = temp_file("node-v24.0.0-linux-x64.tar.gz", b"payload");
        let digest = sha256_hex(&archive).unwrap();
        let text = shasums_entry("node-v24.0.0-linux-x64.tar.gz", &digest);
        verify_shasums(&archive, &text).unwrap();
    }

    #[test]
    fn verify_is_case_insensitive_on_digest() {
        let archive = temp_file("node-v24.0.0-win-x64.zip", b"payload");
        let digest = sha256_hex(&archive).unwrap().to_uppercase();
        let text = shasums_entry("node-v24.0.0-win-x64.zip", &digest);
        verify_shasums(&archive, &text).unwrap();
    }

    #[test]
    fn verify_fails_on_digest_mismatch() {
        let archive = temp_file("node-v24.0.0-darwin-x64.tar.gz", b"tampered");
        let text = shasums_entry("node-v24.0.0-darwin-x64.tar.gz", "deadbeef");
        let err = verify_shasums(&archive, &text).unwrap_err();
        assert!(err.contains("不符"), "unexpected error: {err}");
    }

    #[test]
    fn verify_fails_when_record_missing() {
        let archive = temp_file("unknown-artifact.tar.gz", b"payload");
        let err = verify_shasums(&archive, "").unwrap_err();
        assert!(err.contains("没有"), "unexpected error: {err}");
    }

    #[test]
    fn verify_skips_malformed_lines() {
        let archive = temp_file("node-v24.0.0-linux-arm64.tar.gz", b"payload");
        let digest = sha256_hex(&archive).unwrap();
        let text = format!("not-a-valid-line\n\n{digest}  node-v24.0.0-linux-arm64.tar.gz\n");
        verify_shasums(&archive, &text).unwrap();
    }
}

/// 引导链（必经逻辑）的单元测试：布局解析 / 版本择优 / 探测 / 解压 / 清理。
/// AppHandle 绑定的 bootstrap_*_impl 网络流程不在单测范围（见 README 已知缺口）。
#[cfg(test)]
mod bootstrap_tests {
    use super::*;

    fn temp_home(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dsh-pocket-bt-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 摆一个受管 node 发行版布局（node + npm-cli 只需存在，不需要可执行）
    fn install_fake_node(root: &Path, version: &str) {
        let (node_rel, npm_rel) = node_rel_paths();
        let node = root.join(version).join(node_rel);
        std::fs::create_dir_all(node.parent().unwrap()).unwrap();
        std::fs::write(&node, b"fake").unwrap();
        let npm = root.join(version).join(npm_rel);
        std::fs::create_dir_all(npm.parent().unwrap()).unwrap();
        std::fs::write(&npm, b"fake").unwrap();
    }

    // ── 布局路径构建 ─────────────────────────────────────

    #[test]
    fn path_builders_layout() {
        let home = PathBuf::from("/home");
        assert_eq!(node_dir(&home, "v24.21.0"), PathBuf::from("/home/runtimes/node/v24.21.0"));
        assert_eq!(tools_dir(&home), PathBuf::from("/home/runtimes/tools"));
        assert_eq!(
            tools_bin_dir(&home),
            PathBuf::from("/home/runtimes/tools/node_modules/.bin")
        );
        assert_eq!(
            bridge_root(&home),
            PathBuf::from("/home/runtimes/bridge/node_modules/@deepseek-harness-pocket/bridge")
        );
    }

    #[test]
    fn node_source_strings() {
        assert_eq!(NodeSource::System.as_str(), "system");
        assert_eq!(NodeSource::Managed.as_str(), "managed");
    }

    #[test]
    fn toolchain_json_roundtrip_and_malformed() {
        let home = temp_home("tj");
        write_toolchain_json(&home, NodeSource::Managed, "v24.21.0").unwrap();
        assert_eq!(
            read_toolchain_json(&home),
            Some(("managed".into(), "v24.21.0".into()))
        );
        // 坏 JSON / 空目录都返回 None，而不是 panic
        std::fs::write(home.join("toolchain.json"), "{oops").unwrap();
        assert_eq!(read_toolchain_json(&home), None);
        assert_eq!(read_toolchain_json(&temp_home("tj-empty")), None);
    }

    // ── 发行版布局识别 ───────────────────────────────────

    #[test]
    fn managed_node_part_requires_node_and_npm() {
        let home = temp_home("mnp");
        let dir = home.join("v24.21.0");
        // 只有 node、缺 npm-cli → 不算完整发行版
        let (node_rel, npm_rel) = node_rel_paths();
        std::fs::create_dir_all(dir.join(node_rel).parent().unwrap()).unwrap();
        std::fs::write(dir.join(node_rel), b"fake").unwrap();
        assert!(managed_node_part(dir.clone()).is_none());
        // 补上 npm-cli → 完整
        std::fs::create_dir_all(dir.join(npm_rel).parent().unwrap()).unwrap();
        std::fs::write(dir.join(npm_rel), b"fake").unwrap();
        let part = managed_node_part(dir.clone()).unwrap();
        assert_eq!(part.version, "v24.21.0");
        assert_eq!(part.source, NodeSource::Managed);
    }

    #[test]
    fn npm_cli_resolves_from_bin_dir() {
        let home = temp_home("npmcli");
        install_fake_node(&home.join("runtimes").join("node"), "v24.21.0");
        let part = managed_node_part(home.join("runtimes").join("node").join("v24.21.0")).unwrap();
        assert!(part.npm_cli.is_file());
        assert!(npm_cli_for_node_dir(&home.join("nowhere")).is_none());
    }

    // ── pick_managed：声明优先，其次最高版本 ────────────

    #[test]
    fn pick_managed_prefers_declared_then_highest() {
        let home = temp_home("pick");
        let root = home.join("runtimes").join("node");
        install_fake_node(&root, "v22.23.2");
        install_fake_node(&root, "v24.21.0");
        // 无声明 → 最高版本
        assert_eq!(pick_managed(&home).unwrap().version, "v24.21.0");
        // 声明 v22 → 用 v22
        write_toolchain_json(&home, NodeSource::Managed, "v22.23.2").unwrap();
        assert_eq!(pick_managed(&home).unwrap().version, "v22.23.2");
        // 声明的版本目录被删 → 回落最高版本
        std::fs::remove_dir_all(node_dir(&home, "v22.23.2")).unwrap();
        assert_eq!(pick_managed(&home).unwrap().version, "v24.21.0");
        // 全空 → None
        assert!(pick_managed(&temp_home("pick-empty")).is_none());
    }

    // ── resolve_node 优先级（sidecar 注入版）────────────

    #[test]
    fn resolve_sidecar_takes_priority() {
        let sidecar = temp_home("sidecar-root");
        // 旧 sidecar 布局契约：posix <root>/bin/node，win <root>/node.exe（npm-cli 有 fallback，无需存在）
        let node_rel = if cfg!(target_os = "windows") { "node.exe" } else { "bin/node" };
        let node = sidecar.join(node_rel);
        std::fs::create_dir_all(node.parent().unwrap()).unwrap();
        std::fs::write(&node, b"fake").unwrap();
        let part = resolve_node_with(&temp_home("sidecar-home"), Some(sidecar.to_str().unwrap()))
            .unwrap();
        assert_eq!(part.source, NodeSource::Managed);
        assert!(part.node.starts_with(&sidecar));
    }

    #[test]
    fn resolve_sidecar_missing_node_errors() {
        let err = resolve_node_with(&temp_home("sidecar-bad"), Some("/nonexistent/dir")).unwrap_err();
        assert!(err.contains("缺少 node"), "unexpected: {err}");
    }

    // ── 系统 Node 探测（注入 PATH 目录）─────────────────

    /// 造一个假 node 可执行（打印给定版本）；unix only（脚本 shebang）
    #[cfg(unix)]
    fn fake_node_bin(dir: &Path, prints: &str, exit_ok: bool) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(dir).unwrap();
        let node = dir.join("node");
        let body = if exit_ok {
            format!("#!/bin/sh\necho {prints}\n")
        } else {
            "#!/bin/sh\necho boom >&2\nexit 1\n".to_string()
        };
        std::fs::write(&node, body).unwrap();
        std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
        node
    }

    #[cfg(unix)]
    #[test]
    fn system_probe_accepts_modern_node() {
        let home = temp_home("sys-ok");
        let bin = home.join("fakebin");
        fake_node_bin(&bin, "v22.11.0", true);
        // npm-cli 必须能从 bin 目录反推到：<bin>/../lib/node_modules/npm/bin/npm-cli.js
        let npm = home.join("lib/node_modules/npm/bin/npm-cli.js");
        std::fs::create_dir_all(npm.parent().unwrap()).unwrap();
        std::fs::write(&npm, b"fake").unwrap();
        let part = probe_system_node_on([bin]).unwrap();
        assert_eq!(part.source, NodeSource::System);
        assert_eq!(part.version, "v22.11.0");
    }

    #[cfg(unix)]
    #[test]
    fn system_probe_rejects_old_node() {
        let home = temp_home("sys-old");
        let bin = home.join("fakebin");
        fake_node_bin(&bin, "v14.21.1", true);
        let err = probe_system_node_on([bin]).unwrap_err();
        assert!(err.contains("过旧"), "unexpected: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn system_probe_rejects_broken_node() {
        let home = temp_home("sys-broken");
        let bin = home.join("fakebin");
        fake_node_bin(&bin, "v22.0.0", false);
        let err = probe_system_node_on([bin]).unwrap_err();
        assert!(err.contains("无法执行"), "unexpected: {err}");
    }

    #[cfg(unix)]
    #[test]
    fn system_probe_requires_npm() {
        let home = temp_home("sys-nonpm");
        let bin = home.join("fakebin");
        fake_node_bin(&bin, "v22.0.0", true);
        let err = probe_system_node_on([bin]).unwrap_err();
        assert!(err.contains("缺少 npm"), "unexpected: {err}");
    }

    #[test]
    fn system_probe_no_node_at_all() {
        let err = probe_system_node_on([temp_home("sys-none")]).unwrap_err();
        assert!(err.contains("未安装"), "unexpected: {err}");
    }

    // ── PATH 前置 ────────────────────────────────────────

    #[test]
    fn path_env_prepends_node_and_tools() {
        let home = temp_home("pathenv");
        let node_bin = home.join("node-bin");
        std::fs::create_dir_all(&node_bin).unwrap();
        let base = std::env::join_paths(["/usr/bin", "/bin"]).unwrap();
        let joined = path_env_with(&base, &home, &node_bin).unwrap();
        let dirs: Vec<PathBuf> = std::env::split_paths(&joined).collect();
        assert_eq!(dirs[0], node_bin);
        assert_eq!(dirs[1], tools_bin_dir(&home));
        assert!(dirs.contains(&PathBuf::from("/usr/bin")));
        assert!(dirs.contains(&PathBuf::from("/bin")));
    }

    // ── 版本选择与平台 ───────────────────────────────────

    #[test]
    fn version_for_major_maps_choices() {
        assert_eq!(version_for_major(24).unwrap(), "v24.21.0");
        assert_eq!(version_for_major(22).unwrap(), "v22.23.2");
        let err = version_for_major(26).unwrap_err();
        assert!(err.contains("不支持"), "unexpected: {err}");
    }

    #[test]
    fn dist_platform_matches_current_target() {
        let got = dist_platform().unwrap();
        let want = match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => "darwin-arm64",
            ("macos", "x86_64") => "darwin-x64",
            ("windows", "x86_64") => "win-x64",
            _ => unreachable!(),
        };
        assert_eq!(got, want);
    }

    // ── 残留清理 ─────────────────────────────────────────

    #[test]
    fn cleanup_partials_removes_only_partials() {
        let home = temp_home("cleanup");
        let cache = home.join("cache");
        std::fs::create_dir_all(&cache).unwrap();
        std::fs::write(cache.join("node-v24.tar.gz.part"), b"x").unwrap();
        std::fs::write(cache.join("keep.txt"), b"x").unwrap();
        let node_root = home.join("runtimes").join("node");
        std::fs::create_dir_all(node_root.join("v24.21.0.partial")).unwrap();
        std::fs::create_dir_all(node_root.join("v24.21.0")).unwrap();
        cleanup_partials(&home);
        assert!(!cache.join("node-v24.tar.gz.part").exists());
        assert!(cache.join("keep.txt").exists());
        assert!(!node_root.join("v24.21.0.partial").exists());
        assert!(node_root.join("v24.21.0").exists());
    }

    // ── tar.gz 解压（剥首层 + 可执行位）─────────────────

    #[cfg(unix)]
    #[test]
    fn extract_strips_top_dir_and_keeps_exec_bit() {
        use flate2::write::GzEncoder;
        use std::io::Write as _;
        use std::os::unix::fs::PermissionsExt;

        let home = temp_home("extract");
        // 组装源文件并打 tar.gz（首层目录名与官方发行版一致）
        let stage = home.join("stage");
        let node_src = stage.join("bin/node");
        std::fs::create_dir_all(node_src.parent().unwrap()).unwrap();
        std::fs::write(&node_src, b"#!/bin/sh\ntrue\n").unwrap();
        std::fs::set_permissions(&node_src, std::fs::Permissions::from_mode(0o755)).unwrap();
        let npm_src = stage.join("lib/node_modules/npm/bin/npm-cli.js");
        std::fs::create_dir_all(npm_src.parent().unwrap()).unwrap();
        std::fs::write(&npm_src, b"fake").unwrap();

        let archive = home.join("node.tar.gz");
        let f = std::fs::File::create(&archive).unwrap();
        let enc = GzEncoder::new(f, flate2::Compression::default());
        let mut builder = tar::Builder::new(enc);
        builder
            .append_path_with_name(&node_src, "node-v24.21.0-darwin-arm64/bin/node")
            .unwrap();
        builder
            .append_path_with_name(
                &npm_src,
                "node-v24.21.0-darwin-arm64/lib/node_modules/npm/bin/npm-cli.js",
            )
            .unwrap();
        builder.into_inner().unwrap().finish().unwrap().flush().unwrap();

        let dest = home.join("out");
        extract_node_archive(&archive, &dest).unwrap();
        let node = dest.join("bin/node");
        assert!(node.is_file());
        assert_eq!(
            std::fs::metadata(&node).unwrap().permissions().mode() & 0o111,
            0o111,
            "node 必须保留可执行位"
        );
        assert!(dest.join("lib/node_modules/npm/bin/npm-cli.js").is_file());
    }

    // ── 向导状态快照契约（空 home 形状）─────────────────

    #[test]
    fn bootstrap_status_empty_home_shape() {
        let home = temp_home("status");
        let v = bootstrap_status_impl(&home);
        assert_eq!(v["onboardingDone"], false);
        assert_eq!(v["node"]["installed"], false);
        // systemNode 探测走进程真实 PATH，结果因机器而异，只断言字段存在
        assert!(v["systemNode"].is_object());
        assert!(v["systemNode"]["found"].is_boolean());
        assert_eq!(v["bridge"]["installed"], false);
        assert_eq!(v["dshInstalled"], false);
        assert_eq!(v["nodeChoices"].as_array().unwrap().len(), NODE_CHOICES.len());
        assert_eq!(v["nodeChoices"][0]["major"], 24);
        assert_eq!(v["bridge"]["min"], MIN_BRIDGE_VERSION);
    }
}

/// 网络引导流的集成测试：真实走 下载(.part) → SHASUMS 校验 → 解压 → 就位 → toolchain.json，
/// 镜像指向本进程内起的极简 HTTP 服务。这条链在 0.2.0–0.2.7 期间对所有新装机是坏的，
/// 且单测只能覆盖到纯函数——这里用真 HTTP + 真文件系统补上。
// Windows 上 tauri 的 test feature 会使测试 exe 加载即崩（STATUS_ENTRYPOINT_NOT_FOUND），
// 这组 mock runtime 集成测试只在非 Windows 跑；Windows CI 保留全部纯逻辑测试。
#[cfg(all(test, not(target_os = "windows")))]
mod bootstrap_e2e_tests {
    use super::*;
    use std::collections::HashMap;
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex, MutexGuard, OnceLock};

    /// 这一组用例各自起一个本地 HTTP mock 并真下载压缩包，是**竞态敏感**的：
    /// 43 个测试并行跑时（约 10 核）曾出现 1% 量级的偶发失败（实测抓到过
    /// 「189 字节全零」「502 Bad Gateway」「tar 头非法」三种表象）。
    /// 并发本身对被测逻辑没有价值，因此这里显式串行化：谁拿到锁谁跑，
    /// 保证 mock 与客户端之间不与其他 e2e 用例争 CPU。
    fn e2e_lock() -> MutexGuard<'static, ()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        match LOCK.get_or_init(|| Mutex::new(())).lock() {
            Ok(g) => g,
            Err(p) => p.into_inner(),
        }
    }

    /// 极简测试镜像：单线程应答器，路由 → 字节体；未注册路由回 404；drop 即停。
    struct MockMirror {
        url: String,
        stop: Arc<AtomicBool>,
    }

    impl MockMirror {
        fn start(routes: HashMap<String, Vec<u8>>) -> Self {
            let listener = TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}", listener.local_addr().unwrap());
            let stop = Arc::new(AtomicBool::new(false));
            let stop2 = stop.clone();
            std::thread::spawn(move || {
                listener.set_nonblocking(true).ok();
                while !stop2.load(Ordering::Relaxed) {
                    match listener.accept() {
                        Ok((mut stream, _)) => {
                            // 每条连接单独一个线程 + 读超时：客户端可能只建立连接不发请求
                            // （预连接/连接池），而 accepted stream 是阻塞的——在 accept 循环里
                            // 直接 read 会把它整个卡死，后续请求超时 → 测试偶发失败
                            // （本机实测复现过 1 次：`install_end_to_end_from_mirror`）。
                            let routes = routes.clone();
                            std::thread::spawn(move || {
                                // 读请求头：单次 500ms 超时、最多 120 次（合计 ~60s 空闲容忍）。
                                //
                                // 为什么必须这么宽容（实测三次迭代才定位到）：
                                // 本机开了系统 HTTP 代理（`scutil --proxy` → 127.0.0.1:7897），
                                // reqwest 的 system-proxy 特性会把这些请求交给代理，而**代理会
                                // 复用与上游的连接**。早先"读超时后立刻关连接/回 404"的写法会让
                                // 代理手里攥着一条已死的上游连接 → 下一次真实请求写成
                                // `502 Bad Gateway`，或直接读到我们预先写好的 404，
                                // 表现为 e2e 用例偶发红（`install_*`、`tar 头非法`）。
                                // 所以：只要没读到完整请求行，就继续等，**不要主动关**。
                                let _ = stream.set_read_timeout(Some(Duration::from_millis(500)));
                                let mut buf: Vec<u8> = Vec::new();
                                let mut chunk = [0u8; 512];
                                for _ in 0..120 {
                                    match stream.read(&mut chunk) {
                                        Ok(0) => break, // 对端真的关了
                                        Ok(n) => {
                                            buf.extend_from_slice(&chunk[..n]);
                                            if buf.contains(&b'\n') {
                                                break;
                                            }
                                        }
                                        Err(e)
                                            if matches!(
                                                e.kind(),
                                                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                                            ) =>
                                        {
                                            continue
                                        }
                                        Err(_) => break,
                                    }
                                }
                                // 始终没收到请求：直接关（不回 404）——回一个 404 会被
                                // 当成这条连接上后续请求的响应。
                                if buf.is_empty() {
                                    return;
                                }
                                let req = String::from_utf8_lossy(&buf);
                                // 兼容"绝对形式"请求行：经过 HTTP 代理时请求行是
                                // `GET http://127.0.0.1:port/path HTTP/1.1`，直接
                                // `nth(1)` 会拿到整条 URL → 路由匹配失败 → 404。
                                // 本机系统代理（README 记为 127.0.0.1:7897）对 loopback
                                // 也生效（reqwest 的 system-proxy 特性），因此这不是
                                // 假想情况：实测就是它把 e2e 用例变成偶发红的。
                                let target = req.split_whitespace().nth(1).unwrap_or("/");
                                let path = match target.find("://") {
                                    Some(i) => {
                                        let after = &target[i + 3..];
                                        match after.find('/') {
                                            Some(j) => after[j..].to_string(),
                                            None => "/".to_string(),
                                        }
                                    }
                                    None => target.to_string(),
                                };
                                let path = path.split('?').next().unwrap_or("/").to_string();
                                if routes.get(&path).is_none() {
                                    eprintln!("[mock] 404 path={path:?} raw={req:?}");
                                }
                                let mut resp = match routes.get(&path) {
                                    Some(body) => {
                                        let mut r = format!(
                                            "HTTP/1.0 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                                            body.len()
                                        )
                                        .into_bytes();
                                        r.extend_from_slice(body);
                                        r
                                    }
                                    None => b"HTTP/1.0 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
                                };
                                let _ = stream.write_all(&mut resp);
                            });
                        }
                        Err(_) => std::thread::sleep(Duration::from_millis(10)),
                    }
                }
            });
            Self { url, stop }
        }
    }

    impl Drop for MockMirror {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::Relaxed);
        }
    }

    fn sha256_of(bytes: &[u8]) -> String {
        use sha2::{Digest, Sha256};
        format!("{:x}", Sha256::digest(bytes))
    }

    /// 造一个与官方发行版同构的压缩包（posix tar.gz 带 bin/node + npm-cli；win zip 带 node.exe）
    fn node_archive_bytes(version: &str) -> Vec<u8> {
        let platform = dist_platform().unwrap();
        let prefix = format!("node-{version}-{platform}");
        if cfg!(target_os = "windows") {
            let mut z = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
            let opts = zip::write::SimpleFileOptions::default();
            z.start_file(format!("{prefix}/node.exe"), opts).unwrap();
            z.write_all(b"fake node").unwrap();
            z.start_file(format!("{prefix}/node_modules/npm/bin/npm-cli.js"), opts).unwrap();
            z.write_all(b"fake npm").unwrap();
            z.finish().unwrap().into_inner()
        } else {
            use flate2::write::GzEncoder;
            let buf = std::env::temp_dir().join(format!("dsh-pocket-e2e-{}-node.tar.gz", std::process::id()));
            let f = std::fs::File::create(&buf).unwrap();
            let enc = GzEncoder::new(f, flate2::Compression::default());
            let mut builder = tar::Builder::new(enc);
            let node_body = b"#!/bin/sh\necho v24.21.0\n";
            let mut h = tar::Header::new_gnu();
            h.set_size(node_body.len() as u64);
            h.set_mode(0o755);
            h.set_cksum();
            builder
                .append_data(&mut h, format!("{prefix}/bin/node"), node_body.as_slice())
                .unwrap();
            let npm_body = b"fake npm";
            let mut h2 = tar::Header::new_gnu();
            h2.set_size(npm_body.len() as u64);
            h2.set_mode(0o644);
            h2.set_cksum();
            builder
                .append_data(&mut h2, format!("{prefix}/lib/node_modules/npm/bin/npm-cli.js"), npm_body.as_slice())
                .unwrap();
            builder.into_inner().unwrap().finish().unwrap().flush().unwrap();
            std::fs::read(&buf).unwrap()
        }
    }

    fn temp_home(tag: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("dsh-pocket-e2e-{}-{tag}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn install_end_to_end_from_mirror() {
        let _serial = e2e_lock(); // 串行化：见 e2e_lock 注释
        let app = tauri::test::mock_app();
        let home = temp_home("ok");
        let version = version_for_major(24).unwrap();
        let platform = dist_platform().unwrap();
        let ext = if cfg!(target_os = "windows") { "zip" } else { "tar.gz" };
        let filename = format!("node-{version}-{platform}.{ext}");
        let archive = node_archive_bytes(version);

        let mut routes = HashMap::new();
        routes.insert(format!("/{version}/{filename}"), archive.clone());
        routes.insert(
            format!("/{version}/SHASUMS256.txt"),
            format!("{}  {}\n", sha256_of(&archive), filename).into_bytes(),
        );
        let mirror = MockMirror::start(routes);

        let msg = node_install_impl_with(app.handle(), &home, 24, &mirror.url).unwrap();
        assert!(msg.contains(version), "unexpected: {msg}");

        // 就位且健康：pick_managed 能选中、toolchain.json 声明正确
        let part = pick_managed(&home).unwrap_or_else(|| panic!("installed node should be pickable"));
        assert_eq!(part.version, version);
        assert_eq!(
            read_toolchain_json(&home),
            Some(("managed".into(), version.into()))
        );
        // 引导状态契约联动：向导应视为 node 已就绪
        let status = bootstrap_status_impl(&home);
        assert_eq!(status["node"]["installed"], true);
        assert_eq!(status["node"]["version"], version);
        assert_eq!(status["node"]["source"], "managed");
    }

    #[test]
    fn install_fails_closed_on_tampered_artifact() {
        let _serial = e2e_lock(); // 串行化：见 e2e_lock 注释
        let app = tauri::test::mock_app();
        let home = temp_home("tamper");
        let version = version_for_major(24).unwrap();
        let platform = dist_platform().unwrap();
        let ext = if cfg!(target_os = "windows") { "zip" } else { "tar.gz" };
        let filename = format!("node-{version}-{platform}.{ext}");
        let archive = node_archive_bytes(version);

        let mut routes = HashMap::new();
        routes.insert(format!("/{version}/{filename}"), archive);
        // 清单是「好摘要」，但产物是另一份字节 → 必须拒收
        routes.insert(
            format!("/{version}/SHASUMS256.txt"),
            format!("{}  {filename}\n", "0".repeat(64)).into_bytes(),
        );
        let mirror = MockMirror::start(routes);

        let err = node_install_impl_with(app.handle(), &home, 24, &mirror.url).unwrap_err();
        assert!(err.contains("不符"), "unexpected: {err}");
        // 决不能就位
        assert!(pick_managed(&home).is_none());
        assert!(!home.join("toolchain.json").exists());
    }

    #[test]
    fn install_fails_when_shasums_missing() {
        let _serial = e2e_lock(); // 串行化：见 e2e_lock 注释
        let app = tauri::test::mock_app();
        let home = temp_home("nosh");
        let version = version_for_major(24).unwrap();
        let platform = dist_platform().unwrap();
        let ext = if cfg!(target_os = "windows") { "zip" } else { "tar.gz" };
        let filename = format!("node-{version}-{platform}.{ext}");
        // 产物能下载（200），清单 404 → 精确命中「下载 SHASUMS256.txt 失败」
        let mut routes = HashMap::new();
        routes.insert(format!("/{version}/{filename}"), node_archive_bytes(version));
        let mirror = MockMirror::start(routes);
        let err = node_install_impl_with(app.handle(), &home, 24, &mirror.url).unwrap_err();
        assert!(err.contains("SHASUMS256.txt"), "unexpected: {err}");
        assert!(pick_managed(&home).is_none());
    }

    #[test]
    fn install_fails_when_mirror_unreachable() {
        let _serial = e2e_lock(); // 串行化：见 e2e_lock 注释
        let app = tauri::test::mock_app();
        let home = temp_home("down");
        // 占一个端口立刻松手：连接必然被拒
        let addr: std::net::SocketAddr = {
            let l = TcpListener::bind("127.0.0.1:0").unwrap();
            l.local_addr().unwrap()
        };
        let err = node_install_impl_with(app.handle(), &home, 24, &format!("http://{addr}")).unwrap_err();
        assert!(err.contains("下载失败") || err.contains("下载中断"), "unexpected: {err}");
        assert!(pick_managed(&home).is_none());
    }
}
