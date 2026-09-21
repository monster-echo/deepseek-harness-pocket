//! 运行时工具链解析 + 首次引导（去 sidecar 化）。
//!
//! 安装包不再内置 Node/bridge（v0.2.0 起）：首次启动由向导从网络组装——
//!   系统 Node（复用，零下载）或受管下载 runtimes/node/<ver>（npmmirror 镜像 + sha256 校验）
//!   → pnpm 装进 runtimes/tools/（dsh plugin add 依赖，绝不写用户系统目录）
//!   → npm 装 @deepseek-harness-pocket/bridge → runtimes/bridge/
//! 本模块是唯一知道这些布局的地方；lib.rs 只调 resolve()/bootstrap_*()。

use std::path::{Path, PathBuf};
use std::process::Command;
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
    crate::ensure_tls_provider();
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;
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
    crate::ensure_tls_provider();
    let shasums = reqwest::blocking::get(&shasums_url)
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
    use std::sync::Arc;

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
                            let mut buf = [0u8; 2048];
                            let _ = stream.read(&mut buf);
                            let req = String::from_utf8_lossy(&buf);
                            let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
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
