import { describe, expect, it } from 'vitest'
import { parseNetstatListenPids } from '../src/cli/supervisor.js'

/** Windows `netstat -ano -p tcp` 真实输出的形态（含干扰行）。 */
const NETSTAT_SAMPLE = [
  '',
  '活动连接',
  '',
  '  协议  本地地址          外部地址        状态           PID',
  '  TCP    127.0.0.1:3080         0.0.0.0:0              LISTENING       9876',
  '  TCP    0.0.0.0:3780           0.0.0.0:0              LISTENING       4321',
  '  TCP    [::]:3080              [::]:0                 LISTENING       5555',
  '  TCP    127.0.0.1:3080         127.0.0.1:52000        ESTABLISHED     9876',
  '  TCP    127.0.0.1:13080        0.0.0.0:0              LISTENING       1111',
  '  TCP    0.0.0.0:3080           0.0.0.0:0              LISTENING       4',
  `  TCP    127.0.0.1:3080         0.0.0.0:0              LISTENING       ${process.pid}`,
  '  TCP    127.0.0.1:30800        0.0.0.0:0              LISTENING       8888',
].join('\n')

describe('parseNetstatListenPids（启动前端口清场）', () => {
  it('只取 LISTEN 且本地端口精确匹配的 pid', () => {
    expect(parseNetstatListenPids(NETSTAT_SAMPLE, 3080).sort((a, b) => a - b)).toEqual([5555, 9876])
  })

  it('其他端口解析为空', () => {
    expect(parseNetstatListenPids(NETSTAT_SAMPLE, 13081)).toEqual([])
  })

  it('排除 System(4) 与自身 pid；3080 不能误匹配 30800', () => {
    const pids = parseNetstatListenPids(NETSTAT_SAMPLE, 3080)
    expect(pids).not.toContain(4)
    expect(pids).not.toContain(process.pid)
    expect(pids).not.toContain(8888)
  })

  it('空输出/损坏输出返回空数组', () => {
    expect(parseNetstatListenPids('', 3080)).toEqual([])
    expect(parseNetstatListenPids('garbage', 3080)).toEqual([])
  })
})
