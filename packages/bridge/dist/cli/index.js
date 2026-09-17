#!/usr/bin/env node

// src/cli/index.ts
import { spawnSync as spawnSync4 } from "node:child_process";
import { readFileSync as readFileSync5 } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import qrcode from "qrcode-terminal";

// ../bridge-protocol/dist/pairing.js
var PAIR_QR_SCHEME = "dshp";
var PAIR_QR_HOST = "pair";
function encodePairQr(payload) {
  const parts = [`code=${encodeURIComponent(payload.code)}`];
  if (payload.name !== void 0 && payload.name.length > 0) {
    parts.push(`name=${encodeURIComponent(payload.name)}`);
  }
  if (payload.host !== void 0 && payload.host.length > 0) {
    parts.push(`host=${encodeURIComponent(payload.host)}`);
  }
  if (payload.port !== void 0)
    parts.push(`port=${payload.port}`);
  if (payload.token !== void 0 && payload.token.length > 0) {
    parts.push(`token=${encodeURIComponent(payload.token)}`);
  }
  if (payload.gatewayUrl !== void 0 && payload.gatewayUrl.length > 0) {
    parts.push(`gw=${encodeURIComponent(payload.gatewayUrl)}`);
  }
  return `${PAIR_QR_SCHEME}://${PAIR_QR_HOST}?${parts.join("&")}`;
}

// ../bridge-protocol/dist/preview.js
var PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
var PREVIEW_CHUNK_BYTES = 48 * 1024;

// src/plugin/state.ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
function defaultStateFile() {
  return join(homedir(), ".deepseek-harness-pocket", "bridge-state.json");
}
function b64url(bytes) {
  return bytes.toString("base64url");
}
function makeFingerprint() {
  const seed = `${homedir()}|${process.platform}|${process.arch}|${randomBytes(8).toString("hex")}`;
  return createHash("sha256").update(seed).digest("hex").slice(0, 16);
}
function generateBridgeState(now = Date.now()) {
  const code = String(1e5 + randomBytes(4).readUInt32BE(0) % 9e5);
  return {
    version: 1,
    hostKey: `hk_${b64url(randomBytes(18))}`,
    pairingToken: `pt_${b64url(randomBytes(24))}`,
    pairingCode: code,
    fingerprint: makeFingerprint(),
    createdAt: now
  };
}
function loadBridgeState(file, allowCreate = true) {
  const path = resolve(file.replace(/^~(?=\/|$)/, homedir()));
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8"));
      if (parsed.version === 1 && typeof parsed.hostKey === "string" && parsed.hostKey.length > 0 && typeof parsed.pairingToken === "string" && parsed.pairingToken.length > 0 && typeof parsed.pairingCode === "string" && /^\d{6}$/.test(parsed.pairingCode) && typeof parsed.fingerprint === "string" && parsed.fingerprint.length > 0 && typeof parsed.createdAt === "number") {
        return parsed;
      }
    } catch {
    }
  }
  if (!allowCreate) return void 0;
  const state = generateBridgeState();
  saveBridgeState(path, state);
  return state;
}
function saveBridgeState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, void 0, 2)}
`, { mode: 384 });
}

// src/cli/runtime.ts
import { spawnSync } from "node:child_process";
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "node:fs";
import { dirname as dirname2, resolve as resolve2 } from "node:path";
import { fileURLToPath } from "node:url";
function resolveDshBin(explicit) {
  if (explicit !== void 0 && explicit.length > 0) {
    if (!existsSync2(explicit)) throw new Error(`\u6307\u5B9A\u7684 dsh \u4E0D\u5B58\u5728: ${explicit}`);
    return explicit;
  }
  const fromEnv = process.env["DSH_BIN"];
  if (fromEnv !== void 0 && fromEnv.length > 0 && existsSync2(fromEnv)) return fromEnv;
  const probe = spawnSync("dsh", ["--version"], { stdio: "ignore", windowsHide: true });
  if (probe.error === void 0) return "dsh";
  throw new Error(
    "\u627E\u4E0D\u5230 dsh\u3002\u5B89\u88C5 Node.js \u540E\u8FD0\u884C `npm i -g @deepseek-ai/dsh`\uFF0C\u6216\u7528 --dsh <\u8DEF\u5F84> / $DSH_BIN \u6307\u5B9A\u3002"
  );
}
function selfBin() {
  return process.argv[1] ?? "dshc";
}
function resolveDshLaunch(dshBin) {
  if (process.platform !== "win32" || !/\.cmd$/i.test(dshBin)) {
    return { cmd: dshBin, args: [] };
  }
  let text;
  try {
    text = readFileSync2(dshBin, "utf8");
  } catch {
    return { cmd: dshBin, args: [] };
  }
  const entry = dshEntryFromCmdShim(text, dirname2(dshBin));
  if (entry !== null) {
    return { cmd: process.execPath, args: [entry] };
  }
  return { cmd: dshBin, args: [] };
}
function dshEntryFromCmdShim(text, binDir) {
  const match = /"%~dp0\\([^"]+\.js)"/i.exec(text);
  if (match?.[1] === void 0) return null;
  const entry = resolve2(binDir, match[1].replaceAll("\\", "/"));
  return existsSync2(entry) ? entry : null;
}
function compareVersion(a, b) {
  const pa = a.trim().replace(/^v/, "").split(/[.-]/).map(Number);
  const pb = b.trim().replace(/^v/, "").split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}
function packageRoot() {
  return fileURLToPath(new URL("../..", import.meta.url));
}

// src/cli/profile.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync3, rmSync, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2, resolve as resolve3 } from "node:path";
var COMPANION_PROFILE = "companion";
var BRIDGE_DEP_NAME = "@deepseek-harness-pocket/bridge";
function resolveDshHomeDir() {
  const fromEnv = process.env["DSH_HOME"];
  return resolve3((fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join2(homedir2(), ".dsh")).replace(/^~(?=\/|$)/, homedir2()));
}
function profileDir(profile = COMPANION_PROFILE) {
  return join2(resolveDshHomeDir(), "profiles", profile);
}
function ensureProfileManifest(dir) {
  mkdirSync2(dir, { recursive: true });
  const manifestPath = join2(dir, "package.json");
  if (existsSync3(manifestPath)) {
    try {
      const existing = JSON.parse(readFileSync3(manifestPath, "utf8"));
      const bundles = existing.dsh?.profile?.bundles ?? [];
      if (!bundles.includes("@deepseek-ai/dsh-web-app")) {
        bundles.push("@deepseek-ai/dsh-web-app");
        writeFileSync2(manifestPath, `${JSON.stringify(existing, void 0, 2)}
