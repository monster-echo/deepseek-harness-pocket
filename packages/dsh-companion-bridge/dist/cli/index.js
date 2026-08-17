#!/usr/bin/env node

// src/cli/index.ts
import { hostname, networkInterfaces } from "node:os";

// src/plugin/state.ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
function defaultStateFile() {
  return join(homedir(), ".dsh-companion", "bridge-state.json");
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
function rotatePairing(state, file) {
  const code = String(1e5 + randomBytes(4).readUInt32BE(0) % 9e5);
  const next = {
    ...state,
    pairingToken: `pt_${b64url(randomBytes(24))}`,
    pairingCode: code
  };
  saveBridgeState(resolve(file.replace(/^~(?=\/|$)/, homedir())), next);
  return next;
}
function saveBridgeState(path, state) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(state, void 0, 2)}
`, { mode: 384 });
}

// src/cli/qr.ts
import qrcodeTerminal from "qrcode-terminal";
function printPairing(payload) {
  const text = JSON.stringify(payload);
  process.stdout.write("\n\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510\n");
  process.stdout.write("\u2502  DSH Companion \u914D\u5BF9                         \u2502\n");
  process.stdout.write("\u2502  \u6253\u5F00\u624B\u673A App \u2192 \u626B\u7801\uFF0C\u6216\u624B\u52A8\u8F93\u5165\u914D\u5BF9\u7801       \u2502\n");
  process.stdout.write("\u251C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2524\n");
  qrcodeTerminal.generate(text, { small: true }, (qr) => process.stdout.write(qr));
  process.stdout.write(`  \u914D\u5BF9\u7801   ${payload.code}
`);
  process.stdout.write(`  Gateway  ${payload.gatewayUrl}
`);
  if (payload.lanUrl !== void 0) process.stdout.write(`  \u76F4\u8FDE     ${payload.lanUrl}
`);
  process.stdout.write(`  \u4E3B\u673A\u6307\u7EB9 ${payload.fingerprint}
`);
  process.stdout.write("\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518\n\n");
}

// src/cli/runtime.ts
import { spawnSync } from "node:child_process";
import { existsSync as existsSync2 } from "node:fs";
function resolveDshBin(explicit) {
  if (explicit !== void 0 && explicit.length > 0) {
    if (!existsSync2(explicit)) throw new Error(`\u6307\u5B9A\u7684 dsh \u4E0D\u5B58\u5728: ${explicit}`);
    return explicit;
  }
  const fromEnv = process.env["DSH_BIN"];
  if (fromEnv !== void 0 && fromEnv.length > 0 && existsSync2(fromEnv)) return fromEnv;
  const probe = spawnSync("dsh", ["--version"], { stdio: "ignore" });
  if (probe.error === void 0) return "dsh";
  throw new Error(
    "\u627E\u4E0D\u5230 dsh\u3002\u5B89\u88C5 Node.js \u540E\u8FD0\u884C `npm i -g @deepseek-ai/dsh`\uFF0C\u6216\u7528 --dsh <\u8DEF\u5F84> / $DSH_BIN \u6307\u5B9A\u3002"
  );
}
function selfBin() {
  return process.argv[1] ?? "dshc";
}
function packageRoot() {
  return new URL("../..", import.meta.url).pathname;
}

// src/cli/profile.ts
import { spawnSync as spawnSync2 } from "node:child_process";
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync2, writeFileSync as writeFileSync2 } from "node:fs";
import { homedir as homedir2 } from "node:os";
import { join as join2, resolve as resolve2 } from "node:path";
var COMPANION_PROFILE = "companion";
function resolveDshHomeDir() {
  const fromEnv = process.env["DSH_HOME"];
  return resolve2((fromEnv !== void 0 && fromEnv.trim().length > 0 ? fromEnv : join2(homedir2(), ".dsh")).replace(/^~(?=\/|$)/, homedir2()));
}
function profileDir(profile = COMPANION_PROFILE) {
  return join2(resolveDshHomeDir(), "profiles", profile);
}
function ensureProfileManifest(dir) {
  mkdirSync2(dir, { recursive: true });
  const manifestPath = join2(dir, "package.json");
  if (existsSync3(manifestPath)) {
    try {
      const existing = JSON.parse(readFileSync2(manifestPath, "utf8"));
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
    `  - id: dsh-companion-bridge`,
    `    name: '@dsh-companion/bridge'`,
    "    config:",
    "      listen:",
    `        host: ${JSON.stringify(config.host)}`,
    `        port: ${config.port}`,
    "      gateway:",
    `        url: ${JSON.stringify(config.gatewayUrl)}`,
    "        hostKey: ''",
    `      caps: ${JSON.stringify(config.caps)}`,
    `      name: ${JSON.stringify(config.workerName)}`,
    `      stateFile: ${JSON.stringify(config.stateFile)}`
  ].join("\n");
  if (!existsSync3(patchPath)) {
    writeFileSync2(patchPath, `# managed by dshc \u2014 companion bridge layer
