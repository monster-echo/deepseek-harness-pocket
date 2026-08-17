import { describe, expect, it } from 'vitest';
import { MockPaymentProvider } from '../payment/mockPaymentProvider';

describe('MockPaymentProvider', () => {
  it('purchase returns a receipt with the productId', async () => {
    const p = new MockPaymentProvider();
    const r = await p.purchase('com.x.pro');
    expect(r.storeProductId).toBe('com.x.pro');
    expect((r.receipt as { productId: string }).productId).toBe('com.x.pro');
  });

  it('failPurchases=true yields a fail receipt', async () => {
    const p = new MockPaymentProvider();
    p.failPurchases = true;
    const r = await p.purchase('com.x.pro');
    expect((r.receipt as { fail: boolean }).fail).toBe(true);
  });

  it('restore replays purchased products', async () => {
    const p = new MockPaymentProvider();
    await p.purchase('com.x.pro');
    await p.purchase('pro_g');
    const restored = await p.restore();
    expect(restored.map((r) => r.storeProductId).sort()).toEqual(['com.x.pro', 'pro_g']);
  });
});
