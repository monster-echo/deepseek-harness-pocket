/**
 * ★★ dsh 版本适配唯一收敛点。
 *
 * 所有对 dsh Cordis 服务（ctx.sessions / ctx.sessionPersistence / ctx.agents /
 * ctx.approval / ctx.userQuestions）的调用都在本文件；dsh breaking changes 只改这里。
 * Hub 与路由只依赖本文件导出的窄接口，可脱离 dsh 单测。
 */
import { createUserMessage } from '@deepseek-ai/dsh-llm';
function toEvent(raw) {
    // SessionEvent 全 JSON 可序列化；宽松透传（type/seq 由协议层校验）
    return raw;
}
export function createAdapter(ctx) {
    const persistence = () => ctx.get('sessionPersistence');
    const agents = () => ctx.get('agents');
    const caps = {
        persistence: persistence() !== undefined,
        agents: agents() !== undefined,
        approval: ctx.get('approval') !== undefined,
        userQuestions: ctx.get('userQuestions') !== undefined,
    };
    const agentStatusById = () => {
        const map = new Map();
        const registry = agents();
        if (registry)
            for (const agent of registry.list())
                map.set(agent.id.toString(), agent.status);
        return map;
    };
    const toSummary = (id, createdAt, cwd, lastSeq) => {
        const status = agentStatusById().get(id);
        return {
            id,
            createdAt,
            cwd: cwd ?? null,
            lastSeq,
            live: status !== undefined,
            agentStatus: status ?? null,
        };
    };
    return {
        caps,
        dshVersion() {
            // host.describe 目前是 placeholder；M1 先返回 null，后续接 apps/cli 版本注入
            return null;
        },
        async listSessions() {
            const summaries = new Map();
            const per = persistence();
            if (per) {
                try {
                    const headers = await per.list();
                    for (const h of headers) {
                        const id = h.id.toString();
                        summaries.set(id, toSummary(id, h.createdAt, h.cwd, h.lastSeq ?? -1));
                    }
                }
                catch {
                    // 持久化后端不可用时仅返回 live
                }
            }
            const live = ctx.sessions.list();
            for (const s of live) {
                const id = s.id.toString();
                summaries.set(id, toSummary(id, s.header.createdAt, s.header.cwd, s.seq - 1));
            }
            return [...summaries.values()].sort((a, b) => b.createdAt - a.createdAt);
        },
        async readSlice(id, fromSeq) {
            const live = ctx.sessions.get(id);
            if (live) {
                const slice = live.events.slice(Math.max(0, fromSeq)).map(toEvent);
                return { id, fromSeq: Math.max(0, fromSeq), toSeq: live.seq - 1, events: slice };
            }
            const per = persistence();
            if (!per)
                return null;
            try {
                const { events } = await per.readFrom(id, fromSeq);
                const list = events.map(toEvent);
                const last = list[list.length - 1];
                return {
                    id,
                    fromSeq,
                    toSeq: typeof last?.seq === 'number' ? last.seq : fromSeq - 1,
                    events: list,
                };
            }
            catch {
                return null;
            }
        },
        async sendUserMessage(id, text) {
            const agent = agents()?.get(id);
            if (!agent)
                throw new Error(`no live agent for session ${id}`);
            const message = createUserMessage({
                content: [{ type: 'text', text }],
                source: { kind: 'plugin', plugin: 'deepseek-harness-pocket-bridge' },
            });
            agent.followup(message);
        },
        async stopTurn(id) {
            const agent = agents()?.get(id);
            if (!agent)
                throw new Error(`no live agent for session ${id}`);
            agent.cancel({ kind: 'user' });
        },
        onEvent(handler) {
            const dispose = ctx.on('session/event', (session, event) => {
                handler(session.id.toString(), toEvent(event));
            });
            return () => void dispose();
        },
        onSessionsChanged(handler) {
            const disposers = [
                ctx.on('session/created', () => handler()),
                ctx.on('session/disposed', () => handler()),
                ctx.on('agent/status', () => handler()),
            ];
            return () => disposers.forEach((d) => void d());
        },
        registerApprovalAsker(ask) {
            if (!ctx.get('approval'))
                return null;
            const listener = async (req, next) => {
                const r = req;
                const sessionId = r.agent.session?.id.toString() ?? r.agent.id.toString();
                const requestId = `ap_${String(r.callId ?? Math.random().toString(36).slice(2, 10))}`;
                let release = null;
                const decided = new Promise((resolve) => {
                    release = resolve;
                });
                ask({
                    requestId,
                    sessionId,
                    toolName: r.toolName,
                    summary: typeof r.reason === 'string' ? r.reason : `approve ${r.toolName}`,
                    detail: null,
                    decide: async (decision) => {
                        if (decision === 'pass')
                            return;
                        release?.(decision);
                    },
                });
                // 手机 30 秒未决策（或无人应答 decide('pass')）→ 交还瀑布（web UI / fail-closed）
                const outcome = await Promise.race([
                    decided,
                    new Promise((resolve) => setTimeout(resolve, 30_000, 'timeout')),
                ]);
                if (outcome === 'timeout')
                    return next();
                return outcome === 'allow' ? 'allowed-once' : 'rejected';
            };
            const dispose = ctx.on('approval/request', listener);
            return () => void dispose();
        },
        registerQuestionAsker(ask) {
            const service = ctx.get('userQuestions');
            if (!service)
                return null;
            try {
                return service.registerProvider({
                    async ask(request) {
                        const r = request;
                        const first = r.questions[0];
                        const sessionId = r.agent?.session?.id.toString() ?? r.agent?.id.toString() ?? '';
                        const requestId = `q_${Math.random().toString(36).slice(2, 10)}`;
                        return await new Promise((resolve) => {
                            ask({
                                requestId,
                                sessionId,
                                question: first?.question ?? '',
                                options: first?.options ? [...first.options] : [],
                                answer: async (text) => resolve({ answer: text }),
                            });
                        });
                    },
                });
            }
            catch {
                // 已有 provider（如 web UI）——本插件退位
                return null;
            }
        },
    };
}
//# sourceMappingURL=adapter-dsh.js.map