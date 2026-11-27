// Shared camera / photo-library permission results (App Store 5.1.1(iv)).
// Kept free of expo-image-picker so UI hooks can import it in tests without
// loading the native module.
export type MediaPermissionKind = 'camera' | 'mediaLibrary';
export type MediaPermissionOutcome = 'granted' | 'denied' | 'blocked';

export type MediaPickResult<T> =
  | { status: 'ok'; value: T }
  | { status: 'cancelled' }
  | { status: 'denied' }
  | { status: 'blocked'; kind: MediaPermissionKind };

export function blockedPick(kind: MediaPermissionKind): Extract<MediaPickResult<never>, { status: 'blocked' }> {
  return { status: 'blocked', kind };
}

export function isBlockedMediaPick<T>(result: MediaPickResult<T>): result is { status: 'blocked'; kind: MediaPermissionKind } {
  return result.status === 'blocked';
}
