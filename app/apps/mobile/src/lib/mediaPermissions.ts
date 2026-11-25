// Shared camera / photo-library permission gate (App Store 5.1.1(iv)).
// Look up the current status first: a system prompt is shown only when the OS
// can still ask. A denial is silent. A later tap, once the OS will not ask
// again, is reported as `blocked` so the UI can show a short note with a
// user-initiated Settings link — never an automatic redirect or a reconsider
// alert after "Don't Allow".
import * as ImagePicker from 'expo-image-picker';
import type { MediaPermissionKind, MediaPermissionOutcome } from './mediaPermissionTypes';

export type { MediaPermissionKind, MediaPermissionOutcome, MediaPickResult } from './mediaPermissionTypes';
export { blockedPick, isBlockedMediaPick } from './mediaPermissionTypes';

function apiFor(kind: MediaPermissionKind) {
  return kind === 'camera'
    ? { get: ImagePicker.getCameraPermissionsAsync, request: ImagePicker.requestCameraPermissionsAsync }
    : { get: ImagePicker.getMediaLibraryPermissionsAsync, request: ImagePicker.requestMediaLibraryPermissionsAsync };
}

export async function ensureMediaPermission(kind: MediaPermissionKind): Promise<MediaPermissionOutcome> {
  const { get, request } = apiFor(kind);
  const current = await get();
  if (current.granted) return 'granted';
  if (current.canAskAgain === false) return 'blocked';
  const next = await request();
  return next.granted ? 'granted' : 'denied';
}