${entry}
`);
    return;
  }
  const existing = readFileSync2(patchPath, "utf8");
  if (existing.includes("id: dsh-companion-bridge")) {
    const blocks = existing.split(/(?=^- )/m);
    const kept = blocks.filter((b) => !b.includes("id: dsh-companion-bridge"));
    writeFileSync2(patchPath, `${kept.join("").trimEnd()}
${entry}
`);
  } else {
    writeFileSync2(patchPath, `${existing.trimEnd()}
${entry}
`);
  }
}
function installBridgePackage(dir, dshBin, packageRootPath) {
  ensureProfileManifest(dir);
  const spec = process.platform === "win32" ? packageRootPath : `file:${packageRootPath}`;
  const result = spawnSync2(dshBin, ["plugin", "--profile", COMPANION_PROFILE, "add", spec], {
    stdio: "inherit"
  });
  if (result.status !== 0) {
    throw new Error(`dsh plugin add \u5931\u8D25\uFF08exit ${result.status}\uFF09`);
  }
}

// src/cli/supervisor.ts
import { spawn } from "node:child_process";
import { appendFileSync, existsSync as existsSync4, mkdirSync as mkdirSync3, readFileSync as readFileSync3, rmSync, writeFileSync as writeFileSync3 } from "node:fs";
import { dirname as dirname2 } from "node:path";
var STOP_FLAG = "dshc.stop-flag";
function dshcDir() {
  const dir = `${process.env["HOME"] ?? "."}/.dsh-companion`;
  mkdirSync3(dir, { recursive: true });
  return dir;
}
function logFile() {
  return `${dshcDir()}/dshc.log`;
}
function pidFile() {
  return `${dshcDir()}/dshc.pid`;
}
function isRunning() {
  if (!existsSync4(pidFile())) return null;
  const pid = Number.parseInt(readFileSync3(pidFile(), "utf8").trim(), 10);
  if (!Number.isInteger(pid)) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}
function log(line) {
  const file = logFile();
  mkdirSync3(dirname2(file), { recursive: true });
  appendFileSync(file, `${(/* @__PURE__ */ new Date()).toISOString()} ${line}
`);
}
var sleep = (ms) => new Promise((resolve3) => setTimeout(resolve3, ms));
async function supervise(dshBin, args, env) {
  writeFileSync3(pidFile(), `${process.pid}
`);
  let stopping = false;
  let child;
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
    rmSync(pidFile(), { force: true });
    setTimeout(() => process.exit(0), 5500);
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
  const flagTimer = setInterval(() => {
    if (existsSync4(`${dshcDir()}/${STOP_FLAG}`)) stop("SIGTERM");
  }, 2e3);
  flagTimer.unref();
  let backoffMs = 1e3;
  while (!stopping) {
    rmSync(`${dshcDir()}/${STOP_FLAG}`, { force: true });
    log(`spawning ${dshBin} ${args.join(" ")}`);
    process.stdout.write(`[dshc] starting: ${dshBin} ${args.join(" ")}
