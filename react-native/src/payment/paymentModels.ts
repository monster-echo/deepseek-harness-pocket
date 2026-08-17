export type StoreProductMapping = Readonly<{ apple?: string; google?: string; hms?: string }>;

export type StoreProduct = Readonly<{ storeProductId: string; title?: string }>;

export type PurchaseResult = Readonly<{ storeProductId: string; receipt: unknown }>;

export type Entitlement = Readonly<{ key: string; expiresAt: string | null }>;

export type Subscription = Readonly<{ planId: string; status: string; renewAt: string | null }>;

export type MembershipCurrent = Readonly<{
  tier: string | null;
  entitlements: readonly Entitlement[];
  subscription: Subscription | null;
}>;

export type CreateOrderResult = Readonly<{
  orderId: string;
  storeProductId: string;
  status: string;
}>;

export type OrderStatus = 'pending' | 'processing' | 'success' | 'failed' | 'refunded';

export function parseOrderStatus(value: string): OrderStatus {
  return (['pending', 'processing', 'success', 'failed', 'refunded'] as const)
    .includes(value as OrderStatus) ? value as OrderStatus : 'pending';
}
