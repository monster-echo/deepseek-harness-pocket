// src/plugin/index.ts
import { hostname } from "node:os";

// src/plugin/config.ts
import z from "@deepseek-ai/schemastery";
var pluginConfig = z.object({
  /** 直连模式：自起 http/ws server（独立端口，不依赖 ctx.webServer） */
  listen: z.object({
    enabled: z.boolean().default(true),
    host: z.string().default("0.0.0.0"),
    port: z.number().default(3780)
  }).default({ enabled: true, host: "0.0.0.0", port: 3780 }),
  /** uplink 模式：反向连接 gateway */
  gateway: z.object({
    url: z.string().default(""),
    /** 由 dshc 生成并注入，避免与状态文件双源 */
    hostKey: z.string().default(""),
    reconnectMinMs: z.number().default(1e3),
    reconnectMaxMs: z.number().default(3e4)
  }).default({ url: "", hostKey: "", reconnectMinMs: 1e3, reconnectMaxMs: 3e4 }),
  /** 能力面：按里程碑声明，handshake 下发给 app */
  caps: z.union(["m1", "m2", "m3"]).default("m2"),
  /** 状态文件路径（hostKey/pairingToken） */
  stateFile: z.string().default("~/.dsh-companion/bridge-state.json"),
  /** Worker 显示名（默认取 hostname） */
  name: z.string().default(""),
  /** 禁用一切写操作（只读模式开关） */
  readOnly: z.boolean().default(false),
  /**
   * 注册 user-questions provider（默认 false）：dsh 的 provider 槽唯一，
   * web-app bundle 的 api-gateway 已占用；仅 headless/自定义 profile 开启。
   * 审批走 approval/request 瀑布流，多应答器共存，不受此限制。
   */
  userQuestions: z.boolean().default(false),
  /** 新会话默认模型路由（sessions.create 可按次覆盖） */
  model: z.object({
    provider: z.string().default("deepseek-official"),
    model: z.string().default("deepseek-v4-flash")
  }).default({ provider: "deepseek-official", model: "deepseek-v4-flash" })
});

