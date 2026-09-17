/**
 * Worker 状态桥接层。
 *
 * Tauri 里走 Rust 命令（Rust 再以内置 node 调 dshc CLI）；
 * 纯浏览器里（`pnpm dev` 直接开 1420）返回 mock —— 便于脱离桌面壳迭代视觉。
 */
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** supervisor 待机原因（run.json 的 giveUp；旧 supervisor 不写，读方需容忍缺省） */
export interface GiveUpInfo {
  reason: "port_in_use" | "spawn_failed" | "crash_loop";
  detail?: string;
  port?: number;
  /** epoch ms */
  since: number;
}

export interface RunInfo {
  dshBin: string;
  dshVersion: string;
  /** bridge（dshc sidecar）自身版本，便于诊断 sidecar 新旧 */
  bridgeVersion?: string;
  gatewayUrl: string;
  port: number;
  host: string;
  name: string;
  caps: string;
  /** dsh 打印的 Web 控制台地址（0.1.5+ 带 ?token=，随重启刷新） */
  webUrl?: string;
  /** supervisor 状态；缺省视为 active（旧 run.json 兼容） */
  supervisor?: "active" | "standby";
  /** 进入待机的原因；恢复后清除 */
  giveUp?: GiveUpInfo;
}

/** 对应 `dshc status --json` 的输出 */
export interface WorkerStatus {
  running: boolean;
  pid?: number;
  standby?: boolean;
  supervisor?: "active" | "standby";
  giveUp?: GiveUpInfo;
  run?: RunInfo;
  profileDir?: string;
  stateFile?: string;
  pidFile?: string;
  logFile?: string;
  home?: string;
  error?: string;
  parseError?: string;
  /** Rust 轮询器探测到 sidecar 缺失时置位（不再空转 spawn node） */
  sidecarMissing?: boolean;
}

export interface QrInfo {
  payload: string;
  code: string;
  name: string;
  host?: string;
  port: number;
  gatewayUrl?: string;
  fingerprint?: string;
}

export interface RuntimeInfo {
  sidecarReady: boolean;
  sidecarError?: string;
  nodeBin?: string;
  dshcCli?: string;
  pocketHome?: string;
  logFile?: string;
  platform: string;
}

export interface DshVersion {
  version: string;
  path: string;
  installedAt: number;
  sizeBytes: number;
  hasBin: boolean;
}

export interface VersionsInfo {
  root: string;
  versions: DshVersion[];
  activeVersion?: string;
}

export interface AccountSessionInfo {
  signedIn: boolean;
  sessionFile?: string;
  parseError?: string;
  error?: string;
  version?: number;
  userId?: string;
  email?: string;
  /** RS256 JWT，gateway 经 JWKS 离线验签 */
  token?: string;
  refreshToken?: string;
  /** epoch ms */
  updatedAt?: number;
  [k: string]: unknown;
}

export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/* ── 浏览器 mock：让视觉开发不被 Worker 阻塞 ─────────────── */
const MOCK: WorkerStatus = {
  running: true,
  pid: 48213,
  run: {
    dshBin: "/Users/you/.deepseek-harness-pocket/runtimes/dsh/0.1.5-rc.1/bin/dsh",
    dshVersion: "0.1.5-rc.1",
    gatewayUrl: "wss://gateway.zhongbei.tech",
    port: 3780,
    host: "0.0.0.0",
    name: "studio-mac-mini",
    caps: "m3",
    webUrl: "http://127.0.0.1:3780/?token=mock-token",
  },
  profileDir: "~/.deepseek-harness-pocket/profiles/companion",
  stateFile: "~/.deepseek-harness-pocket/bridge-state.json",
  pidFile: "~/.deepseek-harness-pocket/dshc.pid",
  logFile: "~/.deepseek-harness-pocket/dshc.log",
  home: "~/.deepseek-harness-pocket",
};

export async function workerStatus(): Promise<WorkerStatus> {
  if (!isTauri()) return MOCK;
  return invoke<WorkerStatus>("dshc_status");
}

export async function workerStart(): Promise<string> {
  if (!isTauri()) return "[mock] 已启动";
  return invoke<string>("dshc_start");
}

export async function workerStop(): Promise<string> {
  if (!isTauri()) return "[mock] 已停止";
  return invoke<string>("dshc_stop");
}

/** 恢复待机中的 supervisor（crash_loop 等待机的手动重试入口） */
export async function workerResume(): Promise<string> {
  if (!isTauri()) return "[mock] 已请求恢复";
  return invoke<string>("dshc_resume");
}