`);
    child = spawn(dshBin, [...args], { env, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout?.on("data", (chunk) => {
      process.stdout.write(chunk);
      log(`dsh| ${chunk.toString().trimEnd()}`);
    });
    child.stderr?.on("data", (chunk) => {
      process.stderr.write(chunk);
      log(`dsh! ${chunk.toString().trimEnd()}`);
    });
    const code = await new Promise((resolve3) => child.once("exit", resolve3));
    if (stopping) break;
    log(`dsh exited with code ${code}`);
    process.stdout.write(`[dshc] dsh exited (code ${code}); restart in ${backoffMs}ms
`);
    await sleep(backoffMs);
    backoffMs = code === 0 ? Math.max(1e3, Math.floor(backoffMs / 2)) : Math.min(backoffMs * 2, 3e4);
  }
  clearInterval(flagTimer);
  rmSync(pidFile(), { force: true });
  process.exit(0);
}
function detachSpawn(extraArgs) {
  const child = spawn(process.execPath, [selfBin(), "start", ...extraArgs], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"]
  });
  child.unref();
  return child.pid ?? -1;
}
function requestStop() {
  writeFileSync3(`${dshcDir()}/${STOP_FLAG}`, "1\n");
}

// src/cli/autostart.ts
import { chmodSync, existsSync as existsSync5, mkdirSync as mkdirSync4, rmSync as rmSync2, writeFileSync as writeFileSync4 } from "node:fs";
import { homedir as homedir3 } from "node:os";
import { spawnSync as spawnSync3 } from "node:child_process";
var LABEL = "com.rwecho.dshcompanion.worker";
function autostartInstall(gatewayUrl) {
  if (process.platform === "darwin") return installLaunchd(gatewayUrl);
  if (process.platform === "linux") return installSystemd(gatewayUrl);
  return "Windows \u81EA\u542F\u6682\u672A\u81EA\u52A8\u5316\uFF1A\u8BF7\u5C06 `dshc start` \u52A0\u5165\u542F\u52A8\u9879\uFF08shell:startup\uFF09";
}
function autostartUninstall() {
  if (process.platform === "darwin") {
    const target = `${homedir3()}/Library/LaunchAgents/${LABEL}.plist`;
    spawnSync3("launchctl", ["unload", target], { stdio: "ignore" });
    rmSync2(target, { force: true });
    return `\u5DF2\u79FB\u9664 launchd LaunchAgent (${target})`;
  }
  if (process.platform === "linux") {
    const target = `${homedir3()}/.config/systemd/user/dsh-companion.service`;
    spawnSync3("systemctl", ["--user", "disable", "--now", "dsh-companion.service"], { stdio: "ignore" });
    rmSync2(target, { force: true });
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
  const log2 = `${homedir3()}/.dsh-companion/launchd.log`;
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
  const target = `${dir}/dsh-companion.service`;
  const unit = `[Unit]
Description=DSH Companion Worker (dshc)
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
  const enabled = spawnSync3("systemctl", ["--user", "enable", "--now", "dsh-companion.service"]);
  if (enabled.status !== 0) return `\u5DF2\u5199\u5165 ${target}\uFF0C\u4F46 enable \u5931\u8D25\uFF0C\u8BF7\u624B\u52A8 systemctl --user enable --now dsh-companion`;
  return `\u5DF2\u5B89\u88C5\u5E76\u542F\u52A8 systemd user \u670D\u52A1\uFF08dsh-companion.service\uFF09`;
}