// src/plugin/adapter-dsh.ts
import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
function toEvent(raw) {
  return raw;
}
function createAdapter(ctx) {
  const persistence = () => ctx.get("sessionPersistence");
  const agents = () => ctx.get("agents");
  const caps = {
    persistence: persistence() !== void 0,
    agents: agents() !== void 0,
    approval: ctx.get("approval") !== void 0,
    userQuestions: ctx.get("userQuestions") !== void 0
  };
  const agentStatusById = () => {
    const map = /* @__PURE__ */ new Map();
    const registry = agents();
    if (registry) for (const agent of registry.list()) map.set(agent.id.toString(), agent.status);
    return map;
  };
  const toSummary = (id, createdAt, cwd, lastSeq) => {
    const status = agentStatusById().get(id);
    return {
      id,
      createdAt,
      cwd: cwd ?? null,
      lastSeq,
      live: status !== void 0,
      agentStatus: status ?? null
    };
  };
  return {
    caps,
    dshVersion() {
      return null;
    },
    async listSessions() {
      const summaries = /* @__PURE__ */ new Map();
      const per = persistence();
      if (per) {
        try {
          const headers = await per.list();
          for (const h of headers) {
            const id = h.id.toString();
            summaries.set(id, toSummary(id, h.createdAt, h.cwd, h.lastSeq ?? -1));
          }
        } catch {
        }
      }
      const live = ctx.sessions.list();
      for (const s of live) {
        const id = s.id.toString();
        summaries.set(id, toSummary(id, s.header.createdAt, s.header.cwd, s.seq - 1));
      }
      return [...summaries.values()].sort((a, b) => b.createdAt - a.createdAt);
    },
    async listWorkspaces() {
      const registry = ctx.get("workspaceRegistry");
      if (registry === void 0) return [];
      try {
        return registry.list().map((w) => ({ id: w.id.toString(), path: w.path, title: w.title }));
      } catch {
        return [];
      }
    },
    async addWorkspace(path) {
      const registry = ctx.get("workspaceRegistry");
      if (registry === void 0) return null;
      try {
        const existing = registry.list().find((w) => w.path === path);
        if (existing !== void 0) {
          return { id: existing.id.toString(), path: existing.path, title: existing.title };
        }
        const created = await registry.create(path);
        return { id: created.id.toString(), path: created.path, title: created.title };
      } catch {
        return null;
      }
    },
    async createSession(cwd, route) {
      const registry = agents();
      if (registry === void 0) throw new Error("no agent factory (dsh \u672A\u8FD0\u884C agent loop)");
      const handle = await registry.create({
        sessionId: randomUUID(),
        meta: { cwd },
        agentOptions: { provider: route.provider, model: route.model }
      });
      return handle.agent.id.toString();
    },
    async readSlice(id, fromSeq) {
      const live = ctx.sessions.get(id);
      if (live) {
        const slice = live.events.slice(Math.max(0, fromSeq)).map(toEvent);
        return { id, fromSeq: Math.max(0, fromSeq), toSeq: live.seq - 1, events: slice };
      }
      const per = persistence();
      if (!per) return null;
      try {
        const { events } = await per.readFrom(id, fromSeq);
        const list = events.map(toEvent);
        const last = list[list.length - 1];
        return {
          id,
          fromSeq,
          toSeq: typeof last?.seq === "number" ? last.seq : fromSeq - 1,
          events: list
        };
      } catch {
        return null;
      }
    },
    async sendUserMessage(id, text) {
      const agent = agents()?.get(id);
      if (!agent) throw new Error(`no live agent for session ${id}`);
      const message = createUserMessage({
        content: [{ type: "text", text }],
        source: { kind: "plugin", plugin: "dsh-companion-bridge" }
      });
      agent.followup(message);
    },
    async stopTurn(id) {
      const agent = agents()?.get(id);
      if (!agent) throw new Error(`no live agent for session ${id}`);
      agent.cancel({ kind: "user" });
    },
    onEvent(handler) {
      const dispose = ctx.on("session/event", (session, event) => {
        handler(session.id.toString(), toEvent(event));
      });
      return () => void dispose();
    },
    onSessionsChanged(handler) {
      const disposers = [
        ctx.on("session/created", () => handler()),
        ctx.on("session/disposed", () => handler()),
        ctx.on("agent/status", () => handler())
      ];
      return () => disposers.forEach((d) => void d());
    },
    registerApprovalAsker(ask) {
      if (!ctx.get("approval")) return null;
      const listener = async (req, next) => {
        const r = req;
        const sessionId = r.agent.session?.id.toString() ?? r.agent.id.toString();
        const requestId = `ap_${String(r.callId ?? Math.random().toString(36).slice(2, 10))}`;
        let release = null;
        const decided = new Promise((resolve2) => {
          release = resolve2;
        });
        ask({
          requestId,
          sessionId,
          toolName: r.toolName,
          summary: typeof r.reason === "string" ? r.reason : `approve ${r.toolName}`,
          detail: null,
          decide: async (decision) => {
            if (decision === "pass") return;
            release?.(decision);
          }
        });
        const outcome = await Promise.race([
          decided,
          new Promise((resolve2) => setTimeout(resolve2, 3e4, "timeout"))
        ]);
        if (outcome === "timeout") return next();
        return outcome === "allow" ? "allowed-once" : "rejected";
      };
      const dispose = ctx.on("approval/request", listener);
      return () => void dispose();
    },
    registerQuestionAsker(ask) {
      const service = ctx.get("userQuestions");
      if (!service) return null;
      try {
        return service.registerProvider({
          async ask(request) {
            const r = request;
            const first = r.questions[0];
            const sessionId = r.agent?.session?.id.toString() ?? r.agent?.id.toString() ?? "";
            const requestId = `q_${Math.random().toString(36).slice(2, 10)}`;
            return await new Promise((resolve2) => {
              ask({
                requestId,
                sessionId,
                question: first?.question ?? "",
                options: first?.options ? [...first.options] : [],
                answer: async (text) => resolve2({ answer: text })
              });
            });
          }
        });
      } catch {
        return null;
      }
    }
  };
}