/** 待机原因的中文描述（状态页与引导页共用） */
export function giveUpText(info?: GiveUpInfo): string {
  if (!info) return "Worker 已暂停自动重启";
  switch (info.reason) {
    case "port_in_use":
      return `端口 ${info.port ?? "?"} 已被其他程序占用（可能是另一个 DSH 实例）。已暂停自动重启，端口释放后会自动恢复。`;
    case "spawn_failed":
      return `dsh 无法启动：${info.detail ?? "未知原因"}。请到「版本」页重新安装运行时。`;
    case "crash_loop":
      return "dsh 连续异常退出，已暂停自动重启。可点击重试，或到「日志」页查看原因。";
  }
}

/* ── 引导页环境预检 ───────────────────────────────────────── */

export type PreflightItemId = "sidecar" | "runtime" | "account" | "port" | "gateway";
export type PreflightFix = "install_runtime" | "login" | "free_port";

export interface PreflightItem {
  id: PreflightItemId;
  state: "pass" | "warn" | "fail";
  detail: string;
  fix?: PreflightFix | null;
}

export interface PreflightReport {
  overall: "ready" | "action_required";
  items: PreflightItem[];
  /** epoch ms */
  checkedAt: number;
}

/** 环境预检：sidecar / runtime / account / port / gateway 一次性快照 */
export async function preflightCheck(): Promise<PreflightReport> {
  if (!isTauri()) {
    // ?broken：视觉调试「缺环境 → 引导动作」卡片用
    const broken =
      typeof window !== "undefined" && new URLSearchParams(window.location.search).has("broken");
    return {
      overall: broken ? "action_required" : "ready",
      checkedAt: Date.now(),
      items: broken
        ? [
            { id: "sidecar", state: "pass", detail: "内置 Node.js 与 bridge 就绪" },
            { id: "runtime", state: "fail", detail: "尚未安装 dsh 运行时", fix: "install_runtime" },
            { id: "account", state: "fail", detail: "尚未登录掌鲸账号", fix: "login" },
            {
              id: "port",
              state: "fail",
              detail: "端口 3080 被其他程序占用（可能是另一个 DSH 实例）",
              fix: "free_port",
            },
            { id: "gateway", state: "warn", detail: "无法访问网关（离线时仍可使用本机控制台）" },
          ]
        : [
            { id: "sidecar", state: "pass", detail: "内置 Node.js 与 bridge 就绪" },
            { id: "runtime", state: "pass", detail: "dsh 0.1.5-rc.1 就绪" },
            { id: "account", state: "pass", detail: "已登录" },
            { id: "port", state: "pass", detail: "端口可用" },
            { id: "gateway", state: "pass", detail: "网关可达" },
          ],
    };
  }
  return invoke<PreflightReport>("preflight_check");
}

export async function workerQr(): Promise<QrInfo> {
  if (!isTauri()) {
    return {
      payload: "dshpocket://pair?code=MOCK-1234&name=studio-mac-mini&port=3780",
      code: "MOCK-1234",
      name: "studio-mac-mini",
      host: "192.168.1.24",
      port: 3780,
    };
  }
  return invoke<QrInfo>("dshc_qr");
}

export async function runtimeInfo(): Promise<RuntimeInfo> {
  if (!isTauri()) {
    return {
      sidecarReady: true,
      nodeBin: ".../node-sidecar/node/bin/node",
      dshcCli: ".../node-sidecar/bridge/dist/cli/index.js",
      pocketHome: "~/.deepseek-harness-pocket",
      logFile: "~/.deepseek-harness-pocket/dshc.log",
      platform: "macos",
    };
  }
  return invoke<RuntimeInfo>("runtime_info");
}

export async function listVersions(): Promise<VersionsInfo> {
  if (!isTauri()) {
    return {
      root: "~/.deepseek-harness-pocket/runtimes/dsh",
      activeVersion: "0.1.5-rc.1",
      versions: [
        { version: "0.1.5-rc.1", path: "…/runtimes/dsh/0.1.5-rc.1", installedAt: 1757300000, sizeBytes: 48234496, hasBin: true },
        { version: "0.1.4", path: "…/runtimes/dsh/0.1.4", installedAt: 1755000000, sizeBytes: 47185920, hasBin: true },
      ],
    };
  }
  return invoke<VersionsInfo>("list_dsh_versions");
}

