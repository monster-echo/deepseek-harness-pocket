import type { PurchaseResult, StoreProduct, StoreProductMapping } from './paymentModels';

export interface PaymentProvider {
  loadProducts(mapping: StoreProductMapping | null): Promise<readonly StoreProduct[]>;
  purchase(storeProductId: string): Promise<PurchaseResult>;
  restore(): Promise<readonly PurchaseResult[]>;
}