// ../dsh-bridge-protocol/dist/version.js
var PROTOCOL_VERSION = "mobile/v1";
function parseProtocolVersion(version) {
  const match = /^mobile\/v(\d+)(?:\.(\d+))?$/.exec(version);
  if (!match)
    return null;
  const major = Number(match[1]);
  const minor = match[2] === void 0 ? 0 : Number(match[2]);
  if (!Number.isInteger(major) || !Number.isInteger(minor))
    return null;
  return { major, minor };
}
function isCompatibleVersion(client, server) {
  const c = parseProtocolVersion(client);
  const s = parseProtocolVersion(server);
  if (!c || !s)
    return false;
  return c.major === s.major;
}

// ../dsh-bridge-protocol/dist/rpc.js
function rpcSuccess(id, result) {
  return { id, ok: true, result };
}
function rpcFailure(id, code, message) {
  return { id, ok: false, error: { code, message } };
}
function parseWireRequest(value) {
  if (typeof value !== "object" || value === null)
    return null;
  const v = value;
  const { id, ns, method, args } = v;
  if (typeof id !== "string" || id.length === 0 || id.length > 64)
    return null;
  if (typeof ns !== "string" || !/^[a-z][a-z0-9-]*$/.test(ns))
    return null;
  if (typeof method !== "string" || !/^[a-z][a-zA-Z0-9.-]*$/.test(method))
    return null;
  if (typeof args !== "object" || args === null || Array.isArray(args))
    return null;
  return { id, ns, method, args };
}
function methodKey(ns, method) {
  return `${ns}.${method}`;
}

// ../dsh-bridge-protocol/dist/handshake.js
var M1_CAPABILITIES = {
  sessionsReadonly: true,
  turnControl: false,
  approvals: false,
  sessionCreate: false,
  artifacts: false
};

// ../dsh-bridge-protocol/dist/relay.js
function asRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}
function parseGatewayToWorkerFrame(value) {
  const v = asRecord(value);
  if (!v || typeof v.kind !== "string")
    return null;
  switch (v.kind) {
    case "register-ok":
      return typeof v.workerId === "string" ? { kind: "register-ok", workerId: v.workerId } : null;
    case "register-rejected":
      return typeof v.reason === "string" ? { kind: "register-rejected", reason: v.reason } : null;
    case "ping":
      return typeof v.nonce === "number" ? { kind: "ping", nonce: v.nonce } : null;
    case "phone-frame":
      return typeof v.phoneId === "string" && typeof v.inner === "string" ? { kind: "phone-frame", phoneId: v.phoneId, inner: v.inner } : null;
    case "pairing-challenge":
      return typeof v.challengeId === "string" && typeof v.code === "string" && typeof v.requestedBy === "string" ? { kind: "pairing-challenge", challengeId: v.challengeId, code: v.code, requestedBy: v.requestedBy } : null;
    default:
      return null;
  }
}

// ../dsh-bridge-protocol/dist/ws.js
function parsePhoneFrame(text) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null)
    return null;
  const v = value;
  switch (v.kind) {
    case "auth":
      return typeof v.token === "string" ? { kind: "auth", token: v.token } : null;
    case "pong":
      return typeof v.nonce === "number" ? { kind: "pong", nonce: v.nonce } : null;
    case "rpc": {
      const { request } = v;
      if (typeof request !== "object" || request === null)
        return null;
      const r = request;
      if (typeof r.id !== "string" || typeof r.ns !== "string" || typeof r.method !== "string")
        return null;
      if (typeof r.args !== "object" || r.args === null)
        return null;
      return {
        kind: "rpc",
        request: {
          id: r.id,
          ns: r.ns,
          method: r.method,
          args: r.args
        }
      };
    }
    default:
      return null;
  }
}