`);
      }
    } catch {
    }
    return;
  }
  writeFileSync2(
    manifestPath,
    `${JSON.stringify(
      {
        name: "dsh-profile-companion",
        private: true,
        dependencies: {},
        dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"] } }
      },
      void 0,
      2
    )}
`
  );
}
function upsertBridgePatch(dir, config) {
  const patchPath = join2(dir, "cordis.patch.yml");
  const entry = [
    "- insert:",
    `  - id: deepseek-harness-pocket-bridge`,
    `    name: '@deepseek-harness-pocket/bridge'`,
    "    config:",
    "      listen:",
    `        host: ${JSON.stringify(config.host)}`,
    `        port: ${config.port}`,
    "      gateway:",
    `        url: ${JSON.stringify(config.gatewayUrl)}`,
    "        hostKey: ''",
    // 能力档位固定全开（m3：手机端 sessionCreate/artifacts 等主流程能力），
    // 不再作为可配置项——若省略该键，插件默认会回落 m2 反而关功能
    `      caps: "m3"`,
    `      name: ${JSON.stringify(config.workerName)}`,
    `      stateFile: ${JSON.stringify(config.stateFile)}`
  ].join("\n");
  if (!existsSync3(patchPath)) {
    writeFileSync2(patchPath, `# managed by dshc \u2014 companion bridge layer
${entry}
`);
    return;
  }
  const existing = readFileSync3(patchPath, "utf8");
  if (existing.includes("id: deepseek-harness-pocket-bridge")) {
    const blocks = existing.split(/(?=^- )/m);
    const kept = blocks.filter((b) => !b.includes("id: deepseek-harness-pocket-bridge"));
    writeFileSync2(patchPath, `${kept.join("").trimEnd()}
${entry}
`);
  } else {
    writeFileSync2(patchPath, `${existing.trimEnd()}
${entry}
`);
  }
}
function fileSpecPath(spec) {
  const raw = process.platform === "win32" ? spec.replace(/^file:/, "") : spec.startsWith("file:") ? spec.slice("file:".length) : void 0;
  if (raw === void 0) return void 0;
  return resolve3(raw);
}
function migrateStaleBridgeSpec(dir, packageRootPath) {
  const manifestPath = join2(dir, "package.json");
  if (!existsSync3(manifestPath)) return;
  try {
    const manifest = JSON.parse(readFileSync3(manifestPath, "utf8"));
    const spec = manifest.dependencies?.[BRIDGE_DEP_NAME];
    if (spec === void 0) return;
    const pinned = fileSpecPath(spec);
    const wanted = resolve3(packageRootPath);
    if (pinned === void 0 || pinned === wanted) return;
    const nextSpec = process.platform === "win32" ? wanted : `file:${wanted}`;
    manifest.dependencies = { ...manifest.dependencies, [BRIDGE_DEP_NAME]: nextSpec };
    writeFileSync2(manifestPath, `${JSON.stringify(manifest, void 0, 2)}
