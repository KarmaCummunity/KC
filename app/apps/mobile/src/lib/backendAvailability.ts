// The UI side of the degrade rule (docs/db/app-migration-playbook.md). An adapter whose backend
// object is not deployed throws `BackendUnavailableError`; these helpers decide what the screen
// does with it, so no screen reads `error.message` of an unknown error:
//   - a list loads through `listOrEmpty` and shows its empty state;
//   - an action runs through `runAction` and shows `notAvailableMessage()` when it is unavailable;
//   - a world whose `world_<slug>_enabled` flag is off never renders an entry point
//     (`useLaunchWorldEnabled`), so it never reaches either helper.
// Every other error is rethrown: an unexpected failure must stay visible, never become "empty".
import { BackendUnavailableError } from '@kc/domain';
import i18n from '../i18n';

export function isBackendUnavailable(error: unknown): error is BackendUnavailableError {
  return error instanceof BackendUnavailableError;
}

/** Loads a list; an unavailable backend yields an empty list. */
export async function listOrEmpty<T>(load: () => Promise<readonly T[]>): Promise<T[]> {
  try {
    return [...(await load())];
  } catch (error) {
    if (isBackendUnavailable(error)) return [];
    throw error;
  }
}

/** Loads one optional value; an unavailable backend yields `null`. */
export async function valueOrNull<T>(load: () => Promise<T | null>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    if (isBackendUnavailable(error)) return null;
    throw error;
  }
}

export type ActionOutcome<T> =
  | { readonly status: 'done'; readonly value: T }
  | { readonly status: 'unavailable' };

/** Runs an action; an unavailable backend yields `{ status: 'unavailable' }` instead of throwing. */
export async function runAction<T>(action: () => Promise<T>): Promise<ActionOutcome<T>> {
  try {
    return { status: 'done', value: await action() };
  } catch (error) {
    if (isBackendUnavailable(error)) return { status: 'unavailable' };
    throw error;
  }
}

/** The generic "not available yet" message (locale files, he + en). */
export function notAvailableMessage(): string {
  return i18n.t('backend.notAvailableYet');
}

/** Caption for an empty state that is empty because the backend does not provide the list yet. */
export function listUnavailableMessage(): string {
  return i18n.t('backend.listUnavailable');
}
