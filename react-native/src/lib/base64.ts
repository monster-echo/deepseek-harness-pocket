/**
 * Base64 解码（无第三方依赖）。
 *
 * RN 运行时没有 `atob`；Expo 的 winter runtime 提供全局 `TextDecoder`，
 * 因此这里只实现 base64 → 字节，再由 TextDecoder 转 UTF-8 文本。
 */

const TABLE = (() => {
  const table = new Uint8Array(256).fill(255);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  for (let i = 0; i < chars.length; i += 1) table[chars.charCodeAt(i)] = i;
  return table;
})();

/** base64（可含 data URI 前缀与换行/填充）→ 字节。非法字符跳过。 */
export function base64ToBytes(input: string): Uint8Array {
  const comma = input.indexOf(',');
  const body = input.startsWith('data:') && comma >= 0 ? input.slice(comma + 1) : input;
  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let written = 0;
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < body.length; i += 1) {
    const code = body.charCodeAt(i);
    // 跳过 '='、换行、空白
    if (code === 61 || code === 10 || code === 13 || code === 32 || code === 9) continue;
    const value = TABLE[code];
    if (value === undefined || value === 255) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      written += 1;
      out[written - 1] = (buffer >> bits) & 0xff;
    }
  }
  return out.subarray(0, written);
}

/** base64 → UTF-8 文本（非法字节替换为 U+FFFD）。 */
export function base64ToText(input: string): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(base64ToBytes(input));
}
