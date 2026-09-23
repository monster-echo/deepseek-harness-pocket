import { describe, expect, it } from 'vitest';
import { base64ToBytes, base64ToText } from '../lib/base64';

function encode(text: string): string {
  return Buffer.from(text, 'utf-8').toString('base64');
}

describe('base64ToText', () => {
  it('解码 ASCII', () => {
    expect(base64ToText(encode('hello world'))).toBe('hello world');
  });

  it('解码多字节 UTF-8（中文与 emoji）', () => {
    const source = '掌鲸 · DSH Pocket 🐳';
    expect(base64ToText(encode(source))).toBe(source);
  });

  it('容忍 data URI 前缀', () => {
    expect(base64ToText(`data:text/plain;base64,${encode('ok')}`)).toBe('ok');
  });

  it('容忍换行与填充', () => {
    const b64 = encode('line1\nline2');
    const messy = b64.slice(0, 4) + '\n' + b64.slice(4);
    expect(base64ToText(messy)).toBe('line1\nline2');
  });

  it('空串解码为空', () => {
    expect(base64ToText('')).toBe('');
  });
});

describe('base64ToBytes', () => {
  it('返回正确字节长度与内容', () => {
    const bytes = base64ToBytes(encode('abc'));
    expect(bytes.length).toBe(3);
    expect(Array.from(bytes)).toEqual([97, 98, 99]);
  });

  it('二进制字节不被截断', () => {
    const raw = Buffer.from([0, 1, 2, 250, 255]).toString('base64');
    expect(Array.from(base64ToBytes(raw))).toEqual([0, 1, 2, 250, 255]);
  });
});
