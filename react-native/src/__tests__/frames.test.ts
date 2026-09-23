import { describe, expect, it } from 'vitest';
import { parseWorkerFrameSafe } from '../dsh/frames';

describe('parseWorkerFrameSafe', () => {
  it('接受 jobs 下行帧', () => {
    const frame = parseWorkerFrameSafe({
      kind: 'jobs',
      sessionId: 's1',
      jobs: [{ id: 'j1', kind: 'bash', label: 'npm test', status: 'running', startedAt: 1 }],
    });
    expect(frame?.kind).toBe('jobs');
  });

  it('接受既有帧类型', () => {
    expect(parseWorkerFrameSafe({ kind: 'auth-ok' })?.kind).toBe('auth-ok');
    expect(parseWorkerFrameSafe({ kind: 'ping', nonce: 3 })?.kind).toBe('ping');
  });

  it('未知或非法结构返回 null', () => {
    expect(parseWorkerFrameSafe({ kind: 'mystery' })).toBeNull();
    expect(parseWorkerFrameSafe(null)).toBeNull();
    expect(parseWorkerFrameSafe('nope')).toBeNull();
  });
});