// src/plugin/hub.ts
function capsForLevel(level) {
  if (level === "m1") return M1_CAPABILITIES;
  if (level === "m2") {
    return { ...M1_CAPABILITIES, turnControl: true, approvals: true };
  }
  return { ...M1_CAPABILITIES, turnControl: true, approvals: true, sessionCreate: true, artifacts: true };
}
var connSeq = 0;
var BridgeHub = class {
  constructor(adapter, opts) {
    this.adapter = adapter;
    this.opts = opts;
    this.capabilities = capsForLevel(opts.capsLevel);
    this.disposer = adapter.onEvent((sessionId, event) => this.broadcastEvent(sessionId, event));
  }
  conns = /* @__PURE__ */ new Map();
  pendingAsks = /* @__PURE__ */ new Map();
  disposer;
  capabilities;
  dispose() {
    this.disposer();
    for (const ask of this.pendingAsks.values()) {
      if ("decide" in ask) void ask.decide("pass");
    }
    this.pendingAsks.clear();
    this.conns.clear();
  }
  /** 已认证连接数（审批应答器据此决定是否接手）。 */
  connectedCount() {
    let n = 0;
    for (const c of this.conns.values()) if (c.authed) n++;
    return n;
  }
  /** 注册一个新的物理连接；trusted=true（经 gateway）时立即完成认证。返回连接 id。 */
  attach(sender, options) {
    const id = `c${++connSeq}`;
    const trusted = options?.trusted === true;
    const conn = { id, sender, authed: trusted, trusted, subscribed: /* @__PURE__ */ new Set() };
    this.conns.set(id, conn);
    if (trusted) this.sendTo(conn, { kind: "auth-ok" });
    return id;
  }
  detach(connId) {
    this.conns.delete(connId);
  }
  /**
   * 处理一帧文本（来自直连 WS 或 gateway 转发）。
   * - 'authed'：本帧完成认证（调用方可取消认证超时）
   * - 'ok'：正常处理
   * - 'reject'：协议错误或认证失败，调用方应断开连接
   */
  handleFrame(connId, text) {
    const conn = this.conns.get(connId);
    if (!conn) return "reject";
    const frame = parsePhoneFrame(text);
    if (frame === null) return "reject";
    switch (frame.kind) {
      case "auth": {
        if (conn.trusted || this.opts.verifyToken(this.opts.pairingToken, frame.token)) {
          conn.authed = true;
          this.sendTo(conn, { kind: "auth-ok" });
          return "authed";
        }
        this.sendTo(conn, { kind: "auth-rejected", reason: "invalid pairing token" });
        return "reject";
      }
      case "pong":
        return "ok";
      case "rpc": {
        if (!conn.authed) {
          const response = rpcFailure(frame.request.id, "unauthorized", "authenticate first");
          this.sendTo(conn, { kind: "rpc-result", response });
          return "ok";
        }
        void this.dispatch(frame.request).then((response) => this.sendTo(conn, { kind: "rpc-result", response })).catch((error) => {
          const response = rpcFailure(
            frame.request.id,
            "internal",
            error instanceof Error ? error.message : String(error)
          );
          this.sendTo(conn, { kind: "rpc-result", response });
        });
        return "ok";
      }
    }
  }
  /** mobile/v1 白名单分发。 */
  async dispatch(request) {
    const req = parseWireRequest(request);
    if (req === null) return rpcFailure("?", "bad-request", "malformed wire request");
    const key = methodKey(req.ns, req.method);
    const fail = (code, message) => rpcFailure(req.id, code, message);
    const denyIf = (condition, code, message) => condition ? fail(code, message) : null;
    switch (key) {
      case "handshake.hello": {
        const client = req.args["client"];
        const version = req.args["protocolVersion"];
        if (typeof client !== "string" || typeof version !== "string") {
          return fail("bad-request", "client and protocolVersion required");
        }
        if (!isCompatibleVersion(version, PROTOCOL_VERSION)) {
          return fail("version-mismatch", `server ${PROTOCOL_VERSION}, client ${version}`);
        }
        return rpcSuccess(req.id, {
          host: {
            name: this.opts.workerName,
            hostFingerprint: this.opts.fingerprint,
            dshVersion: this.adapter.dshVersion(),
            protocolVersion: PROTOCOL_VERSION,
            capabilities: this.capabilities
          },
          serverTime: (this.opts.now ?? Date.now)()
        });
      }
      case "sessions.list":
        return rpcSuccess(req.id, { sessions: await this.adapter.listSessions() });
      case "sessions.open": {
        const sessionId = req.args["sessionId"];
        if (typeof sessionId !== "string") return fail("bad-request", "sessionId required");
        const slice = await this.adapter.readSlice(sessionId, 0);
        if (slice === null) return fail("not-found", `unknown session ${sessionId}`);
        for (const c of this.conns.values()) {
          if (c.authed) c.subscribed.add(sessionId);
        }
        this.broadcast(snapshotFrame(slice));
        return rpcSuccess(req.id, { fromSeq: slice.fromSeq, toSeq: slice.toSeq, count: slice.events.length });
      }
      case "sessions.close": {
        const sessionId = req.args["sessionId"];
        if (typeof sessionId !== "string") return fail("bad-request", "sessionId required");
        for (const c of this.conns.values()) c.subscribed.delete(sessionId);
        return rpcSuccess(req.id, { ok: true });
      }
      case "sessions.resync": {
        const sessionId = req.args["sessionId"];
        const lastSeq = req.args["lastSeq"];
        if (typeof sessionId !== "string" || typeof lastSeq !== "number" || lastSeq < -1) {
          return fail("bad-request", "sessionId and lastSeq required");
        }
        const slice = await this.adapter.readSlice(sessionId, lastSeq + 1);
        if (slice === null) return fail("not-found", `unknown session ${sessionId}`);
        this.broadcast(snapshotFrame(slice));
        return rpcSuccess(req.id, { fromSeq: slice.fromSeq, toSeq: slice.toSeq, count: slice.events.length });
      }
      case "workspaces.list": {
        const denied = denyIf(!this.capabilities.sessionCreate, "unavailable", "session create not enabled");
        if (denied) return denied;
        return rpcSuccess(req.id, { workspaces: await this.adapter.listWorkspaces() });
      }
      case "workspaces.add": {
        const denied = denyIf(!this.capabilities.sessionCreate, "unavailable", "session create not enabled");
        if (denied) return denied;
        const path = req.args["path"];
        if (typeof path !== "string" || !path.startsWith("/")) {
          return fail("bad-request", "absolute path required");
        }
        const added = await this.adapter.addWorkspace(path);
        if (added === null) return fail("bad-request", "\u65E0\u6CD5\u6DFB\u52A0\u8BE5\u76EE\u5F55\uFF08\u4E0D\u5B58\u5728\u6216\u4E0D\u53EF\u8BBF\u95EE\uFF09");
        return rpcSuccess(req.id, { workspace: added });
      }
      case "sessions.create": {
        const denied = denyIf(!this.capabilities.sessionCreate, "unavailable", "session create not enabled") ?? denyIf(this.opts.readOnly, "forbidden", "worker is read-only");
        if (denied) return denied;
        const cwd = req.args["cwd"];
        if (typeof cwd !== "string" || cwd.length === 0 || !cwd.startsWith("/")) {
          return fail("bad-request", "absolute cwd required");
        }
        const provider = typeof req.args["provider"] === "string" ? req.args["provider"] : this.opts.defaultModel.provider;
        const model = typeof req.args["model"] === "string" ? req.args["model"] : this.opts.defaultModel.model;
        const sessionId = await this.adapter.createSession(cwd, { provider, model });
        return rpcSuccess(req.id, { sessionId });
      }
      case "messages.send": {
        const denied = denyIf(!this.capabilities.turnControl, "unavailable", "turn control not enabled") ?? denyIf(this.opts.readOnly, "forbidden", "worker is read-only");
        if (denied) return denied;
        const sessionId = req.args["sessionId"];
        const text = req.args["text"];
        if (typeof sessionId !== "string" || typeof text !== "string" || text.length === 0) {
          return fail("bad-request", "sessionId and text required");
        }
        await this.adapter.sendUserMessage(sessionId, text);
        return rpcSuccess(req.id, { ok: true });
      }
      case "turn.stop": {
        const denied = denyIf(!this.capabilities.turnControl, "unavailable", "turn control not enabled") ?? denyIf(this.opts.readOnly, "forbidden", "worker is read-only");
        if (denied) return denied;
        const sessionId = req.args["sessionId"];
        if (typeof sessionId !== "string") return fail("bad-request", "sessionId required");
        await this.adapter.stopTurn(sessionId);
        return rpcSuccess(req.id, { ok: true });
      }
      case "permissions.respond": {
        const denied = denyIf(!this.capabilities.approvals, "unavailable", "approvals not enabled");
        if (denied) return denied;
        const requestId = req.args["requestId"];
        const decision = req.args["decision"];
        if (typeof requestId !== "string" || decision !== "allow" && decision !== "allow-always" && decision !== "deny") {
          return fail("bad-request", "requestId and decision required");
        }
        const ask = this.pendingAsks.get(requestId);
        if (!ask || !("decide" in ask)) return fail("not-found", `no pending approval ${requestId}`);
        this.pendingAsks.delete(requestId);
        await ask.decide(decision === "deny" ? "deny" : "allow");
        return rpcSuccess(req.id, { ok: true });
      }
      case "questions.respond": {
        const denied = denyIf(!this.capabilities.approvals, "unavailable", "approvals not enabled");
        if (denied) return denied;
        const requestId = req.args["requestId"];
        const answer = req.args["answer"];
        if (typeof requestId !== "string" || typeof answer !== "string") {
          return fail("bad-request", "requestId and answer required");
        }
        const ask = this.pendingAsks.get(requestId);
        if (!ask || !("answer" in ask)) return fail("not-found", `no pending question ${requestId}`);
        this.pendingAsks.delete(requestId);
        await ask.answer(answer);
        return rpcSuccess(req.id, { ok: true });
      }
      default:
        return fail("not-found", `unknown method ${key}`);
    }
  }
  broadcastEvent(sessionId, event) {
    for (const c of this.conns.values()) {
      if (c.authed && c.subscribed.has(sessionId)) {
        this.sendTo(c, { kind: "event", event: { sessionId, seq: event.seq, event } });
      }
    }
  }
  /** 审批/问题到达：无手机在线则立即放行（不阻塞 turn）。 */
  registerApproval(ask) {
    if (this.connectedCount() === 0) {
      void ask.decide("pass");
      return;
    }
    this.pendingAsks.set(ask.requestId, ask);
    this.broadcast({ kind: "server-request", request: permissionRequestOf(ask) });
  }
  registerQuestion(ask) {
    if (this.connectedCount() === 0) {
      void ask.answer("");
      return;
    }
    this.pendingAsks.set(ask.requestId, ask);
    this.broadcast({
      kind: "server-request",
      request: { kind: "question", body: { requestId: ask.requestId, sessionId: ask.sessionId, question: ask.question, ...ask.options.length > 0 ? { options: ask.options } : {} } }
    });
  }
  broadcast(frame) {
    const text = JSON.stringify(frame);
    for (const c of this.conns.values()) {
      if (c.authed) c.sender.send(text);
    }
  }
  sendTo(conn, frame) {
    conn.sender.send(JSON.stringify(frame));
  }
};
function snapshotFrame(slice) {
  return {
    kind: "snapshot",
    snapshot: { sessionId: slice.id, fromSeq: slice.fromSeq, toSeq: slice.toSeq, events: slice.events }
  };
}
function permissionRequestOf(ask) {
  return {
    kind: "permission",
    body: { requestId: ask.requestId, sessionId: ask.sessionId, summary: ask.summary }
  };
}

