import { describe, expect, it } from 'vitest'
import {
  isCompatibleVersion,
  PROTOCOL_VERSION,
  parseProtocolVersion,
} from '../src/version.js'
import { makeRpcId, methodKey, parseWireRequest, parseWireResponse, rpcFailure, rpcSuccess } from '../src/rpc.js'
import { parseMobileEvent } from '../src/events.js'
import { parsePairingQrPayload, isValidPairingCode } from '../src/pairing.js'
import { parseGatewayToPhoneFrame } from '../src/relay.js'
import { parsePhoneFrame, serializePhoneFrame } from '../src/ws.js'
import { parseServerRequest } from '../src/server-requests.js'

describe('version', () => {
  it('解析与比较协议版本', () => {
    expect(parseProtocolVersion('mobile/v1')).toEqual({ major: 1, minor: 0 })
    expect(parseProtocolVersion('mobile/v2.3')).toEqual({ major: 2, minor: 3 })
    expect(parseProtocolVersion('v1')).toBeNull()
    expect(parseProtocolVersion('mobile/x')).toBeNull()
    expect(isCompatibleVersion('mobile/v1', 'mobile/v1.4')).toBe(true)
    expect(isCompatibleVersion('mobile/v1', 'mobile/v2')).toBe(false)
    expect(isCompatibleVersion(PROTOCOL_VERSION, 'garbage')).toBe(false)
  })
})

describe('rpc envelope', () => {
  it('合法请求可通过解析', () => {
    const req = { id: makeRpcId(), ns: 'sessions', method: 'list', args: {} }
    expect(parseWireRequest(req)).toEqual(req)
  })

  it('非法请求被拒绝', () => {
    expect(parseWireRequest(null)).toBeNull()
    expect(parseWireRequest({ id: '', ns: 'sessions', method: 'list', args: {} })).toBeNull()
    expect(parseWireRequest({ id: 'x', ns: 'Sessions', method: 'list', args: {} })).toBeNull()
    expect(parseWireRequest({ id: 'x', ns: 'sessions', method: 'list', args: [1] })).toBeNull()
    expect(parseWireRequest({ id: 'x', ns: 'sessions', method: 'list' })).toBeNull()
  })

  it('成功/失败响应往返', () => {
    expect(parseWireResponse(rpcSuccess('a1', { ok: 1 }))).toEqual({ id: 'a1', ok: true, result: { ok: 1 } })
    expect(parseWireResponse(rpcFailure('a2', 'unauthorized', 'no token'))).toEqual({
      id: 'a2',
      ok: false,
      error: { code: 'unauthorized', message: 'no token' },
    })
    expect(parseWireResponse({ id: 'a3', ok: false, error: { code: 5 } })).toBeNull()
  })

  it('methodKey', () => {
    expect(methodKey('sessions', 'list')).toBe('sessions.list')
  })
})

describe('events', () => {
  it('MobileEvent 校验', () => {
    const good = {
      sessionId: 's1',
      seq: 3,
      event: { type: 'assistant/message', seq: 3, text: 'hi' },
    }
    expect(parseMobileEvent(good)?.event.type).toBe('assistant/message')
    expect(parseMobileEvent({ ...good, seq: -1 })).toBeNull()
    expect(parseMobileEvent({ ...good, event: { seq: 1 } })).toBeNull()
  })
})

describe('pairing', () => {
  const payload = {
    v: 1,
    gatewayUrl: 'wss://gw.example.com',
    hostKey: 'hk_123',
    token: 'tok_abc',
    fingerprint: 'fp',
    code: '123456',
  }

  it('合法二维码 payload', () => {
    expect(parsePairingQrPayload(JSON.stringify(payload))?.hostKey).toBe('hk_123')
  })

  it('非法 payload 与配对码', () => {
    expect(parsePairingQrPayload('not json')).toBeNull()
    expect(parsePairingQrPayload(JSON.stringify({ ...payload, code: '12ab56' }))).toBeNull()
    expect(parsePairingQrPayload(JSON.stringify({ ...payload, gatewayUrl: 'https://x' }))).toBeNull()
    expect(isValidPairingCode('12345')).toBe(false)
    expect(isValidPairingCode('123456')).toBe(true)
  })
})

describe('relay frames', () => {
  it('presence 帧解析', () => {
    const frame = {
      kind: 'presence',
      workers: [
        {
          workerId: 'w1',
          name: 'mac-mini',
          hostFingerprint: 'fp1',
          online: true,
          lastSeenAt: 123,
          capabilities: { dshVersion: null, protocolVersion: 'mobile/v1' },
        },
      ],
    }
    const parsed = parseGatewayToPhoneFrame(frame)
    expect(parsed?.kind).toBe('presence')
    if (parsed?.kind === 'presence') {
      expect(parsed.workers[0]?.name).toBe('mac-mini')
    }
  })

  it('未知帧返回 null', () => {
    expect(parseGatewayToPhoneFrame({ kind: 'mystery' })).toBeNull()
    expect(parseGatewayToPhoneFrame('x')).toBeNull()
  })
})

describe('ws frames', () => {
  it('phone 帧往返', () => {
    const frame = { kind: 'rpc', request: { id: 'q1', ns: 'sessions', method: 'list', args: {} } }
    expect(parsePhoneFrame(serializePhoneFrame(frame))).toEqual(frame)
  })

  it('auth 与 pong', () => {
    expect(parsePhoneFrame('{"kind":"auth","token":"t"}')).toEqual({ kind: 'auth', token: 't' })
    expect(parsePhoneFrame('{"kind":"pong","nonce":7}')).toEqual({ kind: 'pong', nonce: 7 })
    expect(parsePhoneFrame('{bad')).toBeNull()
  })

  it('preview 帧解析', () => {
    expect(parsePhoneFrame('{"kind":"preview","requestId":"pv1","path":"/ws/a/snake.html"}'))
      .toEqual({ kind: 'preview', requestId: 'pv1', path: '/ws/a/snake.html' })
    expect(parsePhoneFrame('{"kind":"preview","requestId":"pv1"}')).toBeNull()
    expect(parsePhoneFrame('{"kind":"preview","requestId":"pv1","path":"relative"}')).toBeNull()
  })
})

describe('server requests', () => {
  it('审批与问题请求解析', () => {
    const perm = parseServerRequest({
      kind: 'permission',
      body: { requestId: 'r1', sessionId: 's1', summary: 'rm -rf /tmp/x' },
    })
    expect(perm?.kind).toBe('permission')

    const q = parseServerRequest({
      kind: 'question',
      body: { requestId: 'r2', sessionId: 's1', question: '用哪个分支？', options: ['main', 'dev'] },
    })
    expect(q?.kind).toBe('question')
    if (q?.kind === 'question') expect(q.body.options).toEqual(['main', 'dev'])

    expect(parseServerRequest({ kind: 'other', body: {} })).toBeNull()
  })
})