`);
    rmSync(join2(dir, "pnpm-lock.yaml"), { force: true });
    rmSync(join2(dir, "node_modules", BRIDGE_DEP_NAME), { recursive: true, force: true });
  } catch {
  }
}
function installBridgePackage(dir, dshBin, packageRootPath) {
  ensureProfileManifest(dir);
  migrateStaleBridgeSpec(dir, packageRootPath);
  const spec = process.platform === "win32" ? packageRootPath : `file:${packageRootPath}`;
  const launch = resolveDshLaunch(dshBin);
  const result = spawnSync2(launch.cmd, [...launch.args, "plugin", "--profile", COMPANION_PROFILE, "add", spec], {
    stdio: "inherit",
    windowsHide: true
  });
  if (result.error !== void 0) {
    throw new Error(`dsh plugin add \u65E0\u6CD5\u542F\u52A8\uFF1A${result.error.message}\uFF08dsh bin: ${dshBin}\uFF09`);
  }
  if (result.status !== 0) {
    throw new Error(`dsh plugin add \u5931\u8D25\uFF08exit ${result.status}\uFF09\uFF1Bdsh bin: ${dshBin}`);
  }
}

// src/cli/supervisor.ts
import { spawn } from "node:child_process";
import { appendFileSync, existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync4, rmSync as rmSync2, writeFileSync as writeFileSync3 } from "node:fs";
import { createServer } from "node:net";
import { dirname as dirname3 } from "node:path";
var STOP_FLAG = "dshc.stop-flag";
var RESUME_FLAG = "dshc.resume-flag";
var RUN_INFO = "run.json";
var START_LOCK = "dshc.start.lock";
var QUICK_FAIL_WINDOW_MS = 15e3;
var QUICK_FAIL_LIMIT = 3;
var STANDBY_POLL_MS = 2e3;
var STANDBY_PROBE_EVERY = 30;
var DSH_WEB_URL_LINE = /^dsh web: (https?:\/\/127\.0\.0\.1:\d+\/?(?:\?token=\S+)?)\b/u;
function mergeRunInfo(patch) {
  const file = runInfoFile();
  if (!existsSync4(file)) return;
  try {
    const stored = JSON.parse(readFileSync4(file, "utf8"));
    for (const [key, value] of Object.entries(patch)) {
      if (value === void 0) delete stored[key];
      else stored[key] = value;
    }
    writeFileSync3(file, `${JSON.stringify(stored, void 0, 2)}
`);
  } catch {
  }
}
function writeWebUrl(url) {
  mergeRunInfo({ webUrl: url });
}
function extractWebUrl(text) {
  for (const line of text.split("\n")) {
    const match = DSH_WEB_URL_LINE.exec(line.trim());
    if (match?.[1] !== void 0) return match[1];
  }
  return void 0;
}
function dshcDir() {
  const dir = `${process.env["HOME"] ?? "."}/.deepseek-harness-pocket`;
  mkdirSync3(dir, { recursive: true });
  return dir;
}
function logFile() {
  return `${dshcDir()}/dshc.log`;
}
function pidFile() {
  return `${dshcDir()}/dshc.pid`;
}
function runInfoFile() {
  return `${dshcDir()}/${RUN_INFO}`;
}
function resumeFlagFile() {
  return `${dshcDir()}/${RESUME_FLAG}`;
}
function startLockFile() {
  return `${dshcDir()}/${START_LOCK}`;
}
function readRunInfo() {
  const file = runInfoFile();
  if (!existsSync4(file)) return void 0;
  try {
    return JSON.parse(readFileSync4(file, "utf8"));
  } catch {
    return void 0;
  }
}
function isRunning() {
  if (!existsSync4(pidFile())) return null;
  const pid = Number.parseInt(readFileSync4(pidFile(), "utf8").trim(), 10);
  if (!Number.isInteger(pid)) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}
function readStartLockHolder() {
  try {
    const parsed = JSON.parse(readFileSync4(startLockFile(), "utf8"));
    const pid = typeof parsed.pid === "number" ? parsed.pid : Number.NaN;
    return Number.isInteger(pid) ? pid : void 0;
  } catch {
    return void 0;
  }
}
function acquireStartLock() {
  const file = startLockFile();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      writeFileSync3(file, `${JSON.stringify({ pid: process.pid, at: Date.now() })}
`, { flag: "wx" });
      return { ok: true };
    } catch {
      const holderPid2 = readStartLockHolder();
      if (holderPid2 === void 0) {
        rmSync2(file, { force: true });
        continue;
      }
      try {
        process.kill(holderPid2, 0);
        return { ok: false, holderPid: holderPid2 };
      } catch {
        rmSync2(file, { force: true });
      }
    }
  }
  const holderPid = readStartLockHolder();
  return holderPid !== void 0 ? { ok: false, holderPid } : { ok: false };
}
function releaseStartLock() {
  rmSync2(startLockFile(), { force: true });
}
function log(line) {
  const file = logFile();
  mkdirSync3(dirname3(file), { recursive: true });
  appendFileSync(file, `${(/* @__PURE__ */ new Date()).toISOString()} ${line}
