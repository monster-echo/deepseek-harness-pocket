/**
 * 作品预览帧：手机拉取 workspace 内产物文件的分块传输。
 *
 * 传输无关设计（v1 走现有 WS 隧道；v2 P2P DataChannel / v3 relay 节点换传输，帧不变）：
 * 手机发 preview(requestId, path) → worker 回 preview-begin(mime,bytes)
 *   → preview-chunk(seq, base64)×N → preview-end(bytes)；失败任一阶段回 preview-error。
 */
/** 单文件上限：超出由 worker 拒绝（保护小水管 relay）。 */
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024;
/** 单块原始字节数（base64 后约 64KB，远低于各级 WS maxPayload）。 */
export const PREVIEW_CHUNK_BYTES = 48 * 1024;
//# sourceMappingURL=preview.js.map