/**
 * 回合分组（批次 2：回合过程折叠）。
 *
 * 把扁平时间线切成「回合」：
 *   user（用户消息，常显）
 *   process（本回合过程：思考/工具/提示/压缩，可折叠）
 *   result（最终作答 + 回合尾，常显）
 *
 * 关键取舍：**最后一条 assistant 永远常显**，否则折叠会把用户真正要看的答复藏起来。
 * 纯函数、无 React 依赖，便于单测。
 */
import type { TimelineItem } from './reducer';

export interface TurnGroup {
  readonly key: string;
  readonly user: TimelineItem | null;
  readonly process: readonly TimelineItem[];
  readonly result: readonly TimelineItem[];
  readonly toolCount: number;
}

function isProcessItem(item: TimelineItem): boolean {
  return item.kind === 'assistant' || item.kind === 'tool' || item.kind === 'notice'
    || item.kind === 'compaction' || item.kind === 'contextInjection';
}

/** 扁平时间线 → 回合分组（按 user 边界切分）。 */
export function groupTurns(items: readonly TimelineItem[]): readonly TurnGroup[] {
  const groups: TurnGroup[] = [];
  let segment: TimelineItem[] = [];

  const flush = (): void => {
    if (segment.length === 0) return;
    const items0 = segment;
    const user = items0.find((item) => item.kind === 'user') ?? null;
    const body = items0.filter((item) => item !== user);

    // 最后一条 assistant 常显，其后（含 turnEnd）也常显
    let lastAssistant = -1;
    for (let i = body.length - 1; i >= 0; i -= 1) {
      if (body[i]!.kind === 'assistant') {
        lastAssistant = i;
        break;
      }
    }

    let process: TimelineItem[];
    let result: TimelineItem[];
    if (lastAssistant >= 0) {
      process = body.slice(0, lastAssistant);
      result = body.slice(lastAssistant);
    } else {
      process = body.filter((item) => item.kind !== 'turnEnd');
      result = body.filter((item) => item.kind === 'turnEnd');
    }

    groups.push({
      key: user?.key ?? items0[0]!.key,
      user,
      process,
      result,
      toolCount: process.filter((item) => item.kind === 'tool').length,
    });
    segment = [];
  };

  for (const item of items) {
    if (item.kind === 'user' && segment.length > 0) flush();
    segment.push(item);
  }
  flush();

  // 极端情况下（首项就是 turnEnd 等）保底：直接按顺序输出
  return groups.length > 0 ? groups : [];
}

/** 过程区是否值得折叠（项数太少就不折，避免多一次点击）。 */
export function shouldFold(group: TurnGroup, threshold = 3): boolean {
  return group.process.filter(isProcessItem).length > threshold;
}