`);
}
var sleep = (ms) => new Promise((resolve4) => setTimeout(resolve4, ms));
function portFree(port) {
  return new Promise((resolve4) => {
    const server = createServer();
    server.once("error", () => resolve4(false));
    server.once("listening", () => server.close(() => resolve4(true)));
    server.listen(port, "127.0.0.1");
  });
}
function classifyGiveUp(stderrTail) {
  const lastLine = stderrTail.trim().split("\n").pop();
  const detail = lastLine !== void 0 && lastLine.length > 0 ? lastLine.slice(0, 200) : void 0;
  const eaddrinuseLine = stderrTail.split("\n").find((l) => l.includes("EADDRINUSE"));
  if (eaddrinuseLine !== void 0) {
    const nums = eaddrinuseLine.match(/\d+/g);
    const port = nums !== null && nums.length > 0 ? Number.parseInt(nums[nums.length - 1], 10) : Number.NaN;
    return Number.isInteger(port) ? { reason: "port_in_use", port, detail, since: Date.now() } : { reason: "port_in_use", detail, since: Date.now() };
  }
  return detail !== void 0 ? { reason: "crash_loop", detail, since: Date.now() } : { reason: "crash_loop", since: Date.now() };
}
function describeGiveUp(info) {
  switch (info.reason) {
    case "port_in_use":
      return `\u7AEF\u53E3 ${info.port ?? "?"} \u5DF2\u88AB\u5360\u7528\uFF08\u53EF\u80FD\u662F\u53E6\u4E00\u4E2A dsh \u5B9E\u4F8B\uFF09`;
    case "spawn_failed":
      return `dsh \u65E0\u6CD5\u542F\u52A8\uFF08${info.detail ?? "\u672A\u77E5\u539F\u56E0"}\uFF09`;
    case "crash_loop":
      return "dsh \u8FDE\u7EED\u5F02\u5E38\u9000\u51FA";
  }
}
async function standbyWait(giveUp, dshBin, isStopping) {
  let ticks = 0;
  while (!isStopping()) {
    if (existsSync4(resumeFlagFile())) {
      rmSync2(resumeFlagFile(), { force: true });
      return true;
    }
    ticks += 1;
    if (ticks % STANDBY_PROBE_EVERY === 0) {
      if (giveUp.reason === "port_in_use" && giveUp.port !== void 0 && await portFree(giveUp.port)) return true;
      if (giveUp.reason === "spawn_failed" && existsSync4(dshBin)) return true;
    }
    await sleep(STANDBY_POLL_MS);
  }
  return false;
}
async function supervise(dshBin, args, env, info) {
  const other = isRunning();
  if (other !== null) {
    log(`supervise: \u5DF2\u6709\u5B9E\u4F8B (pid ${other})\uFF0C\u672C\u8FDB\u7A0B\u8BA9\u4F4D\u9000\u51FA`);
    releaseStartLock();
    process.exit(0);
  }
  writeFileSync3(pidFile(), `${process.pid}
`);
  writeFileSync3(runInfoFile(), `${JSON.stringify({ ...info, pid: process.pid, startedAt: Date.now() }, void 0, 2)}
`);
  releaseStartLock();
  log(`supervisor pid=${process.pid} bridge=${info.bridgeVersion ?? "(\u65E7\u7248\u672A\u8BB0\u5F55)"} dsh=${info.dshVersion || "(\u672A\u77E5)"}`);
  let stopping = false;
  let child;
  const removeOwnStateFiles = () => {
    try {
      if (Number.parseInt(readFileSync4(pidFile(), "utf8").trim(), 10) === process.pid) rmSync2(pidFile(), { force: true });
    } catch {
    }
    if (readRunInfo()?.pid === process.pid) rmSync2(runInfoFile(), { force: true });
  };
  const stop = (signal) => {
    if (stopping) return;
    stopping = true;
    log(`dshc received ${signal}, stopping dsh child`);
    if (child !== void 0 && child.exitCode === null) {
      child.kill("SIGTERM");
      setTimeout(() => {
        if (child !== void 0 && child.exitCode === null) child.kill("SIGKILL");
      }, 5e3);
    }
    removeOwnStateFiles();
    setTimeout(() => process.exit(0), 5500);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  const flagTimer = setInterval(() => {
    if (existsSync4(`${dshcDir()}/${STOP_FLAG}`)) stop("SIGTERM");
  }, 2e3);
  flagTimer.unref();
  let backoffMs = 1e3;
  let quickFails = 0;
  let giveUp;
  while (!stopping) {
    if (giveUp !== void 0) {
      if (!await standbyWait(giveUp, dshBin, () => stopping)) break;
      giveUp = void 0;
      mergeRunInfo({ supervisor: "active", giveUp: void 0 });
      log("dshc \u5F85\u673A\u89E3\u9664\uFF0C\u6062\u590D\u81EA\u52A8\u91CD\u542F");
      process.stdout.write("[dshc] \u5F85\u673A\u89E3\u9664\uFF0C\u6062\u590D\u81EA\u52A8\u91CD\u542F\n");
      backoffMs = 1e3;
      quickFails = 0;
    }
    rmSync2(`${dshcDir()}/${STOP_FLAG}`, { force: true });
    log(`spawning ${dshBin} ${args.join(" ")}`);
    process.stdout.write(`[dshc] starting: ${dshBin} ${args.join(" ")}
