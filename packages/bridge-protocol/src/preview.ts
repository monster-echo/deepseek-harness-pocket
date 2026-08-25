/**
 * 作品预览帧：手机拉取 workspace 内产物文件的分块传输。
 *
 * 传输无关设计（v1 走现有 WS 隧道；v2 P2P DataChannel / v3 relay 节点换传输，帧不变）：
 * 手机发 preview(requestId, path) → worker 回 preview-begin(mime,bytes)
 *   → preview-chunk(seq, base64)×N → preview-end(bytes)；失败任一阶段回 preview-error。
 */

/** 单文件上限：超出由 worker 拒绝（保护小水管 relay）。 */
export const PREVIEW_MAX_BYTES = 2 * 1024 * 1024

/** 单块原始字节数（base64 后约 64KB，远低于各级 WS maxPayload）。 */
export const PREVIEW_CHUNK_BYTES = 48 * 1024

export type PreviewErrorCode =
  | 'unavailable' // worker 未开放（artifacts 能力未启用）
  | 'forbidden-path' // 不在任何 workspace 根内 / 含 ..
  | 'unsupported-type' // 扩展名不在白名单
  | 'not-found'
  | 'too-large'
  | 'read-failed'
  | 'internal'

export interface PreviewBegin {
  readonly kind: 'preview-begin'
  readonly requestId: string
  readonly mime: string
  readonly bytes: number
}

export interface PreviewChunk {
  readonly kind: 'preview-chunk'
  readonly requestId: string
  readonly seq: number
  readonly dataBase64: string
}

export interface PreviewEnd {
  readonly kind: 'preview-end'
  readonly requestId: string
  readonly bytes: number
}

export interface PreviewError {
  readonly kind: 'preview-error'
  readonly requestId: string
  readonly code: PreviewErrorCode
  readonly message: string
}

export type PreviewFrame = PreviewBegin | PreviewChunk | PreviewEnd | PreviewError
