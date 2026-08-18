/**
 * 诊断：直连真实 gateway(3781)，走 App 的完整协议，确认 worker 端返回什么。
 */
import { PROTOCOL_VERSION } from '@deepseek-harness-pocket/bridge-protocol'
import { TestPhone } from '../test/helpers'

async function main() {
  const phone = new TestPhone('ws://127.0.0.1:3781/gw/phone')
  await phone.opened
  phone.send({ kind: 'phone-auth', authToken: 'dev:smoke_user', deviceKey: 'diag' })
  await phone.wait('auth-ok')
  const presence = (await phone.wait('presence'))['workers'] as { workerId: string; online: boolean; name: string }[]
  console.log('presence:', JSON.stringify(presence))
  if (presence.length === 0) { console.log('NO WORKERS'); phone.close(); return }

  const workerId = presence[0]!.workerId
  phone.send({ kind: 'worker-open', workerId })
  const openResult = await phone.wait('worker-open-result')
  console.log('worker-open-result:', JSON.stringify(openResult))
  if (!(openResult['ok'])) { phone.close(); return }

  const rpc = async (ns: string, method: string, args: Record<string, unknown> = {}) => {
    const id = `d-${ns}.${method}`
    phone.send({ kind: 'worker-frame', workerId, inner: JSON.stringify({ kind: 'rpc', request: { id, ns, method, args } }) })
    const frame = await phone.wait('worker-frame', (f) => (f['inner'] as string).includes(`"${id}"`))
    return JSON.parse(frame['inner'] as string)
  }

  const hs = await rpc('handshake', 'hello', { client: 'diag', protocolVersion: PROTOCOL_VERSION })
  console.log('handshake host:', JSON.stringify((hs.response as { result: { host: { name: string; capabilities: Record<string, boolean> } } }).result?.host))

  const sessions = await rpc('sessions', 'list', {})
  const sessionList = (sessions.response as { result: { sessions: { id: string }[] } }).result.sessions
  console.log('sessions.list count:', sessionList.length)

  const ws = await rpc('workspaces', 'list', {})
  console.log('workspaces.list:', JSON.stringify(ws.response))

  // 用真实 sessionId 查命令（需先 open 挂 agent）
  const firstSessionId = sessionList[0]?.id ?? ''
  await rpc('sessions', 'open', { sessionId: firstSessionId })
  const cmds = await rpc('commands', 'list', { sessionId: firstSessionId })
  console.log('commands.list(sessionId=%s):', firstSessionId, JSON.stringify(cmds.response))

  const models = await rpc('models', 'list', { sessionId: firstSessionId })
  console.log('models.list(sessionId=%s):', firstSessionId, JSON.stringify(models.response))

  phone.close()
  process.exit(0)
}

void main()
