import { beforeAll, describe, expect, it } from 'vitest';
import { apiClient, setAnonymousIdReader, setPlatformHeader, setRefreshTokenReader, setSessionTokenReader, setSessionTokenWriter, setRefreshTokenWriter } from '../data/apiClient';
import { signUpAndGetToken, hasE2eServer } from './testServer';

describe.skipIf(!hasE2eServer)('apiClient (real server)', () => {
  let token: string;
  beforeAll(async () => {
    setPlatformHeader('ios');
    setAnonymousIdReader(async () => 'test-installation');
    setRefreshTokenReader(async () => null);
    setSessionTokenReader(async () => token);
    setSessionTokenWriter(async () => {});
    setRefreshTokenWriter(async () => {});
    token = await signUpAndGetToken(`p13-api-${Date.now()}@test.local`);
  });

  it('bootstrap returns a config', async () => {
    const boot = await apiClient.bootstrap();
    expect(boot.config?.plans?.length ?? 0).toBeGreaterThan(0);
  });

  it('orders() returns an empty list for a fresh user', async () => {
    const orders = await apiClient.orders();
    expect(orders).toHaveLength(0);
  });
});
