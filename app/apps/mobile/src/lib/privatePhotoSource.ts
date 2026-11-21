// PRIVATE CAPABILITY PROTOTYPE, not wired into any upload/read/render path.
// A ready row and bucket policy still decide access on the server. This builder grants nothing.
// Protected sources never use public URLs, query tokens, transforms or fallback URLs.
export type PrivatePhotoVariant = 'full' | 'thumb';
export interface PrivatePhotoRef {
  readonly mediaId: string;
  readonly generation: number;
  readonly variant: PrivatePhotoVariant;
  /** App-owned, policy-protected private bucket. Does not exist merely because named here. */
  readonly bucket: 'post-photo-derived-private';
  readonly path: string;
  readonly state: 'ready' | 'pending' | 'revoked';
}
export interface PrivatePhotoSession {
  readonly principalId: string;
  readonly accessToken: string;
  readonly expiresAtSeconds: number;
}
export interface PrivatePhotoSource {
  readonly source: { readonly uri: string; readonly headers: Readonly<Record<string, string>>; readonly cacheKey: string };
  readonly cachePolicy: 'none';
  readonly recyclingKey: string;
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns no source unless all local transport prerequisites hold. Server authorization remains mandatory. */
export function privatePhotoSource(
  supabaseUrl: string,
  photo: PrivatePhotoRef,
  session: PrivatePhotoSession | null,
  nowSeconds: number,
): PrivatePhotoSource | null {
  if (!session || photo.state !== 'ready' || !UUID.test(photo.mediaId) || !UUID.test(session.principalId)
    || !Number.isSafeInteger(photo.generation) || photo.generation < 1
    || !Number.isFinite(nowSeconds) || !Number.isFinite(session.expiresAtSeconds)
    || session.expiresAtSeconds <= nowSeconds + 30 || !session.accessToken || /[\r\n]/.test(session.accessToken)
    || photo.bucket !== 'post-photo-derived-private' || !['full', 'thumb'].includes(photo.variant)) return null;
  let base: URL;
  try { base = new URL(supabaseUrl); } catch { return null; }
  // Only the configured provider origin, never a URL from a media row. No custom destination/query/credentials.
  if (base.protocol !== 'https:' || !/^[a-z0-9]{20}\.supabase\.co$/.test(base.hostname)
    || base.username || base.password || base.port || base.search || base.hash || base.pathname !== '/') return null;
  const expected = `${photo.mediaId}/g${photo.generation}/${photo.variant}.jpg`;
  if (photo.path !== expected) return null;
  const identity = `${session.principalId}:${photo.mediaId}:g${photo.generation}:${photo.variant}`;
  return {
    source: { uri: `${base.origin}/storage/v1/object/authenticated/${photo.bucket}/${expected}`,
      headers: { Authorization: `Bearer ${session.accessToken}` }, cacheKey: identity },
    cachePolicy: 'none', recyclingKey: identity,
  };
}
