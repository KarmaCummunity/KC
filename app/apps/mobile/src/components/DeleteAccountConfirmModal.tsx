// FR-SETTINGS-012 V1 — delete-account confirmation dialog, on the kit `Modal` (spec 17 §4.1).
// States: idle / ready / submitting / error_recoverable / error_critical / blocked_suspended.
// submitting and error_critical are non-dismissible (no tap-outside, no back, no ✕, no Escape).

import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { DeleteAccountError } from '@kc/application';
import { Text } from '@kc/ui';
import { useDeleteAccountConfirmModalStyles } from './DeleteAccountConfirmModal.styles';
import { DangerButton, SecondaryButton } from './ui/Buttons';
import { Modal } from './ui/Modal';
import { TextField } from './ui/TextField';

export type AccountStatusForDelete =
  | 'pending_verification'
  | 'active'
  | 'suspended_for_false_reports'
  | 'suspended_admin'
  | 'banned'
  | 'deleted'
  | null;

export interface DeleteAccountConfirmModalProps {
  visible: boolean;
  accountStatus: AccountStatusForDelete;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}

type LocalState =
  | { kind: 'idle' }
  | { kind: 'submitting' }
  | { kind: 'error'; error: 'recoverable' | 'critical' }
  | { kind: 'blocked' };

const BULLET_KEYS = ['posts', 'follows', 'moderation', 'donations', 'devices'] as const;

/** Locale key of one "what gets deleted" bullet. */
function bulletCopyKey(key: (typeof BULLET_KEYS)[number]) {
  return `settings.deleteAccountModal.bullets.${key}` as const;
}

export function DeleteAccountConfirmModal(props: DeleteAccountConfirmModalProps) {
  const { t } = useTranslation();
  const styles = useDeleteAccountConfirmModalStyles();
  const { visible, accountStatus, onCancel, onConfirm } = props;
  const [typed, setTyped] = useState('');
  const [state, setState] = useState<LocalState>({ kind: 'idle' });
  const keyword = t('settings.deleteAccountModal.confirmKeyword');

  const isBlocked = useMemo(() => {
    return accountStatus === 'suspended_for_false_reports'
      || accountStatus === 'suspended_admin'
      || accountStatus === 'banned';
  }, [accountStatus]);

  React.useEffect(() => {
    if (visible && isBlocked) setState({ kind: 'blocked' });
    else if (visible) setState((s) => (s.kind === 'blocked' ? { kind: 'idle' } : s));
  }, [visible, isBlocked]);

  const ready = typed.trim() === keyword;

  const handleConfirm = useCallback(async () => {
    if (!ready) return;
    setState({ kind: 'submitting' });
    try {
      await onConfirm();
    } catch (e) {
      if (e instanceof DeleteAccountError) {
        if (e.code === 'suspended') {
          setState({ kind: 'blocked' });
          return;
        }
        if (e.code === 'auth_delete_failed') {
          setState({ kind: 'error', error: 'critical' });
          return;
        }
        setState({ kind: 'error', error: 'recoverable' });
        return;
      }
      setState({ kind: 'error', error: 'recoverable' });
    }
  }, [ready, onConfirm]);

  const submitting = state.kind === 'submitting';
  const critical = state.kind === 'error' && state.error === 'critical';
  const blocked = state.kind === 'blocked';
  const allowDismiss = state.kind === 'idle' || (state.kind === 'error' && !critical) || blocked;

  const footer = blocked ? (
    <SecondaryButton label={t('settings.deleteAccountModal.buttons.close')} size="md" fullWidth onPress={onCancel} />
  ) : (
    <>
      <DangerButton
        label={critical ? t('settings.deleteAccountModal.buttons.retry') : t('settings.deleteAccountModal.buttons.delete')}
        size="md"
        fullWidth
        disabled={!ready}
        loading={submitting}
        onPress={() => void handleConfirm()}
      />
      {critical ? null : (
        <SecondaryButton
          label={t('settings.deleteAccountModal.buttons.cancel')}
          size="md"
          fullWidth
          disabled={submitting}
          onPress={onCancel}
        />
      )}
    </>
  );

  // One dialog for every state, so a state change swaps its content instead of re-opening it.
  return (
    <Modal
      visible={visible}
      title={blocked ? t('settings.deleteAccountModal.blocked.title') : t('settings.deleteAccountModal.title')}
      onDismiss={onCancel}
      dismissible={allowDismiss}
      footer={footer}
    >
      {blocked ? (
        <Text style={styles.body}>{t('settings.deleteAccountModal.blocked.body')}</Text>
      ) : (
        // Long copy: scroll it on short screens so the actions below stay in reach.
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          // iOS: inset the content above the keyboard so the confirm field stays visible.
          automaticallyAdjustKeyboardInsets
        >
          <View style={styles.bulletList}>
            {BULLET_KEYS.map((key) => (
              <Text key={key} style={styles.bullet}>{`• ${t(bulletCopyKey(key))}`}</Text>
            ))}
          </View>

          <Text style={styles.chatsRetention}>
            {t('settings.deleteAccountModal.chatsRetention', { deletedUserLabel: t('common.deletedUser') })}
          </Text>
          <Text style={styles.body}>{t('settings.deleteAccountModal.warning')}</Text>

          {state.kind === 'error' && (
            <View style={[styles.errorBanner, critical && styles.errorBannerCritical]}>
              <Text style={[styles.errorBannerText, critical && styles.errorBannerCriticalText]}>
                {critical
                  ? t('settings.deleteAccountModal.errors.critical')
                  : t('settings.deleteAccountModal.errors.recoverable')}
              </Text>
            </View>
          )}

          <TextField
            label={t('settings.deleteAccountModal.confirmInputLabel')}
            value={typed}
            onChangeText={setTyped}
            placeholder={t('settings.deleteAccountModal.confirmInputPlaceholder')}
            editable={!submitting}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </ScrollView>
      )}
    </Modal>
  );
}
