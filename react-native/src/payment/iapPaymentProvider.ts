/**
 * RN IAP provider — server-authoritative, mirrors the Flutter IapPaymentProvider.
 *
 * iOS: sends transactionId → server calls Apple Server API getTransactionInfo.
 * Android: sends {productId, purchaseToken} → server calls Play Developer API.
 *
 * Uses `react-native-iap` (requires expo prebuild / dev client at runtime).
 * Lazy-require so typecheck passes even before the dep is installed.
 */
import type { PurchaseResult, StoreProduct, StoreProductMapping } from './paymentModels';
import type { PaymentProvider } from './paymentProvider';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RNIap: any;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  RNIap = require('react-native-iap');
} catch {
  RNIap = null;
}

export class IapPaymentProvider implements PaymentProvider {
  async loadProducts(mapping: StoreProductMapping | null): Promise<readonly StoreProduct[]> {
    if (!mapping || !RNIap) return [];
    const skus: string[] = [];
    if (mapping.apple) skus.push(mapping.apple);
    if (mapping.google) skus.push(mapping.google);
    if (skus.length === 0) return [];
    const products = await RNIap.getProducts({ skus });
    return (products as readonly { productId: string; title?: string }[])
      .map((p) => ({ storeProductId: p.productId, title: p.title }));
  }

  async purchase(storeProductId: string): Promise<PurchaseResult> {
    if (!RNIap) throw new Error('react-native-iap not installed');
    // Initiate purchase — the RNIap purchaseUpdatedListener delivers the result.
    await RNIap.requestPurchase({ sku: storeProductId });
    // In production, wire a purchaseUpdatedListener to capture the result.
    // For P-3b skeleton: the listener + result extraction pattern matches
    // Flutter's IapPaymentProvider (stream → completer). Full wiring needs
    // a dev-client runtime test (expo prebuild). Typecheck-clean.
    throw new Error('IapPaymentProvider.purchase: wire purchaseUpdatedListener at runtime');
  }

  async restore(): Promise<readonly PurchaseResult[]> {
    if (!RNIap) return [];
    const purchases = await RNIap.getAvailablePurchases();
    return (purchases as readonly { productId: string; transactionReceipt?: string; transactionId?: string }[])
      .map((p) => {
        const receipt = p.transactionId ?? p.transactionReceipt ?? '';
        return { storeProductId: p.productId, receipt };
      });
  }
}
