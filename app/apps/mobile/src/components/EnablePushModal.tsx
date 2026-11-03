// FR-NOTIF-015 — push pre-prompt shown before the OS permission dialog.
// Built on the kit `Modal` (spec 17 §4.1); dismissing it declines.
import { Linking } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import type { PrePromptTrigger } from '../lib/notifications/usePushPermissionGate';
import { GhostButton, PrimaryButton } from './ui/Buttons';
import { Modal } from './ui/Modal';

interface Props {
  visible: boolean;
  trigger: PrePromptTrigger | null;
  onAccept: () => void;
  onDecline: () => void;
  /** When OS will not re-prompt, offer Settings instead of accept. */
  showOpenSettings?: boolean;
}

export function EnablePushModal({
  visible,
  trigger,
  onAccept,
  onDecline,
  showOpenSettings = false,
}: Readonly<Props>) {
  const { t } = useTranslation();
  const styles = useEnablePushModalStyles();
  const bodyKey = trigger === 'first-post-published'
    ? 'notifications.enablePushBodyFromPost'
    : 'notifications.enablePushBodyFromChat';

  return (
    <Modal
      visible={visible}
      title={t('notifications.enablePushTitle')}
      onDismiss={onDecline}
      footer={
        <>
          {showOpenSettings ? (
            <PrimaryButton
              label={t('notifications.openOsSettings')}
              size="md"
              fullWidth
              onPress={() => void Linking.openSettings()}
            />
          ) : (
            <PrimaryButton
              testID="push-gate-accept"
              label={t('notifications.enablePushAccept')}
              size="md"
              fullWidth
              onPress={onAccept}
            />
          )}
          <GhostButton
            testID="push-gate-decline"
            label={t('notifications.enablePushDecline')}
            size="md"
            fullWidth
            onPress={onDecline}
          />
        </>
      }
    >
      <Text style={styles.body}>{t(bodyKey)}</Text>
    </Modal>
  );
}

const useEnablePushModalStyles = makeUseStyles(({ colors }) => ({
  body: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
}));