// src/plugin/state.ts
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
function verifyToken(expected, actual) {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

// src/plugin/server.ts
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
var AUTH_TIMEOUT_MS = 1e4;
var PING_INTERVAL_MS = 3e4;
function startDirectServer(ctx, opts) {
  const wss = new WebSocketServer({ noServer: true });
  const httpServer = createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/mobile/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, worker: opts.workerName, protocol: "mobile/v1" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "not found", hint: "WS endpoint is /mobile/ws" }));
  });
  httpServer.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (url.split("?")[0] !== "/mobile/ws") {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });
  wss.on("connection", (rawWs) => {
    const ws = rawWs;
    ws.isAlive = true;
    const connId = opts.hub.attach({
      send: (text) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(text);
      }
    });
    const authTimer = setTimeout(() => {
      opts.hub.detach(connId);
      ws.terminate();
    }, AUTH_TIMEOUT_MS);
    ws.on("pong", () => {
      ws.isAlive = true;
    });
    ws.on("close", () => {
      clearTimeout(authTimer);
      opts.hub.detach(connId);
    });
    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : String(data);
      const status = opts.hub.handleFrame(connId, text);
      if (status === "authed") {
        clearTimeout(authTimer);
      } else if (status === "reject") {
        setTimeout(() => ws.terminate(), 200);
      }
    });
  });
  const pingTimer = setInterval(() => {
    for (const raw of wss.clients) {
      const ws = raw;
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, PING_INTERVAL_MS);
  return new Promise((resolve2, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(opts.port, opts.host, () => {
      const address = httpServer.address();
      const port = typeof address === "object" && address !== null ? address.port : opts.port;
      ctx.logger.info(`dsh-companion bridge listening on ws://${opts.host}:${port}/mobile/ws`);
      resolve2({
        port,
        async dispose() {
          clearInterval(pingTimer);
          for (const raw of wss.clients) raw.terminate();
          await new Promise((done) => wss.close(() => done()));
          await new Promise((done) => httpServer.close(() => done()));
        }
      });
    });
  });
}

// src/plugin/uplink.ts
import { WebSocket as WebSocket2 } from "ws";
function startUplink(ctx, opts) {
  let disposed = false;
  let attempt = 0;
  let ws = null;
  let reconnectTimer;
  let pingTimer;
  const scheduleReconnect = () => {
    if (disposed) return;
    const delay = Math.min(opts.reconnectMinMs * 2 ** Math.min(attempt, 5), opts.reconnectMaxMs);
    attempt += 1;
    reconnectTimer = setTimeout(connect, delay);
  };
  const send = (frame) => {
    if (ws !== null && ws.readyState === WebSocket2.OPEN) ws.send(JSON.stringify(frame));
  };
  const connect = () => {
    if (disposed) return;
    ctx.logger.info(`dsh-companion uplink connecting to ${opts.url}`);
    ws = new WebSocket2(opts.url);
    ws.on("open", () => {
      attempt = 0;
      send({
        kind: "worker-register",
        hostKey: opts.hostKey,
        protocolVersion: "mobile/v1",
        name: opts.workerName,
        hostFingerprint: opts.fingerprint,
        dshVersion: opts.dshVersion,
        pairingCode: opts.pairingCode
      });
      pingTimer = setInterval(() => {
        send({ kind: "pong", nonce: Date.now() });
      }, 25e3);
    });
    ws.on("message", (data) => {
      const text = typeof data === "string" ? data : String(data);
      const frame = parseGatewayToWorkerFrame(safeParse(text));
      if (frame === null) return;
      switch (frame.kind) {
        case "register-ok":
          ctx.logger.info(`dsh-companion uplink registered as worker ${frame.workerId}`);
          break;
        case "register-rejected":
          ctx.logger.error(`dsh-companion uplink rejected: ${frame.reason}`);
          ws?.close();
          break;
        case "ping":
          send({ kind: "pong", nonce: frame.nonce });
          break;
        case "phone-frame": {
          opts.hub.handleFrame(uplinkConnId, frame.inner);
          break;
        }
        case "pairing-challenge": {
          const accepted = frame.code === opts.pairingCode;
          send({ kind: "pairing-answer", challengeId: frame.challengeId, accepted });
          ctx.logger.info(
            `dsh-companion pairing challenge from ${frame.requestedBy}: ${accepted ? "accepted" : "rejected (code mismatch)"}`
          );
          break;
        }
      }
    });
    ws.on("close", () => {
      if (pingTimer !== void 0) clearInterval(pingTimer);
      if (!disposed) scheduleReconnect();
    });
    ws.on("error", (error) => {
      ctx.logger.warn(`dsh-companion uplink error: ${error.message}`);
    });
  };
  const uplinkConnId = opts.hub.attach(
    {
      send: (text) => {
        send({ kind: "phone-frame", inner: text });
      }
    },
    { trusted: true }
  );
  connect();
  return () => {
    disposed = true;
    if (reconnectTimer !== void 0) clearTimeout(reconnectTimer);
    if (pingTimer !== void 0) clearInterval(pingTimer);
    opts.hub.detach(uplinkConnId);
    ws?.close();
  };
}
function safeParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// src/plugin/index.ts
var name = "dsh-companion-bridge";
var inject = ["sessions"];
var Config = pluginConfig;
function apply(ctx, config) {
  const state = loadBridgeState(config.stateFile);
  if (state === void 0) {
    ctx.logger.error("dsh-companion bridge: \u65E0\u6CD5\u8BFB\u53D6\u72B6\u6001\u6587\u4EF6\uFF08\u4E14\u7981\u6B62\u521B\u5EFA\uFF09");
    return;
  }
  const workerName = config.name.length > 0 ? config.name : hostname();
  const adapter = createAdapter(ctx);
  const hub = new BridgeHub(adapter, {
    workerName,
    fingerprint: state.fingerprint,
    capsLevel: config.caps,
    readOnly: config.readOnly,
    pairingToken: state.pairingToken,
    verifyToken,
    defaultModel: config.model
  });
  if (hub.capabilities.approvals) {
    adapter.registerApprovalAsker((ask) => hub.registerApproval(ask));
    if (config.userQuestions) {
      adapter.registerQuestionAsker((ask) => hub.registerQuestion(ask));
    }
  }
  if (config.listen.enabled) {
    let disposeServer;
    void startDirectServer(ctx, {
      host: config.listen.host,
      port: config.listen.port,
      hub,
      workerName
    }).then((running) => {
      disposeServer = () => running.dispose();
    }).catch((error) => {
      ctx.logger.error(
        `dsh-companion bridge: \u76F4\u8FDE server \u542F\u52A8\u5931\u8D25 (${config.listen.host}:${config.listen.port}): ${error instanceof Error ? error.message : String(error)}`
      );
    });
    ctx.effect(() => () => void disposeServer?.());
  }
  let disposeUplink;
  if (config.gateway.url.length > 0) {
    const hostKey = config.gateway.hostKey.length > 0 ? config.gateway.hostKey : state.hostKey;
    disposeUplink = startUplink(ctx, {
      url: config.gateway.url,
      hostKey,
      workerName,
      fingerprint: state.fingerprint,
      dshVersion: adapter.dshVersion(),
      hub,
      pairingCode: state.pairingCode,
      reconnectMinMs: config.gateway.reconnectMinMs,
      reconnectMaxMs: config.gateway.reconnectMaxMs
    });
  }
  ctx.effect(() => () => {
    disposeUplink?.();
    hub.dispose();
  });
  ctx.logger.info(
    `dsh-companion bridge ready: worker="${workerName}" caps=${config.caps} direct=${config.listen.enabled ? `ws://${config.listen.host}:${config.listen.port}/mobile/ws` : "off"} gateway=${config.gateway.url.length > 0 ? config.gateway.url : "off"} pairingCode=${state.pairingCode}`
  );
}
export {
  Config,
  apply,
  inject,
  name
};
