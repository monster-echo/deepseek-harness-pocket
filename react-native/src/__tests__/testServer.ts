// Real-server test helper (mirrors flutter/test/payment/test_server.dart).
// NOTE: tests mutate module-level apiClient readers (e.g. setSessionTokenReader)
// to switch accounts — sequential-only; do not enable parallel vitest.
// E2E_AUTH_URL：真实服务器用例仅在显式提供该地址时运行（避免误连生产）。
const apiBase = process.env.E2E_AUTH_URL ?? process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3210';
const appId = process.env.EXPO_PUBLIC_APP_ID ?? 'dshcompanion';
const appEnv = process.env.EXPO_PUBLIC_APP_ENVIRONMENT ?? 'test';
export const hasE2eServer = Boolean(process.env.E2E_AUTH_URL);

export async function signUpAndGetToken(email: string): Promise<string> {
  const response = await fetch(`${apiBase}/api/v1/auth/sign-up`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-app-id': appId,
      'x-app-environment': appEnv,
      'x-platform': 'ios',
    },
    body: JSON.stringify({
      email,
      password: 'Test1234',
      username: email.split('@')[0].slice(0, 24),
      consentVersion: '2026-07-29',
    }),
  });
  if (response.status !== 201) {
    throw new Error(`sign-up failed (${response.status}): ${await response.text()}`);
  }
  const body = await response.json() as { data: { token: string } };
  return body.data.token;
}
