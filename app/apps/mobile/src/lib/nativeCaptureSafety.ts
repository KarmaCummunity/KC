// Positive allowlist for optional native evidence. Never changes form data or submission.
export const nativeCaptureMarkers = {
  profile: { testID: 'native-profile-capture-safe' },
  create: { testID: 'native-create-capture-safe' },
};
const seededCity = (city: { name: string } | null) => city === null || ['נתניה', 'NETANYA', 'Netanya'].includes(city.name);
type CaptureSession = { userId: string; email?: string | null; phone?: string | null } | null | undefined;
export function safeNativeIdentity(session: CaptureSession): boolean {
  return Boolean(session?.userId && session.email === 'user1@seed.kc.test' &&
    (session.phone === null || session.phone === undefined || session.phone === ''));
}
export function safeNativeProfile(form: {
  displayName: string; dateOfBirth: string | null; avatarUrl: string | null;
  contactPhone: string; biography: string; street: string; streetNumber: string;
  city: { name: string } | null; loading: boolean;
}, session: CaptureSession): boolean {
  return safeNativeIdentity(session) && !form.loading && form.displayName === 'E2E Member 1' &&
    (form.dateOfBirth === null || form.dateOfBirth === '1990-01-01') &&
    form.avatarUrl === null && form.contactPhone === '' && form.biography === '' &&
    form.street === '' && form.streetNumber === '' && seededCity(form.city);
}
export function safeNativeCreate(form: {
  title: string; description: string; uploads: readonly unknown[];
}, city: { name: string } | null, street: string, streetNumber: string,
ready: boolean, draftPhase: string, engine: string, session: CaptureSession): boolean {
  return safeNativeIdentity(session) && ready && engine === 'post' && draftPhase === 'none' && form.title === '' &&
    form.description === '' && form.uploads.length === 0 && street === '' &&
    streetNumber === '' && seededCity(city);
}
