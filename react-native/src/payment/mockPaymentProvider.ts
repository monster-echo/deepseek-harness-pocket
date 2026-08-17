import type { PurchaseResult, StoreProduct, StoreProductMapping } from './paymentModels';
import type { PaymentProvider } from './paymentProvider';

export class MockPaymentProvider implements PaymentProvider {
  failPurchases = false;
  private readonly owned = new Set<string>();

  async loadProducts(mapping: StoreProductMapping | null): Promise<readonly StoreProduct[]> {
    if (!mapping) return [];
    return [
      ...(mapping.apple ? [{ storeProductId: mapping.apple }] : []),
      ...(mapping.google ? [{ storeProductId: mapping.google }] : []),
      ...(mapping.hms ? [{ storeProductId: mapping.hms }] : []),
    ];
  }

  async purchase(storeProductId: string): Promise<PurchaseResult> {
    const receipt: Record<string, unknown> = { productId: storeProductId };
    if (this.failPurchases) receipt.fail = true;
    else this.owned.add(storeProductId);
    return { storeProductId, receipt };
  }

  async restore(): Promise<readonly PurchaseResult[]> {
    return [...this.owned].map((id) => ({
      storeProductId: id,
      receipt: { productId: id },
    }));
  }
}
