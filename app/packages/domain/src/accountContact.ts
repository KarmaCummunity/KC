// How Settings shows a member's sign-in identity (FR-SETTINGS-002 AC1, AC3; FR-SETTINGS-013):
// the sign-in method, and the email or phone the account is tied to, masked so a shoulder or a
// screenshot does not reveal it.
import type { AuthProvider } from './value-objects';

const AUTH_PROVIDERS: readonly AuthProvider[] = ['google', 'apple', 'phone', 'email'];

/** Character that stands for hidden characters of a masked contact. */
const MASK = '•';

/** The sign-in method a server value names, or null for a method the app does not know. */
export function parseAuthProvider(value: unknown): AuthProvider | null {
  return typeof value === 'string' && (AUTH_PROVIDERS as readonly string[]).includes(value)
    ? (value as AuthProvider)
    : null;
}

/** True for the providers that manage the sign-in themselves (no password in KC). */
export function isSsoProvider(provider: AuthProvider | null): provider is 'google' | 'apple' {
  return provider === 'google' || provider === 'apple';
}

/**
 * "dana.levi@example.com" → "d•••i@example.com". The domain stays readable so the member
 * recognises the address; the name keeps its first letter, and its last one when it has
 * more than two. Text that is not an address is hidden whole.
 */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at <= 0) return MASK.repeat(3);
  const name = email.slice(0, at);
  const last = name.length > 2 ? name.slice(-1) : '';
  return `${name[0]}${MASK.repeat(3)}${last}${email.slice(at)}`;
}

/** "+972 50-123-4567" → "+••• ••-•••-•567": every digit but the last three is hidden. */
export function maskPhone(phone: string): string {
  // A digit is hidden when at least three more digits follow it, wherever the separators are.
  return phone.replace(/\d(?=(?:\D*\d){3})/g, MASK);
}
