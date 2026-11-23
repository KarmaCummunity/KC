// Maps supabase-js Session + user_metadata onto the application AuthSession shape.
import type { Session as SbSession } from '@supabase/supabase-js';
import type { AuthProfileMetadataPatch, AuthSession } from '@kc/application';
import { parseAuthProvider } from '@kc/domain';

/** Maps profile fields to keys read by `toSession` (full_name/name, avatar_url/picture). */
export function buildAuthMetadataPayload(patch: AuthProfileMetadataPatch): Record<string, string | null> {
  const data: Record<string, string | null> = {};
  if (patch.displayName !== undefined) {
    const name = patch.displayName.trim();
    data.full_name = name;
    data.name = name;
  }
  if (patch.avatarUrl !== undefined) {
    data.avatar_url = patch.avatarUrl;
    data.picture = patch.avatarUrl;
  }
  return data;
}

export function toSession(s: SbSession): AuthSession {
  const meta = (s.user.user_metadata ?? {}) as Record<string, unknown>;
  return {
    userId: s.user.id,
    email: s.user.email ?? null,
    emailVerified: Boolean(s.user.email_confirmed_at),
    accessToken: s.access_token,
    refreshToken: s.refresh_token,
    expiresAt: s.expires_at ?? Math.floor(Date.now() / 1000) + (s.expires_in ?? 3600),
    displayName: pickString(meta, ['full_name', 'name']),
    avatarUrl: pickString(meta, ['avatar_url', 'picture']),
    accountCreatedAt: s.user.created_at ?? null,
    signInProvider: parseAuthProvider(s.user.app_metadata?.provider),
    // Supabase reports "no phone" as an empty string.
    phone: s.user.phone ? s.user.phone : null,
  };
}

function pickString(meta: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const k of keys) {
    const v = meta[k];
    if (typeof v === 'string' && v.trim().length > 0) return v;
  }
  return null;
}
