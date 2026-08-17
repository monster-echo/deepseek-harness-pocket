import { describe, expect, it } from 'vitest';
import { parseOrderStatus, type CreateOrderResult } from '../payment/paymentModels';
import type { BillingPlan, OrderView } from '../domain/models';

describe('payment models', () => {
  it('parseOrderStatus maps known values and defaults unknown to pending', () => {
    expect(parseOrderStatus('success')).toBe('success');
    expect(parseOrderStatus('refunded')).toBe('refunded');
    expect(parseOrderStatus('weird')).toBe('pending');
  });

  it('BillingPlan carries storeProductMapping', () => {
    const plan: BillingPlan = {
      id: 'pro-monthly', tierId: 'pro', name: 'Pro', interval: 'month',
      priceMinor: 1800, currency: 'CNY', provider: 'mock',
      storeProductMapping: { apple: 'com.x.pro', google: 'pro_g', hms: 'pro_h' },
    };
    expect(plan.storeProductMapping?.apple).toBe('com.x.pro');
  });

  it('OrderView.status is a typed OrderStatus', () => {
    const order: OrderView = {
      id: 'o1', planId: 'pro-monthly', status: parseOrderStatus('success'),
      amountMinor: 1800, currency: 'CNY', provider: 'mock', createdAt: 'now', completedAt: null,
    };
    expect(order.status).toBe('success');
  });

  it('CreateOrderResult shape', () => {
    const r: CreateOrderResult = { orderId: 'o1', storeProductId: 'com.x.pro', status: 'pending' };
    expect(r.storeProductId).toBe('com.x.pro');
  });
});
