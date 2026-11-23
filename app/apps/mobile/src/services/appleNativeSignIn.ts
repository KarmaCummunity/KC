// FR-AUTH-004 (iOS): native Sign in with Apple sheet → identity token + raw nonce for Supabase.
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import type { PerformAppleSignIn } from '@kc/application';

/** Random hex nonce. Apple receives SHA-256(nonce); Supabase verifies the raw value. */
function generateRawNonce(): string {
  const bytes = Crypto.getRandomBytes(16);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function isAppleCancellation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'ERR_REQUEST_CANCELED'
  );
}

/**
 * Drives the native Sign in with Apple sheet and returns the identity token +
 * raw nonce for Supabase, plus the first-authorization name (Apple delivers it
 * once). Resolves null when the user cancels the sheet.
 */
export const performAppleSignIn: PerformAppleSignIn = async () => {
  const rawNonce = generateRawNonce();
  const hashedNonce = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, rawNonce);
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
      nonce: hashedNonce,
    });
    if (!credential.identityToken) return null;
    const fullName = [credential.fullName?.givenName, credential.fullName?.familyName]
      .filter(Boolean)
      .join(' ')
      .trim();
    return {
      identityToken: credential.identityToken,
      rawNonce,
      fullName: fullName.length > 0 ? fullName : null,
    };
  } catch (err) {
    if (isAppleCancellation(err)) return null;
    throw err;
  }
};
