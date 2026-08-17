// Real-server test helper (mirrors flutter/test/payment/test_server.dart).
// NOTE: tests mutate module-level apiClient readers (e.g. setSessionTokenReader)
// to switch accounts — sequential-only; do not enable parallel vitest.
const apiBase = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3210';
const appId = process.env.EXPO_PUBLIC_APP_ID;
const appEnv = process.env.EXPO_PUBLIC_APP_ENVIRONMENT;

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
