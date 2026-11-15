// RevenueCat SDK bootstrap + paywall helpers (Pro tier). No-op on web / when the public key is missing.
// app_user_id = KC user id so the revenuecat-webhook can map purchases to public.user_entitlements.
import { Platform } from 'react-native';

type PurchasesModule = typeof import('react-native-purchases').default;

let configured = false;
let currentUser: string | null = null;

function publicKey(): string {
  if (Platform.OS === 'ios') return process.env['EXPO_PUBLIC_REVENUECAT_IOS_KEY'] ?? '';
  if (Platform.OS === 'android') return process.env['EXPO_PUBLIC_REVENUECAT_ANDROID_KEY'] ?? '';
  return '';
}

async function load(): Promise<PurchasesModule | null> {
  if (Platform.OS === 'web' || !publicKey()) return null;
  try {
    return (await import('react-native-purchases')).default;
  } catch {
    return null;
  }
}

/** Idempotent: call with the signed-in KC user id, or null after sign-out. Never throws. */
export async function syncRevenueCatUser(userId: string | null): Promise<void> {
  if (userId === currentUser) return;
  const Purchases = await load();
  if (!Purchases) return;
  try {
    if (!configured) {
      Purchases.configure({ apiKey: publicKey(), appUserID: userId ?? undefined });
      configured = true;
    } else if (userId) {
      await Purchases.logIn(userId);
    } else if (!(await Purchases.isAnonymous())) {
      await Purchases.logOut();
    }
    currentUser = userId;
  } catch (e) {
    console.warn('[revenuecat] sync failed', String(e));
  }
}

/** A store package ready to render. `priceString` comes from the store (never hardcoded). */
export interface ProPackage {
  id: string;
  priceString: string;
  periodLabel: string | null;
  raw: unknown;
}

export type PurchaseResult = 'purchased' | 'cancelled' | 'failed';

/** Current offering's packages, or [] when the store is unavailable. Never throws. */
export async function getProPackages(): Promise<ProPackage[]> {
  const Purchases = await load();
  if (!Purchases || !configured) return [];
  try {
    const offerings = await Purchases.getOfferings();
    return (offerings.current?.availablePackages ?? []).map((p) => ({
      id: p.identifier,
      priceString: p.product.priceString,
      periodLabel: p.packageType ?? null,
      raw: p,
    }));
  } catch (e) {
    console.warn('[revenuecat] offerings failed', String(e));
    return [];
  }
}

export async function purchaseProPackage(pkg: ProPackage): Promise<PurchaseResult> {
  const Purchases = await load();
  if (!Purchases) return 'failed';
  try {
    await Purchases.purchasePackage(pkg.raw as Parameters<PurchasesModule['purchasePackage']>[0]);
    return 'purchased';
  } catch (e) {
    return (e as { userCancelled?: boolean }).userCancelled ? 'cancelled' : 'failed';
  }
}

export async function restoreProPurchases(): Promise<boolean> {
  const Purchases = await load();
  if (!Purchases) return false;
  try {
    const info = await Purchases.restorePurchases();
    return Boolean(info.entitlements.active['pro']);
  } catch {
    return false;
  }
}

/** Store page where the user manages / cancels the subscription. */
export function manageSubscriptionUrl(): string {
  return Platform.OS === 'ios'
    ? 'https://apps.apple.com/account/subscriptions'
    : 'https://play.google.com/store/account/subscriptions';
}