`);
    const launch = resolveDshLaunch(dshBin);
    child = spawn(launch.cmd, [...launch.args, ...args], { env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    const startedAt = Date.now();
    let lineBuffer = "";
    let stderrTail = "";
    child.stdout?.on("data", (chunk) => {
      const text = lineBuffer + chunk.toString();
      const lines = text.split("\n");
      lineBuffer = lines.pop() ?? "";
      process.stdout.write(chunk);
      for (const line of lines) {
        log(`dsh| ${line.trimEnd()}`);
        const url = extractWebUrl(line);
        if (url !== void 0) writeWebUrl(url);
      }
    });
    child.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk);
      stderrTail = `${stderrTail}${chunk.toString()}`.slice(-2e3);
      log(`dsh! ${chunk.toString().trimEnd()}`);
    });
    const outcome = await new Promise(
      (resolve4) => {
        child.once("error", (error) => resolve4({ kind: "error", message: error.message }));
        child.once("exit", (code) => resolve4({ kind: "exit", code }));
      }
    );
    if (stopping) break;
    writeWebUrl(void 0);
    if (outcome.kind === "error") {
      giveUp = { reason: "spawn_failed", detail: outcome.message, since: Date.now() };
      log(`dsh spawn \u5931\u8D25\uFF0C\u8FDB\u5165\u5F85\u673A\uFF1A${describeGiveUp(giveUp)}`);
      process.stdout.write(`[dshc] spawn \u5931\u8D25\uFF0C\u8FDB\u5165\u5F85\u673A\uFF1A${describeGiveUp(giveUp)}
`);
      mergeRunInfo({ supervisor: "standby", giveUp });
      continue;
    }
    log(`dsh exited with code ${outcome.code}`);
    process.stdout.write(`[dshc] dsh exited (code ${outcome.code}); restart in ${backoffMs}ms
`);
    if (Date.now() - startedAt >= QUICK_FAIL_WINDOW_MS || outcome.code === 0) quickFails = 0;
    else quickFails += 1;
    if (quickFails >= QUICK_FAIL_LIMIT) {
      giveUp = classifyGiveUp(stderrTail);
      quickFails = 0;
      backoffMs = 1e3;
      log(`dshc \u8FDB\u5165\u5F85\u673A\uFF1A${describeGiveUp(giveUp)}\uFF1B\u5DF2\u505C\u6B62\u81EA\u52A8\u91CD\u542F`);
      process.stdout.write(`[dshc] \u8FDB\u5165\u5F85\u673A\uFF1A${describeGiveUp(giveUp)}\uFF1B\u5DF2\u505C\u6B62\u81EA\u52A8\u91CD\u542F
