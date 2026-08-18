/**
 * 会话事件通道：dsh SessionEvent 原样透传。
 *
 * dsh 的 Session log 是 append-only、全 JSON、seq 连续的事件流
 * （turn/*、step/*、user/message、assistant/chunk、assistant/message、
 * tool/call、tool/result …，见 dsh docs/subsystems/session.md）。
 * 本包不逐一枚举事件负载（dsh 预览期演进快），以宽松类型透传，
 * 视图模型由 app 侧 reducer 依据 `type` 分派。
 */
export function parseMobileEvent(value) {
    if (typeof value !== 'object' || value === null)
        return null;
    const v = value;
    if (typeof v.sessionId !== 'string' || v.sessionId.length === 0)
        return null;
    if (typeof v.seq !== 'number' || !Number.isInteger(v.seq) || v.seq < 0)
        return null;
    const event = v.event;
    if (typeof event !== 'object' || event === null)
        return null;
    const e = event;
    if (typeof e.type !== 'string')
        return null;
    if (typeof e.seq !== 'number')
        return null;
    const workerId = v.workerId;
    if (workerId !== undefined && typeof workerId !== 'string')
        return null;
    if (workerId === undefined) {
        return { sessionId: v.sessionId, seq: v.seq, event: e };
    }
    return { sessionId: v.sessionId, seq: v.seq, event: e, workerId };
}
//# sourceMappingURL=events.js.map