export async function readLog(maxLines = 400): Promise<string> {
  if (!isTauri()) {
    return [
      "[mock] 12:04:31 dshc: 启动 supervisor",
      "[mock] 12:04:32 dsh web: http://127.0.0.1:3780/?token=…",
      "[mock] 12:04:33 uplink 已连接 gateway.zhongbei.tech",
      "[mock] 12:04:33 worker-register 成功（已按账号自动绑定）",
    ].join("\n");
  }
  return invoke<string>("read_log", { maxLines });
}

export async function readAccountSession(): Promise<AccountSessionInfo> {
  if (!isTauri()) {
    // ?loggedout：视觉调试「未登录 → 扫码登录」卡片用（真实桌面端以本地文件为准）
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).has("loggedout")) {
      return { signedIn: false, sessionFile: "~/.deepseek-harness-pocket/account-session.json", updatedAt: 0 };
    }
    // 与 accountLogin 的 mock 保持一致，否则账号页在浏览器态显示不全
    return {
      signedIn: true,
      sessionFile: "~/.deepseek-harness-pocket/account-session.json",
      version: 1,
      userId: "u_mock",
      email: "you@example.com",
      token: "eyJhbGciOiAiUlMyNTYiLCAidHlwIjogIkpXVCJ9.eyJzdWIiOiAidV9tb2NrIiwgImV4cCI6IDE3ODk2MDM5MTd9.MOCK_SIG",
      refreshToken: "MOCK_REFRESH_TOKEN",
      updatedAt: Date.now(),
    };
  }
  return invoke<AccountSessionInfo>("read_account_session");
}

/* ── 扫码登录（手机授权，Telegram 同款）────────────────── */

/** 本机已完成的扫码登录态（device-link.json） */
export interface DeviceLinkInfo {
  version?: number;
  userId?: string;
  email?: string;
  /** dshl_<code>.<secret>，调 gateway REST 用 */
  credential?: string;
  code?: string;
  workerId?: string;
  /** epoch ms */
  linkedAt?: number;
}

/** 待确认的链接码（qr = 二维码文本，与协议包 buildDeviceLinkQr 同格式） */
export interface DeviceLinkPending {
  code: string;
  secret: string;
  qr: string;
  /** epoch ms */
  expiresAt: number;
  intervalMs: number;
  hostKey?: string;
}

export type DeviceLinkPollResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "approved"; link: DeviceLinkInfo };

export async function readDeviceLink(): Promise<DeviceLinkInfo | null> {
  if (!isTauri()) return null;
  return invoke<DeviceLinkInfo | null>("read_device_link");
}

export async function deviceLinkStart(): Promise<DeviceLinkPending> {
  if (!isTauri()) {
    return {
      code: "MOCK2345",
      secret: "m".repeat(64),
      qr: `dshp://link?v=1&c=MOCK2345&h=${encodeURIComponent("mock-mac")}&p=macos&gw=${encodeURIComponent("https://gateway.test")}`,
      expiresAt: Date.now() + 5 * 60 * 1000,
      intervalMs: 2000,
    };
  }
  return invoke<DeviceLinkPending>("device_link_start");
}

let mockPollCount = 0;

export async function deviceLinkPoll(code: string, secret: string): Promise<DeviceLinkPollResult> {
  if (!isTauri()) {
    // 浏览器 mock：第 3 拍返回 approved，便于视觉验证「扫码后变已登录」
    mockPollCount += 1;
    if (mockPollCount < 3) return { status: "pending" };
    return {
      status: "approved",
      link: {
        version: 1,
        userId: "u_mock",
        email: "you@example.com",
        credential: `dshl_${code}.${secret}`,
        code,
        workerId: "w_mock",
        linkedAt: Date.now(),
      },
    };
  }
  return invoke<DeviceLinkPollResult>("device_link_poll", { code, secret });
}

/** 退出登录：解绑这台电脑并吊销设备凭据（服务端失败也让本地登出） */
export async function deviceLinkRevoke(): Promise<void> {
  if (!isTauri()) return;
  await invoke("device_link_revoke");
}

export async function showConsole(panel: string): Promise<void> {
  if (!isTauri()) return;
  return invoke("show_console", { panel });
}

export async function openExternal(url: string): Promise<void> {
  if (!isTauri()) {
    window.open(url, "_blank");
    return;
  }
  return invoke("open_external", { url });
}

/** 订阅 Rust 侧 3 秒轮询推送的 Worker 状态 */
export async function onWorkerStatus(
  cb: (s: WorkerStatus) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<WorkerStatus>("worker-status", (e) => cb(e.payload));
}

/** 订阅「开机自动启动失败」事件（boot 线程不再吞错） */
export async function onWorkerStartError(
  cb: (message: string) => void,
): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<string>("worker-start-error", (e) => cb(e.payload));
}

