/**
 * 后台任务（jobs）投影。
 *
 * 对齐 dsh-jobs 的 JobSnapshot：任务由 Worker 侧 `ctx.jobs` 注册表持有，
 * 通过 session control 流下发（不是会话日志事件）。手机端按会话订阅。
 */

export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed'

export interface JobSnapshot {
  readonly id: string
  /** bash / subagent / 未来扩展 */
  readonly kind: string
  readonly label: string
  readonly status: JobStatus
  readonly detail?: string
  readonly startedAt: number
  readonly finishedAt?: number
}

const STATUSES: readonly JobStatus[] = ['running', 'stopping', 'completed', 'killed', 'failed']

/** 宽松解析任务数组；任一元素非法则整体返回 null。 */
export function parseJobs(value: unknown): readonly JobSnapshot[] | null {
  if (!Array.isArray(value)) return null
  const jobs: JobSnapshot[] = []
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null) return null
    const j = raw as Record<string, unknown>
    if (typeof j['id'] !== 'string' || typeof j['label'] !== 'string') return null
    if (typeof j['status'] !== 'string' || !STATUSES.includes(j['status'] as JobStatus)) return null
    if (typeof j['startedAt'] !== 'number') return null
    jobs.push({
      id: j['id'],
      kind: typeof j['kind'] === 'string' ? j['kind'] : 'job',
      label: j['label'],
      status: j['status'] as JobStatus,
      ...(typeof j['detail'] === 'string' ? { detail: j['detail'] } : {}),
      startedAt: j['startedAt'],
      ...(typeof j['finishedAt'] === 'number' ? { finishedAt: j['finishedAt'] } : {}),
    })
  }
  return jobs
}

/** 运行中（含正在停止）的任务视为 live。 */
export function isLiveJob(job: JobSnapshot): boolean {
  return job.status === 'running' || job.status === 'stopping'
}
