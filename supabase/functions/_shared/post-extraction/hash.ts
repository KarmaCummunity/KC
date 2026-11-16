// supabase/functions/_shared/post-extraction/hash.ts
// SHA-256 hex of the canonical text (FR-IMPORT-008 AC1): the key of the cache and of the
// cross-post guard. Web Crypto, so it needs no import and works in Deno and Node alike.

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}
