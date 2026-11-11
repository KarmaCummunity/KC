// #1955: client IDs are baked in by app.config.ts. iOS also needs its own client ID, which
// app.config.ts turns into the URL scheme the Google SDK requires; without it the SDK can't open.
export type GoogleNativeSignInConfig = Readonly<{ webClientId: string; iosClientId?: string }>;

type ExtraLike = Readonly<{ googleWebClientId?: unknown; googleIosClientId?: unknown }> | null | undefined;

function nonBlank(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function resolveGoogleNativeSignInConfig(platformOS: string, extra: ExtraLike): GoogleNativeSignInConfig | null {
  const webClientId = nonBlank(extra?.googleWebClientId);
  if (!webClientId) return null;
  if (platformOS === 'android') return { webClientId };
  if (platformOS !== 'ios') return null;
  const iosClientId = nonBlank(extra?.googleIosClientId);
  return iosClientId ? { webClientId, iosClientId } : null;
}