/** 托盘「控制台 → 某页」的深链 */
export async function onConsolePanel(cb: (panel: string) => void): Promise<UnlistenFn> {
  if (!isTauri()) return () => {};
  return listen<string>("console-panel", (e) => cb(e.payload));
}

/** 在系统浏览器中登录掌鲸账号（Rust 侧起 loopback 回调服务等待，最长 180 秒） */
export async function accountLogin(authUrl?: string): Promise<AccountSessionInfo> {
  if (!isTauri()) {
    return {
      signedIn: true,
      sessionFile: "~/.deepseek-harness-pocket/account-session.json",
      email: "you@example.com",
      userId: "u_mock",
      // 假 JWT（exp = 1 小时后），让账号页的 Token 状态与续期按钮在浏览器态也能展示
      token: "eyJhbGciOiAiUlMyNTYiLCAidHlwIjogIkpXVCJ9.eyJzdWIiOiAidV9tb2NrIiwgImV4cCI6IDE3ODk2MDM4Nzd9.MOCK_SIG",
      refreshToken: "MOCK_REFRESH_TOKEN",
      updatedAt: Date.now(),
    };
  }
  return invoke<AccountSessionInfo>("account_login", { authUrl: authUrl ?? null });
}

/** 退出登录：删除本机会话文件 */
export async function accountSignOut(): Promise<void> {
  if (!isTauri()) return;
  return invoke("account_sign_out");
}

/** 只读 JWT 的 exp（不验签），仅用于判断本地会话还有没有用 */
export function jwtExpiry(token?: string): number | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length < 2) return null;
  try {
    let payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    payload = payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
    const json = JSON.parse(atob(payload)) as { exp?: number };
    return typeof json.exp === "number" ? json.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** npm 上可用的 dsh 版本（新 → 旧） */
export async function versionsAvailable(registry?: string): Promise<string[]> {
  if (!isTauri()) return ["0.1.6", "0.1.5-rc.1", "0.1.4", "0.1.1-rc.2"];
  return invoke<string[]>("dsh_versions_available", { registry: registry ?? null });
}

/** 安装指定版本（dsh 依赖树约 450 包，可能十几分钟） */
export async function installVersion(version: string, registry?: string): Promise<string> {
  if (!isTauri()) return `[mock] 已安装 ${version}`;
  return invoke<string>("dsh_install_version", { version, registry: registry ?? null });
}

/** 删除托管版本 */
export async function removeVersion(version: string): Promise<void> {
  if (!isTauri()) return;
  return invoke("dsh_remove_version", { version });
}

/** 切换当前使用的 dsh 版本：停 Worker → 以指定版本二进制重新拉起 */
export async function switchVersion(version: string): Promise<string> {
  if (!isTauri()) return `[mock] 已切到 ${version}`;
  return invoke<string>("dsh_switch_version", { version });
}

export interface UpdateInfo {
  available: boolean;
  version?: string;
  currentVersion?: string;
  notes?: string;
}

/** 检查应用自身是否有新版本 */
export async function checkUpdate(): Promise<UpdateInfo> {
  if (!isTauri()) return { available: false };
  return invoke<UpdateInfo>("check_update");
}

/** 下载并安装更新，成功后应用会重启 */
export async function installUpdate(): Promise<void> {
  if (!isTauri()) return;
  return invoke("install_update");
}

/** 用 refresh token 续期；失败抛错（调用方决定是否提示重新登录） */
export async function accountRefresh(authUrl?: string): Promise<AccountSessionInfo> {
  if (!isTauri()) return { signedIn: true, updatedAt: Date.now() };
  return invoke<AccountSessionInfo>("account_refresh", { authUrl: authUrl ?? null });
}

export interface AppSettings {
  gatewayUrl: string;
  workerName: string;
  host: string;
  port: number;
  caps: string;
  registry: string;
  [k: string]: unknown;
}

/** 读取设置（desktop-settings.json，缺项用默认值） */
export async function getSettings(): Promise<AppSettings> {
  if (!isTauri()) {
    return { gatewayUrl: "wss://dsh-pocket.zhongbei.tech/gw/worker",
             workerName: "mock-mac", host: "0.0.0.0", port: 3780,
             caps: "m3", registry: "https://registry.npmmirror.com" };
  }
  return invoke<AppSettings>("get_settings");
}

/** 保存设置（浅合并，只覆盖传入键）。改完需重启 Worker 生效。 */
export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  if (!isTauri()) return getSettings();
  return invoke<AppSettings>("save_settings", { patch });
}
