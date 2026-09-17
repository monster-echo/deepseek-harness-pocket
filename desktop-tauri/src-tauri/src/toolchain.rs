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
pub const MIN_BRIDGE_VERSION: &str = "0.1.1";
pub const PNPM_SPEC: &str = "pnpm@10";
pub const NPM_REGISTRY: &str = "https://registry.npmmirror.com";

// ── 解析结果 ─────────────────────────────────────────────

/// Node 来源（供状态展示与 toolchain.json 记录）
#[derive(Clone, Copy, PartialEq, Eq)]
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

fn managed_node_part(dir: PathBuf) -> Option<NodePart> {
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
    let exe = if cfg!(target_os = "windows") { "node.exe" } else { "node" };
    for dir in std::env::split_paths(&path) {
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
    // 1. 显式环境变量（旧 sidecar 布局 / 测试 / dev）
    if let Ok(dir) = std::env::var("DSH_POCKET_SIDECAR") {
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
    std::env::join_paths(
        std::iter::once(node_bin_dir.to_path_buf())
            .chain(std::iter::once(tools_bin_dir(home)))
            .chain(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())),
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

    let node_installed = pick_managed(home).map(|p| {
        let pnpm = tools_bin_dir(home).join(if cfg!(target_os = "windows") { "pnpm.cmd" } else { "pnpm" });
        serde_json::json!({ "installed": true, "version": p.version, "pnpm": pnpm.exists() })
    });

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

/// 从镜像同路径的 SHASUMS256.txt 校验产物（fail-closed）
fn verify_shasums(archive: &Path, shasums_text: &str) -> Result<(), String> {
    let want = sha256_hex(archive)?;
    let name = archive.file_name().unwrap_or_default().to_string_lossy().to_string();
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
    let version = version_for_major(major)?;
    let platform = dist_platform()?;
    let final_dir = node_dir(home, version);
    if managed_node_part(final_dir.clone()).is_some() {
        write_toolchain_json(home, NodeSource::Managed, version)?;
        return Ok(format!("Node {version} 已就绪"));
    }

    let ext = if cfg!(target_os = "windows") { "zip" } else { "tar.gz" };
    let filename = format!("node-{version}-{platform}.{ext}");
    let url = format!("{NODE_MIRROR}/{version}/{filename}");
    let archive = home.join("cache").join(format!("{filename}.part"));

    let step = "node";
    emit_progress(app, serde_json::json!({ "step": step, "phase": "download", "received": 0, "total": serde_json::Value::Null }));
    download_with_progress(app, &url, &archive, step)?;

    emit_progress(app, serde_json::json!({ "step": step, "phase": "verify" }));
    let shasums_url = format!("{NODE_MIRROR}/{version}/SHASUMS256.txt");
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

/// 安装 bridge（dshc）到 runtimes/bridge（幂等；已满足 MIN 版本则跳过）。
pub fn bridge_install_impl<R: Runtime>(app: &AppHandle<R>, home: &Path, node: &NodePart) -> Result<String, String> {
    // 已装且满足最低版本：跳过（引导重入时不重复下载）
    if let Ok((_, _, version)) = resolve_bridge(home) {
        if !version.is_empty()
            && super::compare_versions(&version, MIN_BRIDGE_VERSION) != std::cmp::Ordering::Less
        {
            return Ok(format!("Worker 核心 {version} 已就绪"));
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
