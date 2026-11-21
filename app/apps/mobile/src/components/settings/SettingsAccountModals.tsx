// The account dialogs of the Settings screen, driven by `useSettingsAccountActions`: the logout
// confirmation (FR-SETTINGS-011 AC1), the two-step account deletion (FR-SETTINGS-012 AC1) and its
// success overlay. Kept apart so the screen stays under the file-size cap.
import { DeleteAccountConfirmModal } from '../DeleteAccountConfirmModal';
import { DeleteAccountSuccessOverlay } from '../DeleteAccountSuccessOverlay';
import type { useSettingsAccountActions } from '../../hooks/useSettingsAccountActions';
import { SignOutConfirmModal } from './SignOutConfirmModal';

interface Props {
  readonly actions: ReturnType<typeof useSettingsAccountActions>;
  /** The member's display name, typed to confirm a deletion; null before onboarding sets one. */
  readonly displayName: string | null;
}

export function SettingsAccountModals({ actions, displayName }: Props) {
  return (
    <>
      <SignOutConfirmModal
        visible={actions.signOutConfirmVisible}
        signingOut={actions.signingOut}
        onCancel={actions.cancelSignOut}
        onConfirm={() => void actions.handleSignOut()}
      />
      <DeleteAccountConfirmModal
        visible={actions.deleteModalVisible}
        accountStatus={null}
        displayName={displayName}
        onCancel={() => actions.setDeleteModalVisible(false)}
        onConfirm={actions.handleDeleteConfirm}
      />
      <DeleteAccountSuccessOverlay visible={actions.deleteSuccessVisible} />
    </>
  );
}
