/**
 * 通知投递：在线手机走 WS push 帧；离线走 Expo Push API（iOS/APNs）。
 * Android 国内通道未定（可替换实现，见决议记录）。
 */
import type { Store } from './store.js';
import type { GatewayConfig } from './config.js';
export declare function createPushSender(config: GatewayConfig, store: Store): (userId: string, title: string, body: string, sessionId?: string) => Promise<void>;
