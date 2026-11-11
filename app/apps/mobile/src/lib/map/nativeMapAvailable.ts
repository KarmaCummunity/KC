// #1951: the Google Maps SDK throws when MapView mounts in an Android build without
// `com.google.android.geo.API_KEY`. app.config.ts records whether the key was present.
export function isNativeMapAvailable(
  platformOS: string,
  extra: Readonly<{ googleMapsConfigured?: unknown }> | null | undefined,
): boolean {
  if (platformOS !== 'android') return true;
  return extra?.googleMapsConfigured === true;
}