// src/cli/index.ts
function parseArgs(argv) {
  const options = {
    gateway: process.env["DSHC_GATEWAY"] ?? "",
    port: 3780,
    host: "0.0.0.0",
    caps: "m2",
    name: "",
    dsh: void 0,
    detached: false
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
      case "--caps":
        options.caps = value();
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
      default:
        throw new Error(`\u672A\u77E5\u53C2\u6570 ${flag}`);
    }
  }
  return { command, options };
}
function lanUrl(port) {
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === "IPv4" && !net.internal) return `ws://${net.address}:${port}/mobile/ws`;
    }
  }
  return void 0;
}
function qrPayload(gatewayUrl, port) {
  const state = loadBridgeState(defaultStateFile());
  if (state === void 0) throw new Error("\u72B6\u6001\u6587\u4EF6\u4E0D\u53EF\u7528");
  const lan = lanUrl(port);
  return lan === void 0 ? {
    v: 1,
    gatewayUrl: gatewayUrl.length > 0 ? gatewayUrl : "(\u672A\u914D\u7F6E gateway\uFF0C\u4EC5\u540C\u7F51\u6BB5\u53EF\u7528)",
    hostKey: state.hostKey,
    token: state.pairingToken,
    fingerprint: state.fingerprint,
    code: state.pairingCode
  } : {
    v: 1,
    gatewayUrl: gatewayUrl.length > 0 ? gatewayUrl : "(\u672A\u914D\u7F6E gateway\uFF0C\u4EC5\u540C\u7F51\u6BB5\u53EF\u7528)",
    lanUrl: lan,
    hostKey: state.hostKey,
    token: state.pairingToken,
    fingerprint: state.fingerprint,
    code: state.pairingCode
  };
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
        caps: options.caps,
        workerName: name,
        stateFile
      });
      printPairing(qrPayload(options.gateway, options.port));
      if (options.detached) {
        const args = [
          "--gateway",
          options.gateway,
          "--port",
          String(options.port),
          "--host",
          options.host,
          "--caps",
          options.caps
        ];
        if (options.name.length > 0) args.push("--name", options.name);
        if (options.dsh !== void 0) args.push("--dsh", options.dsh);
        const pid = detachSpawn(args);
        process.stdout.write(`[dshc] \u540E\u53F0\u8FD0\u884C\u4E2D (pid ${pid})\uFF0C\u65E5\u5FD7: ${logFile()}
`);
        process.exit(0);
      }
      await supervise(dshBin, ["--profile", COMPANION_PROFILE], { ...process.env });
      break;
    }
    case "stop": {
      const pid = isRunning();
      if (pid === null) {
        process.stdout.write("[dshc] \u672A\u5728\u8FD0\u884C\n");
        process.exit(0);
      }
      requestStop();
      process.stdout.write(`[dshc] \u5DF2\u8BF7\u6C42\u505C\u6B62 (pid ${pid})\uFF1B\u82E5 5 \u79D2\u672A\u9000\u51FA: kill ${pid}
`);
      break;
    }
    case "status": {
      const pid = isRunning();
      process.stdout.write(
        pid === null ? "dshc: \u672A\u8FD0\u884C\n" : `dshc: \u8FD0\u884C\u4E2D (pid ${pid})\uFF0C\u65E5\u5FD7 ${logFile()}
`
      );
      process.stdout.write(`\u72B6\u6001\u6587\u4EF6: ${stateFile}
pid \u6587\u4EF6: ${pidFile()}
home: ${dshcDir()}
`);
      break;
    }
    case "token": {
      const state = loadBridgeState(stateFile);
      if (state === void 0) throw new Error("\u72B6\u6001\u6587\u4EF6\u4E0D\u53EF\u7528");
      const next = rotatePairing(state, stateFile);
      process.stdout.write(`[dshc] \u914D\u5BF9 token \u5DF2 rotate\uFF0C\u65B0\u914D\u5BF9\u7801 ${next.pairingCode}\uFF08\u8FD0\u884C dshc qr \u67E5\u770B\u4E8C\u7EF4\u7801\uFF09
`);
      break;
    }
    case "qr": {
      printPairing(qrPayload(options.gateway, options.port));
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
          "dshc \u2014 DSH Companion Worker",
          "",
          "\u7528\u6CD5: dshc <command> [options]",
          "",
          "\u547D\u4EE4:",
          "  install [--gateway wss://\u2026]   \u5B89\u88C5\u5F00\u673A\u81EA\u542F\uFF08\u5E76\u542F\u52A8\uFF09",
          "  uninstall                     \u79FB\u9664\u81EA\u542F",
          "  start [--gateway \u2026] [--port 3780] [--caps m2] [--detached]",
          "                                \u62C9\u8D77\u5E76\u5B88\u62A4 dsh\uFF0C\u6253\u5370\u914D\u5BF9\u4E8C\u7EF4\u7801",
          "  stop / status / token / qr"
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
