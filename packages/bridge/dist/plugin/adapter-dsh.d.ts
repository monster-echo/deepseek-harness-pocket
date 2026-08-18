/**
 * ★★ dsh 版本适配唯一收敛点。
 *
 * 所有对 dsh Cordis 服务（ctx.sessions / ctx.sessionPersistence / ctx.agents /
 * ctx.approval / ctx.userQuestions）的调用都在本文件；dsh breaking changes 只改这里。
 * Hub 与路由只依赖本文件导出的窄接口，可脱离 dsh 单测。
 */
import type { Context } from '@deepseek-ai/cordis';
import type { DshSessionEvent } from '@deepseek-harness-pocket/bridge-protocol';
type AgentStatusValue = 'idle' | 'running';
/**
 * 最小事件声明合并：只声明本插件监听的事件键（dsh 类型包未全部发布 npm）。
 * 真实事件签名对齐由 e2e 契约测试守护。
 */
declare module '@deepseek-ai/cordis' {
    interface Context {
        sessions: {
            get(id: unknown): unknown;
            list(): unknown[];
        };
    }
    interface Events {
        'session/event'(session: {
            id: {
                toString(): string;
            };
        }, event: unknown): void;
        'session/created'(session: unknown): void;
        'session/disposed'(session: unknown): void;
        'agent/status'(payload: unknown): void;
    }
}
export interface SessionSummary {
    readonly id: string;
    readonly createdAt: number;
    readonly cwd: string | null;
    readonly lastSeq: number;
    readonly live: boolean;
    /** live agent 状态；离线为 null */
    readonly agentStatus: AgentStatusValue | null;
}
export interface SessionSlice {
    readonly id: string;
    readonly fromSeq: number;
    readonly toSeq: number;
    readonly events: readonly DshSessionEvent[];
}
/** 审批请求的窄投影（hub 侧不接触 dsh 对象）。 */
export interface ApprovalAsk {
    readonly requestId: string;
    readonly sessionId: string;
    readonly toolName: string;
    readonly summary: string;
    readonly detail: Record<string, unknown> | null;
    readonly decide: (decision: 'allow' | 'deny' | 'pass') => Promise<void>;
}
export interface QuestionAsk {
    readonly requestId: string;
    readonly sessionId: string;
    readonly question: string;
    readonly options: readonly string[];
    readonly answer: (text: string) => Promise<void>;
}
/** dsh 宿主能力探测结果（缺服务时优雅降级）。 */
export interface AdapterCaps {
    readonly persistence: boolean;
    readonly agents: boolean;
    readonly approval: boolean;
    readonly userQuestions: boolean;
}
export interface DshAdapter {
    readonly caps: AdapterCaps;
    dshVersion(): string | null;
    listSessions(): Promise<readonly SessionSummary[]>;
    readSlice(id: string, fromSeq: number): Promise<SessionSlice | null>;
    sendUserMessage(id: string, text: string): Promise<void>;
    stopTurn(id: string): Promise<void>;
    /** 订阅事件流；返回退订函数 */
    onEvent(handler: (sessionId: string, event: DshSessionEvent) => void): () => void;
    /** 状态/生命周期变化通知（presence 刷新用） */
    onSessionsChanged(handler: () => void): () => void;
    /** M2：注册审批应答器（无 approval 服务时 no-op 返回 null） */
    registerApprovalAsker(ask: (a: ApprovalAsk) => void): (() => void) | null;
    /** M2：注册用户问题应答器（无服务或已有 provider 时返回 null） */
    registerQuestionAsker(ask: (q: QuestionAsk) => void): (() => void) | null;
}
export declare function createAdapter(ctx: Context): DshAdapter;
export {};