`);
      mergeRunInfo({ supervisor: "standby", giveUp });
      continue;
    }
    await sleep(backoffMs);
    backoffMs = outcome.code === 0 ? Math.max(1e3, Math.floor(backoffMs / 2)) : Math.min(backoffMs * 2, 3e4);
  }
  clearInterval(flagTimer);
  removeOwnStateFiles();
  process.exit(0);
}
function detachSpawn(extraArgs) {
  const child = spawn(process.execPath, [selfBin(), "start", ...extraArgs], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true
  });
  child.unref();
  return child.pid ?? -1;
}
function requestStop() {
  writeFileSync3(`${dshcDir()}/${STOP_FLAG}`, "1\n");
}
function requestResume() {
  writeFileSync3(resumeFlagFile(), "1\n");
}

// src/cli/autostart.ts
import { chmodSync, existsSync as existsSync5, mkdirSync as mkdirSync4, rmSync as rmSync3, writeFileSync as writeFileSync4 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { spawnSync as spawnSync3 } from "node:child_process";
var LABEL = "top.rwecho.deepseek-harness-pocket.worker";
function autostartInstall(gatewayUrl) {
  if (process.platform === "darwin") return installLaunchd(gatewayUrl);
  if (process.platform === "linux") return installSystemd(gatewayUrl);
  return "Windows \u81EA\u542F\u6682\u672A\u81EA\u52A8\u5316\uFF1A\u8BF7\u5C06 `dshc start` \u52A0\u5165\u542F\u52A8\u9879\uFF08shell:startup\uFF09";
}
function autostartUninstall() {
  if (process.platform === "darwin") {
    const target = `${homedir3()}/Library/LaunchAgents/${LABEL}.plist`;
    spawnSync3("launchctl", ["unload", target], { stdio: "ignore" });
    rmSync3(target, { force: true });
    return `\u5DF2\u79FB\u9664 launchd LaunchAgent (${target})`;
  }
  if (process.platform === "linux") {
    const target = `${homedir3()}/.config/systemd/user/deepseek-harness-pocket.service`;
    spawnSync3("systemctl", ["--user", "disable", "--now", "deepseek-harness-pocket.service"], { stdio: "ignore" });
    rmSync3(target, { force: true });
    spawnSync3("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    return `\u5DF2\u79FB\u9664 systemd user \u670D\u52A1 (${target})`;
  }
  return "Windows\uFF1A\u8BF7\u624B\u52A8\u79FB\u9664\u542F\u52A8\u9879";
}
function commandArgs(gatewayUrl) {
  const args = [selfBin(), "start"];
  if (gatewayUrl.length > 0) args.push("--gateway", gatewayUrl);
  return args;
}
function installLaunchd(gatewayUrl) {
  const dir = `${homedir3()}/Library/LaunchAgents`;
  mkdirSync4(dir, { recursive: true });
  const target = `${dir}/${LABEL}.plist`;
  const log2 = `${homedir3()}/.deepseek-harness-pocket/launchd.log`;
  const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${commandArgs(gatewayUrl).map((a) => `    <string>${a.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</string>`).join("\n")}
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${log2}</string>
  <key>StandardErrorPath</key><string>${log2}</string>
</dict>
</plist>
`;
  writeFileSync4(target, plist);
  spawnSync3("launchctl", ["unload", target], { stdio: "ignore" });
  const loaded = spawnSync3("launchctl", ["load", target]);
  if (loaded.status !== 0) return `\u5DF2\u5199\u5165 ${target}\uFF0C\u4F46 launchctl load \u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u52A0\u8F7D`;
  return `\u5DF2\u5B89\u88C5 launchd LaunchAgent \u5E76\u52A0\u8F7D\uFF08${target}\uFF09\uFF0C\u767B\u5F55\u5373\u81EA\u52A8\u542F\u52A8 dshc`;
}
function installSystemd(gatewayUrl) {
  const dir = `${homedir3()}/.config/systemd/user`;
  mkdirSync4(dir, { recursive: true });
  const target = `${dir}/deepseek-harness-pocket.service`;
  const unit = `[Unit]
Description=\u638C\u9CB8 DSH Pocket Worker (dshc)
After=network-online.target

[Service]
ExecStart=${commandArgs(gatewayUrl).map((a) => a.includes(" ") ? `"${a}"` : a).join(" ")}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`;
  writeFileSync4(target, unit);
  spawnSync3("systemctl", ["--user", "daemon-reload"]);
  const enabled = spawnSync3("systemctl", ["--user", "enable", "--now", "deepseek-harness-pocket.service"]);
  if (enabled.status !== 0) return `\u5DF2\u5199\u5165 ${target}\uFF0C\u4F46 enable \u5931\u8D25\uFF0C\u8BF7\u624B\u52A8 systemctl --user enable --now deepseek-harness-pocket`;
  return `\u5DF2\u5B89\u88C5\u5E76\u542F\u52A8 systemd user \u670D\u52A1\uFF08deepseek-harness-pocket.service\uFF09`;
}

