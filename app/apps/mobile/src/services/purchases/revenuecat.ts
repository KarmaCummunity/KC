// RevenueCat SDK bootstrap (Pro tier). iOS only for now; no-op on web / when the public key is missing.
// app_user_id = KC user id so the revenuecat-webhook can map purchases to public.user_entitlements.
import { Platform } from 'react-native';

type PurchasesModule = typeof import('react-native-purchases').default;

let configured = false;
let currentUser: string | null = null;

function publicKey(): string {
  return Platform.OS === 'ios' ? (process.env['EXPO_PUBLIC_REVENUECAT_IOS_KEY'] ?? '') : '';
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
