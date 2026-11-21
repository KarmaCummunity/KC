// Confirmation before signing out of the app (FR-SETTINGS-011 AC1). The confirm runs the
// sign-out; the modal stays open and busy until it settles.
import { useTranslation } from 'react-i18next';
import { ConfirmActionModal } from '../post/ConfirmActionModal';

interface Props {
  visible: boolean;
  signingOut: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function SignOutConfirmModal({ visible, signingOut, onCancel, onConfirm }: Props) {
  const { t } = useTranslation();
  return (
    <ConfirmActionModal
      visible={visible}
      title={t('settings.signOutConfirm.title')}
      message={t('settings.signOutConfirm.message')}
      confirmLabel={t('settings.logout')}
      isBusy={signingOut}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
