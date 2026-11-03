// FR-ADMIN-002..005 — confirmation + toast helpers for admin actions invoked
// from system-message bubbles. Centralised so each subcomponent stays small
// and the confirm/toast UX is consistent.
import { Alert, ToastAndroid, Platform } from 'react-native';
import { ModerationError } from '@kc/application';
import i18n from '../../../i18n';

export type AdminActionKey =
  | 'restore'
  | 'dismiss'
  | 'confirm'
  | 'ban'
  | 'removePost'
  | 'deleteMessage';

export interface ConfirmAndRunOpts {
  action: AdminActionKey;
  onConfirm: () => Promise<void>;
  onSuccess: () => void;
  onError: (msg: string) => void;
  /**
   * The admin backed out of the confirmation (web `confirm` → false, the native
   * cancel button, or an Android outside-tap dismiss). Callers that marked
   * themselves busy before asking reset here (TD-251).
   */
  onCancel?: () => void;
}

export function confirmAndRun({ action, onConfirm, onSuccess, onError, onCancel }: ConfirmAndRunOpts): void {
  if (Platform.OS === 'web') {
    const ok = globalThis.window?.confirm(
      `${i18n.t(`moderation.actions.${action}`)}\n\n${i18n.t(`moderation.actions.confirmModal.${action}`)}`,
    );
    if (ok) {
      onConfirm()
        .then(onSuccess)
        .catch((e: unknown) => onError(errorMessage(e)));
    } else {
      onCancel?.();
    }
    return;
  }
  Alert.alert(
    i18n.t(`moderation.actions.${action}`),
    i18n.t(`moderation.actions.confirmModal.${action}`),
    [
      { text: i18n.t('moderation.actions.cancel'), style: 'cancel', onPress: onCancel },
      {
        text: i18n.t('moderation.actions.proceed'),
        style: 'destructive',
        onPress: async () => {
          try {
            await onConfirm();
            onSuccess();
          } catch (e: unknown) {
            onError(errorMessage(e));
          }
        },
      },
    ],
    { cancelable: true, onDismiss: onCancel },
  );
}

export function showAdminToast(msg: string): void {
  if (Platform.OS === 'android') {
    ToastAndroid.show(msg, ToastAndroid.SHORT);
  } else if (Platform.OS === 'web') {
    globalThis.window?.alert(msg);
  } else {
    Alert.alert(msg);
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof ModerationError) {
    if (e.code === 'forbidden') return i18n.t('moderation.actions.errors.forbidden');
    if (e.code === 'invalid_restore_state') return i18n.t('moderation.actions.errors.invalidRestoreState');
  }
  return i18n.t('moderation.actions.errors.networkError');
}
