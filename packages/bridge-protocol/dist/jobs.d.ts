/**
 * 后台任务（jobs）投影。
 *
 * 对齐 dsh-jobs 的 JobSnapshot：任务由 Worker 侧 `ctx.jobs` 注册表持有，
 * 通过 session control 流下发（不是会话日志事件）。手机端按会话订阅。
 */
export type JobStatus = 'running' | 'stopping' | 'completed' | 'killed' | 'failed';
export interface JobSnapshot {
    readonly id: string;
    /** bash / subagent / 未来扩展 */
    readonly kind: string;
    readonly label: string;
    readonly status: JobStatus;
    readonly detail?: string;
    readonly startedAt: number;
    readonly finishedAt?: number;
}
/** 宽松解析任务数组；任一元素非法则整体返回 null。 */
export declare function parseJobs(value: unknown): readonly JobSnapshot[] | null;
/** 运行中（含正在停止）的任务视为 live。 */
export declare function isLiveJob(job: JobSnapshot): boolean;
