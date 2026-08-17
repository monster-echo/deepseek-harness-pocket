import { beforeAll, describe, expect, it } from 'vitest';
import { apiClient, setAnonymousIdReader, setPlatformHeader, setRefreshTokenReader, setSessionTokenReader } from '../data/apiClient';
import { MockPaymentProvider } from '../payment/mockPaymentProvider';
import { signUpAndGetToken } from './testServer';

describe('purchase flow (real server)', () => {
  let token: string;
  beforeAll(async () => {
    setPlatformHeader('ios');
    setAnonymousIdReader(async () => 'test-installation');
    setRefreshTokenReader(async () => null);
    setSessionTokenReader(async () => token);
    token = await signUpAndGetToken(`p13-flow-${Date.now()}@test.local`);
  });

  it('createOrder → mock purchase → verify → success + entitlements', async () => {
    const order = await apiClient.createOrder('pro-monthly', `flow-${Date.now()}`);
    expect(order.status).toBe('pending');
    expect(order.storeProductId).toBeTruthy();

    const provider = new MockPaymentProvider();
    const result = await provider.purchase(order.storeProductId);
    const verified = await apiClient.verifyPurchase(order.orderId, result.receipt);
    expect(verified.status).toBe('success');

    const mc = await apiClient.membershipCurrent();
    expect(mc.entitlements.length).toBeGreaterThan(0);
  });

  it('failPurchases → order failed, no entitlements', async () => {
    // Fresh account so the success test's persisted entitlements don't leak in.
    token = await signUpAndGetToken(`p13-flow-fail-${Date.now()}@test.local`);
    const order = await apiClient.createOrder('pro-monthly', `flow-fail-${Date.now()}`);
    const provider = new MockPaymentProvider();
    provider.failPurchases = true;
    const result = await provider.purchase(order.storeProductId);
    const verified = await apiClient.verifyPurchase(order.orderId, result.receipt);
    expect(verified.status).toBe('failed');
    const mc = await apiClient.membershipCurrent();
    expect(mc.entitlements.length).toBe(0);
  });

  it('verify rejects another user order (ORDER_NOT_FOUND)', async () => {
    // owner creates an order with their own session
    const ownerToken = await signUpAndGetToken(`p13-own-${Date.now()}@test.local`);
    setSessionTokenReader(async () => ownerToken);
    const owner = await apiClient.createOrder('pro-monthly', `own-${Date.now()}`);
    // switch back to the attacker session (the outer `token`)
    setSessionTokenReader(async () => token);
    await expect(
      apiClient.verifyPurchase(owner.orderId, { productId: owner.storeProductId }),
    ).rejects.toThrow();
  });

  it('same idempotencyKey → same orderId', async () => {
    const key = `idem-${Date.now()}`;
    const a = await apiClient.createOrder('pro-monthly', key);
    const b = await apiClient.createOrder('pro-monthly', key);
    expect(a.orderId).toBe(b.orderId);
  });

  it('restore replays purchases', async () => {
    const order = await apiClient.createOrder('pro-monthly', `restore-${Date.now()}`);
    const provider = new MockPaymentProvider();
    await provider.purchase(order.storeProductId);
    const receipts = (await provider.restore()).map((r) => r.receipt);
    const { entitlements: keys } = await apiClient.restore(receipts);
    expect(keys.length).toBeGreaterThan(0);
  });
});
