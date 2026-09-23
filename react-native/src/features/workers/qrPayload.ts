/**
 * 扫码结果解析（薄封装协议包的配对 / 桌面端登录授权负载解析）。
 *
 * 单独一层是为了让屏幕组件与协议包解耦：屏幕只关心「是不是配对码 / 授权码 + 拿到什么字段」。
 */

import {
  parseDeviceLinkQr,
  parsePairQr,
  type DeviceLinkQrPayload,
  type PairQrPayload,
} from '@deepseek-harness-pocket/bridge-protocol';

export type PairScan = PairQrPayload;

export type LinkScan = DeviceLinkQrPayload;

/**
 * 解析相机扫到的文本。
 * 不是配对二维码时返回 null（屏幕上提示「不是配对二维码」并继续扫）。
 */
export function parsePairScan(text: string): PairScan | null {
  return parsePairQr(text);
}

/**
 * 解析相机扫到的文本，识别「手机扫码授权桌面端登录」二维码（`dshp://link?...`）。
 * 不是授权登录二维码时返回 null（屏幕继续扫并提示）。
 */
export function parseLinkScan(text: string): LinkScan | null {
  return parseDeviceLinkQr(text);
}