// src/cli/index.ts
function firstLanIpv4() {
  const ifaces = networkInterfaces();
  for (const list of Object.values(ifaces)) {
    for (const info of list ?? []) {
      if (info.family === "IPv4" && !info.internal) return info.address;
    }
  }
  return null;
}
function parseArgs(argv) {
  const options = {
    gateway: process.env["DSHC_GATEWAY"] ?? "",
    port: 3780,
    host: "0.0.0.0",
    name: "",
    dsh: void 0,
    detached: false,
    json: false
  };
  const args = [...argv];
  const command = args.shift() ?? "help";
  while (args.length > 0) {
    const flag = args.shift();
    const value = () => {
      const v = args.shift();
      if (v === void 0) throw new Error(`\u53C2\u6570 ${flag} \u9700\u8981\u503C`);
      return v;
    };
    switch (flag) {
      case "--gateway":
        options.gateway = value();
        break;
      case "--port":
        options.port = Number.parseInt(value(), 10);
        break;
      case "--host":
        options.host = value();
        break;
      case "--name":
        options.name = value();
        break;
      case "--dsh":
        options.dsh = value();
        break;
      case "--detached":
        options.detached = true;
        break;
      case "--json":
        options.json = true;
        break;
      default:
        throw new Error(`\u672A\u77E5\u53C2\u6570 ${flag}`);
    }
  }
  return { command, options };
}
function probeDshVersion(dshBin) {
  const launch = resolveDshLaunch(dshBin);
  const result = spawnSync4(launch.cmd, [...launch.args, "--version"], { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8", windowsHide: true });
  if (result.status !== 0 || typeof result.stdout !== "string") return "";
  return result.stdout.trim().split("\n")[0] ?? "";
}
function bridgeVersion() {
  try {
    const raw = JSON.parse(
      readFileSync5(fileURLToPath2(new URL("../../package.json", import.meta.url)), "utf8")
    );
    return raw.version ?? "";
  } catch {
    return "";
  }
}
var sleep2 = (ms) => new Promise((resolve4) => setTimeout(resolve4, ms));
async function acquireStartLockWithWait() {
  const deadline = Date.now() + 3e4;
  for (; ; ) {
    const lock = acquireStartLock();
    if (lock.ok) return true;
    const pid = isRunning();
    if (pid !== null) {
      process.stdout.write(`[dshc] \u5DF2\u5728\u8FD0\u884C (pid ${pid})\uFF1B\u5982\u9700\u91CD\u542F\u5148 dshc stop
`);
      process.exit(0);
    }
    if (Date.now() >= deadline) return false;
    await sleep2(500);
  }
}
async function startSupervised(options, stateFile) {
  const dshBin = resolveDshBin(options.dsh);
  const dir = profileDir(COMPANION_PROFILE);
  process.stdout.write(`[dshc] \u51C6\u5907 companion profile: ${dir}
`);
  installBridgePackage(dir, dshBin, packageRoot());
  const name = options.name.length > 0 ? options.name : hostname();
  upsertBridgePatch(dir, {
    gatewayUrl: options.gateway,
    port: options.port,
    host: options.host,
    workerName: name,
    stateFile
  });
  if (options.detached) {
    const args = [
      "--gateway",
      options.gateway,
      "--port",
      String(options.port),
      "--host",
      options.host
    ];
    if (options.name.length > 0) args.push("--name", options.name);
    if (options.dsh !== void 0) args.push("--dsh", options.dsh);
    const pid = detachSpawn(args);
    process.stdout.write(`[dshc] \u540E\u53F0\u8FD0\u884C\u4E2D (pid ${pid})\uFF0C\u65E5\u5FD7: ${logFile()}
`);
    process.exit(0);
  }
  const dshVersion = probeDshVersion(dshBin);
  const dshArgs = ["--profile", COMPANION_PROFILE];
  if (compareVersion(dshVersion, "0.1.1") >= 0) dshArgs.push("--no-open");
  await supervise(dshBin, dshArgs, { ...process.env }, {
    dshBin,
    dshVersion,
    bridgeVersion: bridgeVersion(),
    gatewayUrl: options.gateway,
    port: options.port,
    host: options.host,
    name
  });
}
async function main() {
  const { command, options } = parseArgs(process.argv.slice(2));
  const stateFile = defaultStateFile();
  switch (command) {
    case "start": {
      const running = isRunning();
      if (running !== null) {
        process.stdout.write(`[dshc] \u5DF2\u5728\u8FD0\u884C (pid ${running})\uFF1B\u5982\u9700\u91CD\u542F\u5148 dshc stop
`);
        process.exit(0);
      }
      if (!await acquireStartLockWithWait()) {
        process.stderr.write("[dshc] \u53E6\u4E00\u4E2A dshc start \u6B63\u5728\u8FDB\u884C\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\n");
        process.exit(75);
      }
      try {
        await startSupervised(options, stateFile);
      } catch (error) {
        releaseStartLock();
        throw error;
      }
      break;
    }
    case "resume": {
      requestResume();
      if (options.json) process.stdout.write(`${JSON.stringify({ resumed: true })}
`);
      else process.stdout.write("[dshc] \u5DF2\u8BF7\u6C42\u6062\u590D\uFF08\u5F85\u673A\u4E2D\u7684 supervisor \u4F1A\u5728\u6570\u79D2\u5185\u91CD\u8BD5\u542F\u52A8\uFF09\n");
      break;
    }
    case "stop": {
      const pid = isRunning();
      if (pid === null) {
        if (options.json) process.stdout.write(`${JSON.stringify({ stopped: false, running: false })}
`);
        else process.stdout.write("[dshc] \u672A\u5728\u8FD0\u884C\n");
        process.exit(0);
      }
      requestStop();
      if (options.json) process.stdout.write(`${JSON.stringify({ stopped: true, running: true, pid })}
`);
      else process.stdout.write(`[dshc] \u5DF2\u8BF7\u6C42\u505C\u6B62 (pid ${pid})\uFF1B\u82E5 5 \u79D2\u672A\u9000\u51FA: kill ${pid}
`);
      break;
    }
    case "status": {
      const pid = isRunning();
      const run = readRunInfo();
      if (options.json) {
        process.stdout.write(`${JSON.stringify({
          running: pid !== null,
          pid: pid ?? void 0,
          standby: run?.supervisor === "standby",
          supervisor: run?.supervisor ?? "active",
          giveUp: run?.giveUp ?? void 0,
          run: run ?? void 0,
          profileDir: profileDir(COMPANION_PROFILE),
          stateFile,
          pidFile: pidFile(),
          logFile: logFile(),
          home: dshcDir()
        }, void 0, 2)}
`);
        break;
      }
      process.stdout.write(
        pid === null ? "dshc: \u672A\u8FD0\u884C\n" : run?.supervisor === "standby" ? `dshc: \u5F85\u673A\u4E2D (pid ${pid})\u2014\u2014${describeGiveUp(run.giveUp ?? { reason: "crash_loop", since: 0 })}\uFF1Bdshc resume \u53EF\u624B\u52A8\u6062\u590D
` : `dshc: \u8FD0\u884C\u4E2D (pid ${pid})\uFF0C\u65E5\u5FD7 ${logFile()}
`
      );
      process.stdout.write(`\u72B6\u6001\u6587\u4EF6: ${stateFile}
pid \u6587\u4EF6: ${pidFile()}
home: ${dshcDir()}
`);
      break;
    }
    case "qr": {
      const state = loadBridgeState(stateFile);
      if (state === void 0) {
        process.stdout.write("[dshc] \u65E0\u6CD5\u8BFB\u53D6/\u521B\u5EFA\u72B6\u6001\u6587\u4EF6\uFF0C\u8BF7\u5148 dshc start\n");
        process.exit(1);
      }
      const name = options.name.length > 0 ? options.name : hostname();
      const lanIp = firstLanIpv4();
      const payload = encodePairQr({
        code: state.pairingCode,
        name,
        ...lanIp !== null ? { host: lanIp } : {},
        port: options.port,
        token: state.pairingToken,
        ...options.gateway.length > 0 ? { gatewayUrl: options.gateway } : {}
      });
      if (options.json) {
        process.stdout.write(`${JSON.stringify({
          payload,
          code: state.pairingCode,
          name,
          host: lanIp ?? void 0,
          port: options.port,
          gatewayUrl: options.gateway.length > 0 ? options.gateway : void 0,
          fingerprint: state.fingerprint
        }, void 0, 2)}
`);
        break;
      }
      process.stdout.write(`[dshc] \u626B\u63CF\u4E0B\u65B9\u4E8C\u7EF4\u7801\uFF0C\u628A ${name} \u7ED1\u5B9A\u5230\u624B\u673A\u8D26\u53F7

`);
      qrcode.generate(payload, { small: true });
      process.stdout.write(`
\u914D\u5BF9\u7801: ${state.pairingCode}${lanIp !== null ? `    \u5C40\u57DF\u7F51: ${lanIp}:${options.port}` : ""}
`);
      process.stdout.write("\uFF08\u76F8\u673A\u626B\u4E0D\u52A8\u65F6\uFF0C\u53EF\u5728\u624B\u673A\u300C\u6DFB\u52A0\u7535\u8111\u300D\u91CC\u624B\u8F93\u914D\u5BF9\u7801\uFF09\n");
      break;
    }
    case "install": {
      process.stdout.write(`${autostartInstall(options.gateway)}
`);
      break;
    }
    case "uninstall": {
      process.stdout.write(`${autostartUninstall()}
`);
      break;
    }
    default:
      process.stdout.write(
        [
          "dshc \u2014 \u638C\u9CB8 DSH Pocket Worker",
          "",
          "\u7528\u6CD5: dshc <command> [options]",
          "",
          "\u547D\u4EE4:",
          "  install [--gateway wss://\u2026]   \u5B89\u88C5\u5F00\u673A\u81EA\u542F\uFF08\u5E76\u542F\u52A8\uFF09",
          "  uninstall                     \u79FB\u9664\u81EA\u542F",
          "  start [--gateway \u2026] [--port 3780] [--detached]",
          "                                \u62C9\u8D77\u5E76\u5B88\u62A4 dsh\uFF08\u624B\u673A\u7AEF\u7ECF\u8D26\u53F7\u767B\u5F55\u7ED1\u5B9A\uFF09",
          "  stop / status [--json]",
          "  resume                        \u6062\u590D\u5F85\u673A\u4E2D\u7684 worker\uFF08\u91CD\u8BD5\u542F\u52A8\uFF09",
          "  qr [--json]                   \u6253\u5370\u914D\u5BF9\u4E8C\u7EF4\u7801\uFF08\u624B\u673A\u626B\u7801\u7ED1\u5B9A\uFF09"
        ].join("\n")
      );
      if (command !== "help") process.exit(64);
  }
}
void main().catch((error) => {
  process.stderr.write(`dshc: ${error instanceof Error ? error.message : String(error)}
`);
  process.exit(1);
});
