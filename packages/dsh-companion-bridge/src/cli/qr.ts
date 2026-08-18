/**
 * 配对二维码与摘要打印。
 */

import qrcodeTerminal from 'qrcode-terminal'
import type { PairingQrPayload } from '@dsh-companion/bridge-protocol'

export function printPairing(payload: PairingQrPayload): void {
  const text = JSON.stringify(payload)
  process.stdout.write('\n┌─────────────────────────────────────────────┐\n')
  process.stdout.write('│  掌鲸 DSH Pocket 配对                         │\n')
  process.stdout.write('│  打开手机 App → 扫码，或手动输入配对码       │\n')
  process.stdout.write('├─────────────────────────────────────────────┤\n')
  qrcodeTerminal.generate(text, { small: true }, (qr: string) => process.stdout.write(qr))
  process.stdout.write(`  配对码   ${payload.code}\n`)
  process.stdout.write(`  Gateway  ${payload.gatewayUrl}\n`)
  if (payload.lanUrl !== undefined) process.stdout.write(`  直连     ${payload.lanUrl}\n`)
  process.stdout.write(`  主机指纹 ${payload.fingerprint}\n`)
  process.stdout.write('└─────────────────────────────────────────────┘\n\n')
}
