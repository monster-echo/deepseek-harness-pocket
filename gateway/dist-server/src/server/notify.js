/**
 * 通知投递：在线手机走 WS push 帧；离线走 Expo Push API（iOS/APNs）。
 * Android 国内通道未定（可替换实现，见决议记录）。
 */
export function createPushSender(config, store) {
    return async (userId, title, body, sessionId) => {
        if (config.expoAccessToken.length === 0)
            return;
        const tokens = await store.listPushTokens(userId);
        if (tokens.length === 0)
            return;
        try {
            const response = await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    authorization: `Bearer ${config.expoAccessToken}`,
                },
                body: JSON.stringify(tokens.map((to) => ({
                    to,
                    title,
                    body,
                    sound: 'default',
                    ...(sessionId !== undefined ? { data: { sessionId } } : {}),
                }))),
                signal: AbortSignal.timeout(8000),
            });
            if (!response.ok) {
                console.warn(`expo push failed: ${response.status}`);
            }
        }
        catch (error) {
            console.warn(`expo push error: ${error instanceof Error ? error.message : String(error)}`);
        }
    };
}
//# sourceMappingURL=notify.js.map